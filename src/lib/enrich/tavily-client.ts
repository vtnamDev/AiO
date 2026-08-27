/**
 * Tavily client — làm giàu nội dung bài viết (lấy full content từ URL).
 * Graceful degrade: thiếu API key / lỗi → trả null, pipeline vẫn chạy tiếp.
 * Server-side only. Không hard-code key.
 */
import { TAVILY_API_KEY } from "@/lib/config/env";

const ENDPOINT = "https://api.tavily.com/extract";
const TIMEOUT_MS = 8_000;

export function isTavilyEnabled(): boolean {
  return Boolean(TAVILY_API_KEY);
}

export interface ExtractResult {
  url: string;
  content: string;
  images?: string[];
}

/**
 * Gọi Tavily Extract cho 1 URL. Trả null nếu fail/thiếu key.
 * Tavily extract: POST {api_key, urls} → {results: [{url, raw_content}], failed_results}
 */
export async function tavilyExtract(
  url: string
): Promise<ExtractResult | null> {
  if (!isTavilyEnabled()) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        urls: [url],
        extract_depth: "basic",
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.error(`[tavily] HTTP ${res.status} for ${url}`);
      return null;
    }
    const data = (await res.json()) as {
      results?: Array<{ url: string; raw_content?: string }>;
    };
    const hit = data.results?.[0];
    if (!hit?.raw_content || hit.raw_content.trim().length === 0) return null;
    return {
      url: hit.url,
      content: hit.raw_content,
      images: undefined,
    };
  } catch (err) {
    console.error(
      "[tavily] extract failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Extract nhiều URL song song có giới hạn concurrency (mặc định 3)
 * để tránh rate-limit. Kết quả theo đúng thứ tự input; URL fail → null.
 */
export async function tavilyExtractBatch(
  urls: string[],
  concurrency = 3
): Promise<Array<ExtractResult | null>> {
  const results: Array<ExtractResult | null> = new Array(urls.length).fill(
    null
  );
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < urls.length) {
      const idx = cursor++;
      results[idx] = await tavilyExtract(urls[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, urls.length) }, () => worker())
  );
  return results;
}
