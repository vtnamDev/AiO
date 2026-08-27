/**
 * Article repository — tầng truy cập dữ liệu duy nhất cho bảng articles.
 * Route handlers / pages KHÔNG query SQL trực tiếp, chỉ gọi qua đây.
 * Server-side only.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { extractRows } from "@/lib/ingest/deduper";
import { typesenseSearch } from "@/lib/search/typesense-search";
import { pgSearch } from "@/lib/search/pg-fallback";
import type { ArticleCard, SearchHit } from "@/lib/types";

export interface FeedOptions {
  page?: number;
  perPage?: number;
  category?: string;
  sourceId?: string;
}

export interface FeedResult {
  items: ArticleCard[];
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
}

/** Lấy feed bài mới nhất (home hoặc theo category/nguồn). */
export async function getFeed(opts: FeedOptions = {}): Promise<FeedResult> {
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(50, Math.max(1, opts.perPage ?? 20));
  const offset = (page - 1) * perPage;
  const category =
    opts.category && opts.category !== "all" ? opts.category : null;
  const sourceId = opts.sourceId ?? null;

  try {
    const rows = extractRows<{
      id: string;
      title: string;
      snippet: string | null;
      category: string;
      published_at: Date | string;
      image_url: string | null;
      author: string | null;
      canonical_url: string;
      source_id: string;
      source_name: string;
      source_trust: string;
    }>(
      await db.execute(sql`
        SELECT a.id, a.title, a.snippet, a.category, a.published_at,
               a.image_url, a.author, a.canonical_url,
               a.source_id, s.name AS source_name,
               s.trust_score AS source_trust
        FROM articles a
        JOIN sources s ON s.id = a.source_id
        WHERE (${category}::text IS NULL OR a.category = ${category})
          AND (${sourceId}::text IS NULL OR a.source_id = ${sourceId})
        ORDER BY a.published_at DESC
        LIMIT ${perPage + 1} OFFSET ${offset}
      `)
    );

    const countRows = extractRows<{ n: number }>(
      await db.execute(sql`
        SELECT COUNT(*)::int AS n
        FROM articles a
        WHERE (${category}::text IS NULL OR a.category = ${category})
          AND (${sourceId}::text IS NULL OR a.source_id = ${sourceId})
      `)
    );

    const total = countRows[0]?.n ?? 0;
    const hasMore = rows.length > perPage;
    const items = (hasMore ? rows.slice(0, perPage) : rows).map(toCard);

    return { items, total, page, perPage, hasMore };
  } catch (err) {
    console.error(
      "[article.repo] getFeed failed:",
      err instanceof Error ? err.message : err
    );
    return { items: [], total: 0, page, perPage, hasMore: false };
  }
}

export interface SearchOptions {
  page?: number;
  perPage?: number;
  category?: string;
}

export interface SearchResult {
  hits: SearchHit[];
  totalEstimate: number;
  backend: "typesense" | "postgres";
}

/**
 * Search hợp nhất: ưu tiên Typesense, lỗi/không cấu hình → Postgres FTS.
 * Không bao giờ throw — trả kết quả rỗng an toàn.
 */
export async function searchArticles(
  query: string,
  opts: SearchOptions = {}
): Promise<SearchResult> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return { hits: [], totalEstimate: 0, backend: "typesense" };
  }

  // Thử Typesense trước
  const tsHits = await typesenseSearch(trimmed, opts);
  if (tsHits !== null) {
    return {
      hits: tsHits,
      // Typesense không trả found cheap qua mapping hiện tại — dùng hit count
      totalEstimate: tsHits.length,
      backend: "typesense",
    };
  }

  // Fallback Postgres
  const pgHits = await pgSearch(trimmed, opts);
  return { hits: pgHits, totalEstimate: pgHits.length, backend: "postgres" };
}

/** Lấy 1 bài chi tiết theo id (kèm tên nguồn). Trả null nếu không thấy. */
export async function getArticleById(
  id: string
): Promise<ArticleCard | null> {
  try {
    const rows = extractRows<{
      id: string;
      title: string;
      snippet: string | null;
      content: string | null;
      category: string;
      published_at: Date | string;
      image_url: string | null;
      author: string | null;
      canonical_url: string;
      source_id: string;
      source_name: string;
      source_trust: string;
    }>(
      await db.execute(sql`
        SELECT a.id, a.title, a.snippet, a.content, a.category, a.published_at,
               a.image_url, a.author, a.canonical_url,
               a.source_id, s.name AS source_name,
               s.trust_score AS source_trust
        FROM articles a
        JOIN sources s ON s.id = a.source_id
        WHERE a.id = ${id}
        LIMIT 1
      `)
    );
    if (rows.length === 0) return null;
    return toCard(rows[0]);
  } catch (err) {
    console.error(
      "[article.repo] getArticleById failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/** Bài liên quan: cùng category trong lookback, loại trừ chính nó. */
export async function getRelated(
  articleId: string,
  category: string,
  limit = 5
): Promise<ArticleCard[]> {
  try {
    const rows = extractRows<{
      id: string;
      title: string;
      snippet: string | null;
      category: string;
      published_at: Date | string;
      image_url: string | null;
      author: string | null;
      canonical_url: string;
      source_id: string;
      source_name: string;
      source_trust: string;
    }>(
      await db.execute(sql`
        SELECT a.id, a.title, a.snippet, a.category, a.published_at,
               a.image_url, a.author, a.canonical_url,
               a.source_id, s.name AS source_name,
               s.trust_score AS source_trust
        FROM articles a
        JOIN sources s ON s.id = a.source_id
        WHERE a.id <> ${articleId}
          AND a.category = ${category}
          AND a.published_at > now() - interval '7 days'
        ORDER BY a.published_at DESC
        LIMIT ${limit}
      `)
    );
    return rows.map(toCard);
  } catch (err) {
    console.error(
      "[article.repo] getRelated failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Mapper nội bộ
// ---------------------------------------------------------------------------

function toCard(r: Record<string, unknown>): ArticleCard {
  const trustRaw = Number(r.source_trust);
  return {
    id: String(r.id),
    title: String(r.title),
    snippet: r.snippet != null ? String(r.snippet) : "",
    content:
      r.content != null && r.content !== undefined
        ? String(r.content)
        : undefined,
    category: String(r.category ?? "general"),
    publishedAt: new Date(r.published_at as string).toISOString(),
    imageUrl: r.image_url != null ? String(r.image_url) : undefined,
    author: r.author != null ? String(r.author) : undefined,
    canonicalUrl: String(r.canonical_url),
    sourceId: String(r.source_id),
    sourceName: String(r.source_name ?? ""),
    sourceTrust: Number.isFinite(trustRaw) ? trustRaw : 0.5,
  };
}
