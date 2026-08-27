/**
 * Ingest pipeline — điều phối toàn bộ luồng nạp dữ liệu:
 *   1. Discover : serapi (Google News) tìm bài theo query + domain whitelist
 *   2. Enrich   : tavily extract full content (song song, có concurrency limit)
 *   3. Dedupe   : url_hash exact + title exact + near-duplicate (title sim ≥ 0.6)
 *   4. Persist  : Postgres (source of truth) + Typesense (search index, best-effort)
 *
 * Nguyên tắc:
 * - Không ném lỗi ra ngoài pipeline — log và tiếp tục với item khác.
 * - Trả IngestReport để caller (route/script) hiển thị kết quả.
 * - Server-side only.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { TAVILY_INCLUDE_DOMAINS } from "@/lib/config/env";
import { isSerapiEnabled, serapiSearchNews } from "@/lib/enrich/serapi-client";
import { isTavilyEnabled, tavilyExtractBatch } from "@/lib/enrich/tavily-client";
import { upsertArticleDoc } from "@/lib/search/typesense-search";
import { hashContent, hashUrl } from "@/lib/text/hash-utils";
import {
  normalizeTitle,
  removeDiacritics,
  titleSimilarity,
  toLower,
  uuid,
} from "@/lib/text/vn-text";

export interface IngestOptions {
  /** Từ khóa truy vấn Google News */
  queries: string[];
  /** ID nguồn đang ingest (phải tồn tại trong bảng sources) */
  sourceId?: string;
  /** Tên nguồn nếu cần auto-create (kèm sourceId?) */
  sourceName?: string;
  /** Category gán cho bài trong batch này */
  category?: string;
  /** Giới hạn số bài tối đa ghi mới mỗi lần chạy */
  maxNewArticles?: number;
}

export interface IngestReport {
  discovered: number;
  afterUrlDedupe: number;
  afterTitleDedupe: number;
  enriched: number;
  inserted: number;
  failed: number;
  skippedNearDuplicate: number;
}

const NEAR_DUP_THRESHOLD = 0.6;

/** Đảm bảo source tồn tại; trả về id hợp lệ hoặc null nếu không thể xử lý. */
async function ensureSource(opts: IngestOptions): Promise<string | null> {
  try {
    if (opts.sourceId) {
      const found = await db.execute<{ id: string }>(sql`
        SELECT id FROM sources WHERE id = ${opts.sourceId} LIMIT 1
      `);
      const rows = extractRows(found);
      if (rows.length > 0) return rows[0].id;
      if (!opts.sourceName) return null;
    }
    // Auto-create khi có tên
    if (opts.sourceName) {
      const sourceSlug = makeSlug(opts.sourceName);
      const id = uuid();
      await db.execute(sql`
        INSERT INTO sources (id, name, slug)
        VALUES (${id}, ${opts.sourceName}, ${sourceSlug})
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `);
      const rows = await db.execute<{ id: string }>(sql`
        SELECT id FROM sources WHERE slug = ${sourceSlug} LIMIT 1
      `);
      const got = extractRows(rows);
      return got.length > 0 ? got[0].id : null;
    }
    return null;
  } catch (err) {
    console.error(
      "[pipeline] ensureSource failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/** Domain whitelist check: chỉ nhận link thuộc các domain cho phép (nếu cấu hình). */
function passesDomainFilter(url: string): boolean {
  const allowed = TAVILY_INCLUDE_DOMAINS;
  if (!allowed || allowed.length === 0) return true;
  try {
    const host = toLower(new URL(url).hostname);
    return allowed.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

export async function runIngest(opts: IngestOptions): Promise<IngestReport> {
  const report: IngestReport = {
    discovered: 0,
    afterUrlDedupe: 0,
    afterTitleDedupe: 0,
    enriched: 0,
    inserted: 0,
    failed: 0,
    skippedNearDuplicate: 0,
  };

  if (!isSerapiEnabled()) {
    console.warn("[pipeline] SERAPI_API_KEY chưa cấu hình — skip ingest");
    return report;
  }

  const sourceId = await ensureSource(opts);
  if (!sourceId) {
    console.error("[pipeline] không xác định được nguồn (sourceId/sourceName)");
    return report;
  }

  // ---- BƯỚC 1: DISCOVER -------------------------------------------------
  type Candidate = {
    title: string;
    url: string;
    snippet: string;
    author: string | null;
    imageUrl: string | null;
    publishedAt: Date;
  };
  const byUrl = new Map<string, Candidate>();

  for (const q of opts.queries) {
    const items = await serapiSearchNews(q, { num: 15 });
    for (const it of items) {
      if (byUrl.has(it.link)) continue;
      if (!passesDomainFilter(it.link)) continue;
      byUrl.set(it.link, {
        title: it.title.trim(),
        url: it.link,
        snippet: it.snippet ?? "",
        author: it.source || null,
        imageUrl: it.imageUrl,
        publishedAt: it.date ? new Date(it.date) : new Date(),
      });
    }
  }
  report.discovered = byUrl.size;
  let candidates = [...byUrl.values()];

  // ---- BƯỚC 2: DEDUPE THEO URL_HASH (trong batch + chống DB) ------------
  const seenUrlHash = new Map<string, Candidate>();
  for (const c of candidates) {
    const h = hashUrl(c.url);
    if (!seenUrlHash.has(h)) seenUrlHash.set(h, c);
  }

  const urlHashMap = new Map(seenUrlHash);
  const entries = [...urlHashMap.entries()];
  const dbHashes = new Set<string>();
  // Query DB theo chunk để tránh query quá dài
  for (let i = 0; i < entries.length; i += 50) {
    const chunk = entries.slice(i, i + 50).map(([h]) => h);
    try {
      const rows = await db.execute<{ url_hash: string }>(sql`
        SELECT url_hash FROM articles
        WHERE url_hash IN (${sql.join(
          chunk.map((h) => sql`${h}`),
          sql`, `
        )})
      `);
      for (const r of extractRows(rows)) dbHashes.add(r.url_hash);
    } catch (err) {
      console.error(
        "[pipeline] url_hash lookup failed:",
        err instanceof Error ? err.message : err
      );
    }
  }
  candidates = entries.filter(([h]) => !dbHashes.has(h)).map(([, c]) => c);
  report.afterUrlDedupe = candidates.length;

  if (candidates.length === 0) return report;

  // Giới hạn số lượng enrich
  const maxNew = opts.maxNewArticles ?? 20;
  if (candidates.length > maxNew) candidates = candidates.slice(0, maxNew);

  // ---- BƯỚC 3: DEDUPE THEO TITLE TRONG BATCH ---------------------------
  const titleKept: Candidate[] = [];
  for (const c of candidates) {
    const norm = normalizeTitle(c.title);
    const dupInBatch = titleKept.some(
      (k) => norm === normalizeTitle(k.title)
    );
    if (!dupInBatch) titleKept.push(c);
  }
  report.afterTitleDedupe = titleKept.length;

  // Near-duplicate so với DB (30 ngày gần nhất, cùng bucket content nhưng title khác):
  // kiểm tra bằng title_normalized tương tự.
  const remaining: Candidate[] = [];
  for (const c of titleKept) {
    const norm = normalizeTitle(c.title);
    try {
      const rows = await db.execute<{ title: string }>(sql`
        SELECT title FROM articles
        WHERE published_at > now() - interval '30 days'
          AND left(title_normalized, 8) = left(${norm}, 8)
        LIMIT 20
      `);
      const nearDup = extractRows(rows).some(
        (r) => titleSimilarity(c.title, r.title) >= NEAR_DUP_THRESHOLD
      );
      if (nearDup) {
        report.skippedNearDuplicate++;
        continue;
      }
      remaining.push(c);
    } catch {
      // Lookup lỗi → vẫn giữ candidate, bước INSERT sẽ chặn bằng constraint
      remaining.push(c);
    }
  }

  if (remaining.length === 0) return report;

  // ---- BƯỚC 4: ENRICH FULL CONTENT (tavily) -----------------------------
  let contents: Array<string | null> = remaining.map(() => null);
  if (isTavilyEnabled()) {
    const results = await tavilyExtractBatch(
      remaining.map((c) => c.url),
      3
    );
    contents = results.map((r) => (r ? r.content : null));
    report.enriched = contents.filter(Boolean).length;
  }

  // ---- BƯỚC 5: PERSIST ---------------------------------------------------
  for (let i = 0; i < remaining.length; i++) {
    const c = remaining[i];
    const content = contents[i];
    try {
      const id = uuid();
      const urlH = hashUrl(c.url);
      const normTitle = normalizeTitle(c.title);
      const bodyForHash =
        content && content.length > 200 ? content : c.snippet;
      const contentH = hashContent(bodyForHash);

      // Chống race: 2 worker cùng lúc → conflict unique key thì bỏ qua
      const insertRes = await db.execute<{ id: string }>(sql`
        INSERT INTO articles (
          id, title, snippet, content, category, published_at,
          image_url, author, canonical_url, url_hash,
          title_normalized, content_hash, source_id
        ) VALUES (
          ${id}, ${c.title}, ${c.snippet}, ${content ?? null},
          ${opts.category ?? "general"}, ${c.publishedAt.toISOString()},
          ${c.imageUrl ?? null}, ${c.author ?? null},
          ${c.url}, ${urlH}, ${normTitle}, ${contentH}, ${sourceId}
        )
        ON CONFLICT (url_hash) DO NOTHING
        RETURNING id
      `);
      const inserted = extractRows(insertRes);
      if (inserted.length === 0) {
        // Trùng url_hash (race hoặc dup giữa chừng) → không tính là fail
        continue;
      }
      report.inserted++;

      // Index lên Typesense — best effort, lỗi không ảnh hưởng report.inserted
      void upsertArticleDoc({
        id,
        title: c.title,
        snippet: c.snippet,
        content: content?.slice(0, 8000),
        category: opts.category ?? "general",
        publishedAt: c.publishedAt,
        imageUrl: c.imageUrl ?? undefined,
        author: c.author ?? undefined,
        canonicalUrl: c.url,
        sourceId,
      }).catch(() => undefined);
    } catch (err) {
      report.failed++;
      console.error(
        "[pipeline] persist failed for",
        c.url,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log("[pipeline] done:", JSON.stringify(report));
  return report;
}

// ---------------------------------------------------------------------------
// Helpers nội bộ
// ---------------------------------------------------------------------------

type Rows<T> = T[] | { rows?: T[] };

/** Chuẩn hóa output của drizzle db.execute: trả mảng rows an toàn. */
function extractRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

/** Slug đơn giản từ tên nguồn (đồng bộ phong cách slugify của vn-text). */
function makeSlug(name: string): string {
  return removeDiacritics(toLower(name))
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
}
