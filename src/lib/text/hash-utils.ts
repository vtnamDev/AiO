/**
 * Hash utilities — các hàm hash ổn định (deterministic) phục vụ dedupe.
 * Tách riêng khỏi vn-text.ts để vn-text thuần về normalization,
 * còn mọi hash thì tập trung tại đây.
 */
import {
  canonicalizeUrl,
  normalizeTitle,
  normalizeWhitespace,
  removeDiacritics,
  toLower,
} from "./vn-text";

/** FNV-1a 32-bit → hex 8 ký tự. Nhanh, không cần crypto, đủ cho dedupe bucket. */
export function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * FNV-1a 64-bit mô phỏng bằng 2 lần 32-bit (high/low) → hex 16 ký tự.
 * Giảm xác suất collision khi dataset lớn hơn.
 */
export function fnv1a64(input: string): string {
  const seed = 0x811c9dc5;
  let hi = seed;
  let lo = seed;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    hi = Math.imul(hi ^ c, 0x01000193) >>> 0;
    lo = Math.imul(lo ^ ((c + i) & 0xffff), 0x01000193) >>> 0;
  }
  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
}

/** Hash ổn định cho URL đã canonicalize (dedupe cùng bài, khác query tracking). */
export function hashUrl(url: string): string {
  return fnv1a64(canonicalizeUrl(url));
}

/** Hash cho title đã normalize — dùng so khớp exact-duplicate title nhanh qua index. */
export function hashTitle(title: string): string {
  return fnv1a32(normalizeTitle(title));
}

/** Bước tiền xử lý chung trước khi hash content: bỏ HTML tag, số, punctuation. */
function cleanContentForHash(content: string): string {
  return normalizeWhitespace(
    removeDiacritics(
      toLower(
        content
          .replace(/<[^>]+>/g, " ") // bỏ HTML tag
          .replace(/\d+/g, " ") // bỏ số (ngày/giờ lệch giữa các báo)
          .replace(/[^\p{L}\s]/gu, " ")
      )
    )
  );
}

/** Content hash cho dedupe same-story: 64-bit trên thân bài đã sạch. */
export function hashContent(content: string): string {
  return fnv1a64(cleanContentForHash(content));
}
