/**
 * Drizzle schema — PHẢI khớp 1:1 với drizzle/0001_init.sql.
 * Không thêm/bỏ cột ở đây mà không sửa migration tương ứng.
 */
import {
  bigserial,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const sources = pgTable("sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  trustScore: numeric("trust_score", { precision: 4, scale: 3 })
    .notNull()
    .default("0.500"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const articles = pgTable(
  "articles",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    snippet: text("snippet"),
    content: text("content"),
    category: text("category").notNull().default("general"),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    imageUrl: text("image_url"),
    author: text("author"),
    canonicalUrl: text("canonical_url").notNull(),
    urlHash: text("url_hash").notNull(),
    titleNormalized: text("title_normalized").notNull(),
    contentHash: text("content_hash").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    // `fts` là cột GENERATED trong Postgres — không khai báo ở đây, chỉ đọc qua raw SQL nếu cần.
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    publishedAtIdx: index("articles_published_at_idx").on(t.publishedAt.desc()),
    titleNormIdx: index("articles_title_norm_idx").on(
      t.titleNormalized,
      t.publishedAt.desc()
    ),
    contentHashIdx: index("articles_content_hash_idx").on(t.contentHash),
    sourceIdIdx: index("articles_source_id_idx").on(t.sourceId),
    urlHashUnique: uniqueIndex("articles_url_hash_unique").on(t.urlHash),
  })
);

export const searchLogs = pgTable(
  "search_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    query: text("query").notNull(),
    resultCount: integer("result_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    createdAtIdx: index("search_logs_created_at_idx").on(t.createdAt.desc()),
  })
);

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
export type SearchLog = typeof searchLogs.$inferSelect;
export type NewSearchLog = typeof searchLogs.$inferInsert;
