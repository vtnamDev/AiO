/**
 * Drizzle + pg client — server-side only.
 * Lazy singleton: KHÔNG tạo Pool khi module load → build/CI không cần DATABASE_URL,
 * chỉ fail rõ ràng tại thời điểm thực sự gọi query nếu thiếu URL.
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { DATABASE_URL } from "@/lib/config/env";

type Db = NodePgDatabase<typeof schema>;

let pool: Pool | null = null;
let instance: Db | null = null;

function requireUrl(): string {
  if (!DATABASE_URL) {
    throw new Error("[db] DATABASE_URL chưa được cấu hình (.env)");
  }
  return DATABASE_URL;
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: requireUrl(),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    // Ngăn process treo/crash do idle client lỗi
    pool.on("error", (err) => {
      console.error("[db] idle client error:", err.message);
    });
  }
  return pool;
}

function getDb(): Db {
  if (!instance) {
    instance = drizzle(getPool(), { schema });
  }
  return instance;
}

/**
 * Proxy để repo giữ cú pháp `db.select()...`, nhưng Pool/drizzle chỉ được
 * khởi tạo lần đầu có truy cập thuộc tính (lazy) — không crash lúc import.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value;
  },
});

/** Đóng sạch kết nối — dùng cho scripts/tests */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    instance = null;
  }
}
