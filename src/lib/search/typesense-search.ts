/**
 * Typesense full-text search client — server-side only.
 * Graceful degrade: thiếu env / lỗi mạng → trả kết quả rỗng an toàn,
 * caller (search repo) sẽ fallback về Postgres FTS.
 */
import { TYPESENSE_HOST, TYPESENSE_API_KEY } from "@/lib/config/env";
import type { SearchHit } from "@/lib/types";

const COLLECTION = "articles";
const TIMEOUT_MS = 3_000;

export function isTypesenseEnabled(): boolean {
  return Boolean(TYPESENSE_HOST && TYPESENSE_API_KEY);
}

interface TypesenseHit {
  document: {
    id: string;
    title: string;
    snippet?: string;
    category?: string;
    published_at?: number; // unix seconds
    image_url?: string;
    author?: string;
    canonical_url: string;
    source_id: string;
  };
  text_match?: number;
}

function baseUrl(): string {
  // TYPESENSE_HOST ví dụ: "https://xyz.a1.typesense.net" hoặc "http://localhost:8108"
  return TYPESENSE_HOST!.replace(/\/+$/, "");
}

async function tsFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T | null> {
  if (!isTypesenseEnabled()) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        "X-TYPESENSE-API-KEY": TYPESENSE_API_KEY!,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.error(`[typesense] ${res.status} on ${path}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(
      "[typesense] request failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/** Tìm kiếm full-text. Trả null nếu Typesense unavailable → caller fallback Postgres. */
export async function typesenseSearch(
  query: string,
  opts: { page?: number; perPage?: number; category?: string } = {}
): Promise<SearchHit[] | null> {
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(50, Math.max(1, opts.perPage ?? 20));

  const params = new URLSearchParams({
    q: query,
    query_by: "title,snippet",
    query_by_weights: "3,1",
    per_page: String(perPage),
    page: String(page),
    sort_by: "_text_match:desc,published_at:desc",
    highlight_affix_num_tokens: "4",
  });
  if (opts.category && opts.category !== "all") {
    params.set("filter_by", `category:=${opts.category}`);
  }

  const data = await tsFetch<{ hits: TypesenseHit[] }>(
    `/collections/${COLLECTION}/documents/search?${params.toString()}`
  );
  if (!data) return null;

  return (data.hits ?? []).map((h) => ({
    id: h.document.id,
    title: h.document.title,
    snippet: h.document.snippet ?? "",
    category: h.document.category ?? "general",
    publishedAt: h.document.published_at
      ? new Date(h.document.published_at * 1000).toISOString()
      : new Date().toISOString(),
    imageUrl: h.document.image_url,
    author: h.document.author,
    canonicalUrl: h.document.canonical_url,
    sourceId: h.document.source_id,
  }));
}

/**
 * Đảm bảo collection tồn tại với schema đúng.
 * Nếu đã tồn tại → bỏ qua (thành công); nếu lỗi khác → ném ra để script ingest báo lỗi rõ.
 */
export async function ensureCollection(): Promise<void> {
  const fields = [
    { name: "title", type: "string", locale: "", facet: false },
    { name: "snippet", type: "string", optional: true },
    { name: "content", type: "string", optional: true },
    { name: "category", type: "string", facet: true },
    { name: "published_at", type: "int64" }, // unix seconds, dùng sort
    { name: "image_url", type: "string", optional: true },
    { name: "author", type: "string", optional: true },
    { name: "canonical_url", type: "string" },
    { name: "source_id", type: "string", facet: true },
  ];
  const res = await tsFetch<unknown>(`/collections`, {
    method: "POST",
    body: JSON.stringify({ name: COLLECTION, fields }),
  });
  // tsFetch chỉ trả non-null khi HTTP 2xx; 409 (đã tồn tại) sẽ bị log — chấp nhận được.
  if (res === null) {
    // Kiểm tra thực tế collection có tồn tại chưa:
    const check = await tsFetch<{ name: string }>(
      `/collections/${COLLECTION}`
    );
    if (!check) {
      throw new Error("[typesense] không tạo/đọc được collection articles");
    }
  }
}

/** Upsert một document vào Typesense. Lỗi không ném — ingest vẫn tiếp tục. */
export async function upsertArticleDoc(doc: {
  id: string;
  title: string;
  snippet?: string;
  content?: string;
  category: string;
  publishedAt: Date | string;
  imageUrl?: string;
  author?: string;
  canonicalUrl: string;
  sourceId: string;
}): Promise<boolean> {
  if (!isTypesenseEnabled()) return false;
  const publishedAtSec = Math.floor(
    new Date(doc.publishedAt).getTime() / 1000
  );
  const res = await tsFetch<{ id: string }>(
    `/collections/${COLLECTION}/documents?action=upsert`,
    {
      method: "PATCH",
      body: JSON.stringify({
        id: doc.id,
        title: doc.title,
        snippet: doc.snippet ?? "",
        content: doc.content ?? "",
        category: doc.category,
        published_at: publishedAtSec,
        image_url: doc.imageUrl ?? "",
        author: doc.author ?? "",
        canonical_url: doc.canonicalUrl,
        source_id: doc.sourceId,
      }),
    }
  );
  return res !== null;
}
