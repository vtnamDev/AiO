/**
 * Env config trung tâm — server-side only. Không hard-code secret.
 * Thiếu key → feature tự disable an toàn, build không fail.
 */
function readKey(name: string): string | undefined {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0 ? (v.trim() as string) : undefined;
}

export function readList(name: string): string[] | undefined {
  const raw = readKey(name);
  if (!raw) return undefined;
  const list = raw.split(",").map((d) => d.trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

export const DATABASE_URL = readKey("DATABASE_URL");
export const TYPESENSE_HOST = readKey("TYPESENSE_HOST");
export const TYPESENSE_API_KEY = readKey("TYPESENSE_API_KEY");
export const TAVILY_API_KEY = readKey("TAVILY_API_KEY");
export const TAVILY_INCLUDE_DOMAINS = readList("TAVILY_INCLUDE_DOMAINS");
export const SERAPI_API_KEY = readKey("SERAPI_API_KEY");
export const ANALYTICS_WRITE_KEY = readKey("ANALYTICS_WRITE_KEY");
export const INGEST_WEBHOOK_SECRET = readKey("INGEST_WEBHOOK_SECRET");

export const features = {
  typesense: Boolean(TYPESENSE_HOST && TYPESENSE_API_KEY),
  tavilyEnrichment: Boolean(TAVILY_API_KEY),
  serapiEnrichment: Boolean(SERAPI_API_KEY),
};
