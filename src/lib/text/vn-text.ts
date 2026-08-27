/**
 * Xử lý văn bản tiếng Việt: bỏ dấu, chuẩn hóa, hash dedupe.
 * Thuần functions, không side-effect, không phụ thuộc Node-only API.
 */

/** Bỏ dấu tiếng Việt: "đà lạt" → "da lat", "Đà Lạt" → "Da Lat" */
export function removeDiacritics(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

/** Chuẩn hóa khoảng trắng + lowercase */
export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/** Lowercase chuẩn (không lỗi Türkce I) */
export function toLower(input: string): string {
  return input.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * Chuẩn hóa title phục vụ dedupe near-duplicate:
 * bỏ dấu → lowercase → bỏ punctuation → collapse whitespace.
 */
export function normalizeTitle(title: string): string {
  return normalizeWhitespace(
    removeDiacritics(toLower(title)).replace(/[^\p{L}\p{N}\s]/gu, " ")
  );
}

/** FNV-1a 32-bit → hex. Nhanh, không cần crypto, đủ cho dedupe bucket. */
export function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Hash ổn định cho URL (dedupe cùng bài, khác query-string tracking). */
export function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    // Bỏ query-param tracking phổ biến
    const drop = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "ref",
      "source",
      "spm",
    ];
    for (const k of [...u.searchParams.keys()]) {
      if (drop.includes(k.toLowerCase())) u.searchParams.delete(k);
    }
    // Bỏ trailing slash redundant (giữ "/" gốc)
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    return u.toString();
  } catch {
    return url.trim();
  }
}

export function hashUrl(url: string): string {
  return fnv1a32(canonicalizeUrl(url));
}

/**
 * Content hash cho dedupe same-story: lấy thân bài (bỏ html tag, số, punctuation),
 * bỏ dấu + lowercase, hash 32-bit. Trùng content_hash + title tương đồng → near-duplicate.
 */
export function hashContent(content: string): string {
  const cleaned = normalizeWhitespace(
    removeDiacritics(
      toLower(
        content
          .replace(/<[^>]+>/g, " ") // bỏ HTML tag
          .replace(/\d+/g, " ") // bỏ số (ngày/giờ lệch giữa các báo)
          .replace(/[^\p{L}\s]/gu, " ")
      )
    )
  );
  return fnv1a32(cleaned);
}

/** Jaccard similarity trên word-set — dùng so near-duplicate title (≥0.6). */
export function titleSimilarity(a: string, b: string): number {
  const wa = new Set(normalizeTitle(a).split(" ").filter((w) => w.length > 1));
  const wb = new Set(normalizeTitle(b).split(" ").filter((w) => w.length > 1));
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

/** Sinh uuid v4 không cần deps (id cho articles/sources). */
export function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Slug từ tên nguồn: "Tuổi Trẻ Online" → "tuoi-tre-online" */
export function slugify(name: string): string {
  return normalizeWhitespace(
    removeDiacritics(toLower(name)).replace(/[^\p{L}\p{N}\s-]/gu, "")
  ).replace(/\s+/g, "-");
}
