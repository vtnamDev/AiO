/**
 * Shared domain types — dùng bởi search, repo, ranker.
 * Không phụ thuộc framework.
 */

export interface SearchHit {
  id: string;
  title: string;
  snippet: string;
  category: string;
  publishedAt: string;
  imageUrl?: string;
  author?: string;
  canonicalUrl: string;
  sourceId: string;
}

export interface ArticleCard {
  id: string;
  title: string;
  snippet: string;
  content?: string;
  category: string;
  publishedAt: string;
  imageUrl?: string;
  author?: string;
  canonicalUrl: string;
  sourceId: string;
  sourceName: string;
  sourceTrust: number;
}
