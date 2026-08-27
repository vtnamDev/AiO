-- Migration khởi tạo schema. Khớp src/lib/db/schema.ts.
-- Chạy: psql "$DATABASE_URL" -f drizzle/0001_init.sql

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS sources (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  trust_score NUMERIC(4,3) NOT NULL DEFAULT 0.500 CHECK (trust_score >= 0 AND trust_score <= 1),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS articles (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  snippet       TEXT,
  content       TEXT,
  category      TEXT NOT NULL DEFAULT 'general',
  published_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  image_url     TEXT,
  author        TEXT,
  canonical_url TEXT NOT NULL,
  url_hash      TEXT NOT NULL UNIQUE,
  title_normalized TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  source_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  fts           tsvector GENERATED ALWAYS AS (
                  setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
                  setweight(to_tsvector('simple', coalesce(snippet, '')), 'B')
                ) STORED,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS articles_published_at_idx ON articles (published_at DESC);
CREATE INDEX IF NOT EXISTS articles_title_trgm_idx   ON articles USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS articles_fts_idx          ON articles USING gin (fts);
CREATE INDEX IF NOT EXISTS articles_title_norm_idx   ON articles (title_normalized, published_at DESC);
CREATE INDEX IF NOT EXISTS articles_content_hash_idx ON articles (content_hash);
CREATE INDEX IF NOT EXISTS articles_source_id_idx    ON articles (source_id);

CREATE TABLE IF NOT EXISTS search_logs (
  id           BIGSERIAL PRIMARY KEY,
  query        TEXT NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS search_logs_created_at_idx ON search_logs (created_at DESC);
-- Hết migration.
