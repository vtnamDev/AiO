/**
 * Deduper — module dedupe tập trung, dùng chung cho pipeline và repair scripts.
 * 3 lớp:
 *   L1: exact url_hash          (unique index — chặn cứng ở DB)
 *   L2: exact title_normalized  (index articles_title_norm_idx)
 *   L3: near-duplicate title    (Jaccard similarity ≥ NEAR_DUP_THRESHOLD,
 *                                ứng viên lấy từ trigram index prefix bucket)
 * Server-side only.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { hashUrl } from "@/lib/text/hash-utils";
import { normalizeTitle, titleSimilarity } from "@/lib/text/vn-text";

export const NEAR_DUP_THRESHOLD = 0.6;
const PREFIX_LEN = 8; // độ dài prefix title_normalized dùng để fetch ứng viên
const LOOKBACK_DAYS = 30; // chỉ so với bài trong khoảng này
const CANDIDATE_LIMIT = 50;

export interface DedupeVerdict {
  isDuplicate: boolean;
  reason: "url" | "title-exact" | "near-title" | null;
}

/** Chuẩn hóa output của drizzle db.execute: trả mảng rows an toàn. */
export function extractRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

/** L1 + chống DB: url_hash đã tồn tại chưa? */
export async function isKnownUrl(url: string): Promise<boolean> {
  const h = hashUrl(url);
  const rows = extractRows<{ n: number }>(
    await db.execute(sql`
      SELECT 1 AS n FROM articles WHERE url_hash = ${h} LIMIT 1
    `)
  );
  return rows.length > 0;
}

/** L2: title_normalized đã tồn tại (trong lookback window)? */
export async function isKnownTitle(title: string): Promise<boolean> {
  const norm = normalizeTitle(title);
  const rows = extractRows<{ n: number }>(
    await db.execute(sql`
      SELECT 1 AS n FROM articles
      WHERE title_normalized = ${norm}
        AND published_at > now() - interval '${sql.raw(String(LOOKBACK_DAYS))} days'
      LIMIT 1
    `)
  );
  return rows.length > 0;
}

/** L3: near-duplicate theo Jaccard trên title. */
export async function findNearDuplicateTitle(
  title: string
): Promise<string | null> {
  const norm = normalizeTitle(title);
  const rows = extractRows<{ id: string; title: string }>(
    await db.execute(sql`
      SELECT id, title FROM articles
      WHERE published_at > now() - interval '${sql.raw(String(LOOKBACK_DAYS))} days'
        AND left(title_normalized, ${PREFIX_LEN}) = left(${norm}, ${PREFIX_LEN})
      LIMIT ${CANDIDATE_LIMIT}
    `)
  );
  for (const r of rows) {
    if (titleSimilarity(title, r.title) >= NEAR_DUP_THRESHOLD) {
      return r.id;
    }
  }
  return null;
}

/** Kiểm tra đủ 3 lớp cho 1 candidate. Lỗi DB → coi như không dup (pipeline tự chặn bằng constraint). */
export async function checkDuplicate(candidate: {
  url: string;
  title: string;
}): Promise<DedupeVerdict> {
  try {
    if (await isKnownUrl(candidate.url)) {
      return { isDuplicate: true, reason: "url" };
    }
    if (await isKnownTitle(candidate.title)) {
      return { isDuplicate: true, reason: "title-exact" };
    }
    const near = await findNearDuplicateTitle(candidate.title);
    if (near) return { isDuplicate: true, reason: "near-title" };
    return { isDuplicate: false, reason: null };
  } catch (err) {
    console.error(
      "[deduper] check failed (fail-open):",
      err instanceof Error ? err.message : err
    );
    return { isDuplicate: false, reason: null };
  }
}

/**
 * Quét gần đây để tìm cụm near-duplicate còn sót (chạy định kỳ/schedule).
 * Trả về các nhóm article id trùng nội dung — caller quyết định merge/archive.
 */
export async function scanNearDuplicates(
  withinDays = LOOKBACK_DAYS
): Promise<Array<{ canonicalId: string; duplicateIds: string[] }>> {
  const rows = extractRows<{ id: string; title: string }>(
    await db.execute(sql`
      SELECT id, title FROM articles
      WHERE published_at > now() - interval '${sql.raw(String(withinDays))} days'
      ORDER BY published_at DESC
      LIMIT 2000
    `)
  );

  const groups: Array<{ canonicalId: string; duplicateIds: string[] }> = [];
  const assigned = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    if (assigned.has(rows[i].id)) continue;
    const dups: string[] = [];
    for (let j = i + 1; j < rows.length; j++) {
      if (assigned.has(rows[j].id)) continue;
      if (titleSimilarity(rows[i].title, rows[j].title) >= NEAR_DUP_THRESHOLD) {
        dups.push(rows[j].id);
        assigned.add(rows[j].id);
      }
    }
    if (dups.length > 0) {
      groups.push({ canonicalId: rows[i].id, duplicateIds: dups });
    }
  }
  return groups;
}
