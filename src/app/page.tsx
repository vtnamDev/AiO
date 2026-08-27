'use client';

import { useState, useEffect } from 'react';

type Article = {
  id: number;
  title: string;
  description: string | null;
  url: string;
  source: string;
  publishedAt: string;
};

export default function Home() {
  const [keyword, setKeyword] = useState('');
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNews = async (kw?: string) => {
    setLoading(true);
    const url = kw ? `/api/news?keyword=${encodeURIComponent(kw)}` : '/api/news';
    const res = await fetch(url);
    const data = await res.json();
    setArticles(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchNews();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (keyword.trim()) fetchNews(keyword.trim());
  };

  return (
    <main style={{ padding: '2rem' }}>
      <h1>📰 News Aggregator</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Nhập từ khóa tin tức..."
          style={{ padding: '8px', width: '300px' }}
        />
        <button type="submit" style={{ marginLeft: '8px', padding: '8px 16px' }}>
          Tìm tin
        </button>
      </form>

      {loading && <p>Đang tải...</p>}

      <ul style={{ marginTop: '2rem' }}>
        {articles.map((item) => (
          <li key={item.id} style={{ marginBottom: '1rem' }}>
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              <strong>{item.title}</strong>
            </a>
            <div style={{ fontSize: '0.9rem', color: '#666' }}>
              {item.source} – {new Date(item.publishedAt).toLocaleString()}
            </div>
            {item.description && <p>{item.description}</p>}
          </li>
        ))}
      </ul>
    </main>
  );
}
