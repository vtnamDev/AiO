/**
 * SerApi client — tìm kiếm Google News (SERP) để khám phá bài viết mới.
 * Graceful degrade: thiếu API key / lỗi → trả mảng rỗng, pipeline vẫn chạy.
 * Server-side only. Không hard-code key.
 */
import { SERAPI_API_KEY } from "@/lib/config/env";

const ENDPOINT = "https://serapi.io/api/v1/search";
const TIMEOUT_MS = 10_000;

export function isSerapiEnabled(): boolean {
  return Boolean(SERAPI_API_KEY);
}

export interface SerpNewsItem {
  title: string;
  link: string;
  snippet: string;
  source: string;
  date: string | null; // ISO nếu parse được
  imageUrl: string | null;
}

interface SerApiResponse {
  organic_results?: Array<{
    position?: number;
    title?: string;
    link?: string;
    snippet?: string;
    source?: string;
    date?: string;
    thumbnail?: string;
  }>;
  news_results?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
    source?: string;
    date?: string;
    thumbnail?: string;
  }>;
}

/**
 * Tìm kiếm tin tức tiếng Việt theo query.
 * engine=google_news để lấy kết quả News của Google.
 * Trả [] nếu fail/thiếu key — caller tự xử lý.
 */
export async function serapiSearchNews(
  query: string,
  opts: { gl?: string; hl?: string; num?: number } = {}
): Promise<SerpNewsItem[]> {
  if (!isSerapiEnabled()) return [];
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const params = new URLSearchParams({
    api_key: SERAPI_API_KEY!,
    engine: "google_news",
    q: trimmed,
    gl: opts.gl ?? "vn",
    hl: opts.hl ?? "vi",
    num: String(Math.min(20, Math.max(1, opts.num ?? 10))),
  });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.error(`[serapi] HTTP ${res.status} for "${trimmed}"`);
      return [];
    }
    const data = (await res.json()) as SerApiResponse;

    // Ưu tiên news_results, fallback sang organic_results
    const raw =
      data.news_results && data.news_results.length > 0
        ? data.news_results
        : data.organic_results ?? [];

    const items: SerpNewsItem[] = [];
    for (const r of raw) {
      if (!r.title || !r.link) continue;
      items.push({
        title: r.title,
        link: r.link,
        snippet: r.snippet ?? "",
        source: r.source ?? "",
        date: parseDate(r.date),
        imageUrl: r.thumbnail ?? null,
      });
    }
    return dedupeByLink(items);
  } catch (err) {
    console.error(
      "[serapi] search failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/**
 * Thử parse chuỗi date kiểu Google ("3 hours ago", "Jan 5, 2025", ISO...)
 * → ISO string; không parse được → null.
 */
function parseDate(raw?: string): string | null {
  if (!raw) return null;

  // Định dạng tương đối tiếng Anh phổ biến từ Google News
  const relMatch = raw.match(
    /^(\d+)\s+(second|minute|hour|day|week|month)s?\s+ago$/i
  );
  if (relMatch) {
    const n = parseInt(relMatch[1], 10);
    const unitMs: Record<string, number> = {
      second: 1_000,
      minute: 60_000,
      hour: 3_600_000,
      day: 86_400_000,
      week: 604_800_000,
      month: 2_592_000_000, // 30 ngày xấp xỉ
    };
    const ms = n * (unitMs[relMatch[2].toLowerCase()] ?? 0);
    return new Date(Date.now() - ms).toISOString();
  }

  // Định dạng tương đối tiếng Việt ("3 giờ trước")
  const viMatch = raw.match(
    /^(\d+)\s+(giây|phút|giờ|ngày|tuần|tháng)\s+trước$/i
  );
  if (viMatch) {
    const n = parseInt(viMatch[1], 10);
    const unitMs: Record<string, number> = {
      giây: 1_000,
      phút: 60_000,
      giờ: 3_600_000,
      ngày: 86_400_000,
      tuần: 604_800_000,
      tháng: 2_592_000_000,
    };
    const ms = n * (unitMs[viMatch[2].toLowerCase()] ?? 0);
    return new Date(Date.now() - ms).toISOString();
  }

  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Loại trùng link trong cùng 1 response (Google đôi khi trả dup). */
function dedupeByLink(items: SerpNewsItem[]): SerpNewsItem[] {
  const seen = new Set<string>();
  const out: SerpNewsItem[] = [];
  for (const it of items) {
    const key = it.link.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}
