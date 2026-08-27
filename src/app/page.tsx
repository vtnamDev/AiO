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

export default function HomePage() {
  const [keyword, setKeyword] = useState('');
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNews = async (kw?: string) => {
    setLoading(true);
    try {
      const url = kw ? `/api/news?keyword=${encodeURIComponent(kw)}` : '/api/news';
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Lỗi tải tin tức');
      }
      const data = await res.json();
      setArticles(data);
    } catch (err) {
      alert('❌ Lỗi: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (keyword.trim()) fetchNews(keyword.trim());
  };

  return (
    <main style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1>📰 News Aggregator</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Nhập từ khóa tin tức..."
          style={{ padding: '8px', width: '70%' }}
        />
        <button type="submit" style={{ padding: '8px 16px', marginLeft: '8px' }}>
          Tìm tin
        </button>
      </form>

      {loading && <p>⏳ Đang tải...</p>}

      <ul style={{ marginTop: '2rem', listStyle: 'none', padding: 0 }}>
        {articles.map((item) => (
          <li key={item.id} style={{ marginBottom: '1.5rem', borderBottom: '1px solid #ddd', paddingBottom: '1rem' }}>
            <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>
              {item.title}
            </a>
            <div style={{ fontSize: '0.9rem', color: '#666' }}>
              {item.source} – {new Date(item.publishedAt).toLocaleString('vi-VN')}
            </div>
            {item.description && <p style={{ marginTop: '0.5rem' }}>{item.description}</p>}
          </li>
        ))}
      </ul>
    </main>
  );
}
