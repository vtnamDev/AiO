/**
 * Fallback search trên Postgres: FTS (tsvector) kết hợp trigram similarity.
 * Chỉ dùng khi Typesense unavailable. Server-side only.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { SearchHit } from "@/lib/types";

export async function pgSearch(
  query: string,
  opts: { page?: number; perPage?: number; category?: string } = {}
): Promise<SearchHit[]> {
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(50, Math.max(1, opts.perPage ?? 20));
  const offset = (page - 1) * perPage;
  const category =
    opts.category && opts.category !== "all" ? opts.category : null;
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  // websearch_to_tsquery chấp nhận cú pháp tự nhiên ("hà giao thông" v.v.)
  const rows = await db.execute<{
    id: string;
    title: string;
    snippet: string | null;
    category: string;
    published_at: Date | string;
    image_url: string | null;
    author: string | null;
    canonical_url: string;
    source_id: string;
  }>(sql`
    SELECT a.id, a.title, a.snippet, a.category, a.published_at,
           a.image_url, a.author, a.canonical_url, a.source_id
    FROM articles a
    WHERE (
      a.fts @@ websearch_to_tsquery('simple', ${trimmed})
      OR similarity(a.title_normalized, ${trimmed}) > 0.3
      OR a.title_normalized LIKE ${"%" + trimmed.toLowerCase() + "%"}
    )
    ${category ? sql`AND a.category = ${category}` : sql``}
    ORDER BY
      GREATEST(
        CASE WHEN a.fts @@ websearch_to_tsquery('simple', ${trimmed})
             THEN ts_rank(a.fts, websearch_to_tsquery('simple', ${trimmed}))
             ELSE 0 END,
        similarity(a.title_normalized, ${trimmed})
      ) DESC,
      a.published_at DESC
    LIMIT ${perPage} OFFSET ${offset}
  `);

  const list = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
  return (list as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    title: String(r.title),
    snippet: r.snippet != null ? String(r.snippet) : "",
    category: String(r.category ?? "general"),
    publishedAt: new Date(r.published_at as string).toISOString(),
    imageUrl: r.image_url != null ? String(r.image_url) : undefined,
    author: r.author != null ? String(r.author) : undefined,
    canonicalUrl: String(r.canonical_url),
    sourceId: String(r.source_id),
  }));
}

/** Ghi log tìm kiếm vào search_logs — best-effort, không ném lỗi. */
export async function logSearch(
  query: string,
  resultCount: number
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO search_logs (query, result_count)
      VALUES (${query.trim()}, ${resultCount})
    `);
  } catch (err) {
    console.error(
      "[pg-fallback] log search failed:",
      err instanceof Error ? err.message : err
    );
  }
}
