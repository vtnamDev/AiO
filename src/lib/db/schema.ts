import { pgTable, serial, text, timestamp, varchar, index } from "drizzle-orm/pg-core";

export const articles = pgTable(
  "articles",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    titleNormalized: text("title_normalized"),
    description: text("description"),
    url: varchar("url", { length: 2048 }).notNull().unique(),
    source: text("source").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    publishedAtIdx: index("articles_published_at_idx").on(t.publishedAt),
    titleNormIdx: index("articles_title_norm_idx").on(t.titleNormalized, t.publishedAt),
  })
);

export const sources = pgTable(
  "sources",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    nameIdx: index("sources_name_idx").on(t.name),
  })
);
