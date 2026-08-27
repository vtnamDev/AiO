/**
 * Ranker — tính điểm hiển thị cho bài viết (home feed / category).
 * Công thức: score = freshness * W_FRESH
 *                     + trust  * W_TRUST
 *                     + match  * W_MATCH (nếu có query)
 *
 * Tất cả thành phần chuẩn hóa về [0,1] trước khi cộng trọng số.
 * Thuần functions, không side-effect — dễ test.
 */

export interface RankableItem {
  publishedAt: string | Date;
  /** Điểm tin cậy nguồn [0,1] — từ bảng sources.trust_score */
  sourceTrust?: number; // default 0.5 nếu không truyền
  /** Độ khớp query [0,1] — từ Typesense text_match hoặc pg ts_rank/similarity đã normalize */
  matchScore?: number;
}

/** Trọng số mặc định — chỉnh tại đây, không hard-code ở nơi gọi. */
const W_FRESH = 0.5;
const W_TRUST = 0.3;
const W_MATCH = 0.2;

/** Halflife decays: sau N giờ điểm fresh giảm còn một nửa. */
const FRESH_HALFLIFE_HOURS = 12;

/**
 * Freshness decay dạng exponential halflife:
 *   age=0h → 1.0 ; age=12h → 0.5 ; age=24h → 0.25 ...
 * Clamp dưới 0 để bài rất cũ không âm điểm.
 */
export function freshnessScore(
  publishedAt: string | Date,
  now = Date.now()
): number {
  const t =
    typeof publishedAt === "string"
      ? Date.parse(publishedAt)
      : publishedAt.getTime();
  if (Number.isNaN(t)) return 0;
  const ageHours = Math.max(0, (now - t) / 3_600_000);
  return Math.pow(2, -ageHours / FRESH_HALFLIFE_HOURS);
}

/** Clamp số vào [0,1] — dùng cho mọi input từ ngoài (trust, match). */
function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Tính điểm rank cho 1 item. Trả về [0,1].
 * Không có query → W_MATCH dồn về fresh/trust theo tỷ lệ còn lại.
 */
export function rankScore(item: RankableItem, hasQuery = false): number {
  const fresh = clamp01(freshnessScore(item.publishedAt));
  const trust = clamp01(item.sourceTrust ?? 0.5);
  const hasMatch = hasQuery && item.matchScore != null;

  let wFresh = W_FRESH;
  let wTrust = W_TRUST;
  let wMatch = W_MATCH;

  if (!hasMatch) {
    // Redistribute trọng số của match
    wTrust += wMatch / 2;
    wFresh += wMatch / 2;
    wMatch = 0;
  }

  const total = wFresh + wTrust + wMatch;
  return (
    (wFresh * fresh +
      wTrust * trust +
      wMatch * (hasMatch ? clamp01(item.matchScore!) : 0)) /
    total
  );
}

/**
 * Sắp xếp mảng item theo điểm giảm dần, gắn kèm score.
 * Trả mảng mới — không mutate input.
 */
export function rankItems<T extends RankableItem>(
  items: T[],
  opts: { query?: string; now?: number } = {}
): Array<T & { score: number }> {
  const hasQuery = Boolean(opts.query && opts.query.trim().length > 0);
  const now = opts.now ?? Date.now();

  return items
    .map((it) => ({
      ...it,
      score: rankScore(
        {
          publishedAt: it.publishedAt,
          sourceTrust: it.sourceTrust,
          matchScore: it.matchScore,
        },
        hasQuery
      ),
    }))
    .map((it) => {
      // Nếu caller truyền `now`, tính lại freshness với now đó (test-friendly)
      if (opts.now != null) {
        it.score = rankScore(
          {
            publishedAt: it.publishedAt,
            sourceTrust: it.sourceTrust,
            matchScore: it.matchScore,
          },
          hasQuery
        );
        // freshnessScore nhận now qua closure; rankScore hiện dùng Date.now()
        // nên override bằng tính trực tiếp khi cần deterministic test
        const fresh = clamp01(freshnessScore(it.publishedAt, now));
        const trust = clamp01(it.sourceTrust ?? 0.5);
        const hasMatch = hasQuery && it.matchScore != null;
        let wFresh = W_FRESH;
        let wTrust = W_TRUST;
        let wMatch = W_MATCH;
        if (!hasMatch) {
          wTrust += wMatch / 2;
          wFresh += wMatch / 2;
          wMatch = 0;
        }
        const total = wFresh + wTrust + wMatch;
        it.score =
          (wFresh * fresh +
            wTrust * trust +
            wMatch * (hasMatch ? clamp01(it.matchScore!) : 0)) /
          total;
      }
      return it as T & { score: number };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Interleave đa nguồn cho home feed: tránh một nguồn chiếm toàn bộ đầu trang.
 * Đầu vào là danh sách đã rank — nhóm round-robin theo nguồn.
 */
export function diversifyBySource<
  T extends { sourceId: string; score: number },
>(ranked: T[], maxPerSourceInRow = 1): T[] {
  const remaining = [...ranked];
  const out: T[] = [];
  while (remaining.length > 0) {
    const perSourceCount = new Map<string, number>();
    const pickedIdx = new Set<number>();
    for (let i = 0; i < remaining.length; i++) {
      const sid = remaining[i].sourceId;
      const c = perSourceCount.get(sid) ?? 0;
      if (c < maxPerSourceInRow) {
        out.push(remaining[i]);
        perSourceCount.set(sid, c + 1);
        pickedIdx.add(i);
        if (perSourceCount.size >= Math.max(4, maxPerSourceInRow * 4)) break;
      }
    }
    if (pickedIdx.size === 0) {
      // Fallback: hết slot trong vòng này nhưng vẫn còn item → push nốt phần còn lại
      out.push(...remaining);
      break;
    }
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (pickedIdx.has(i)) remaining.splice(i, 1);
    }
  }
  return out;
}
