import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { articles } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import { runPipeline } from '@/lib/ingest/pipeline';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const keyword = searchParams.get('keyword');

  try {
    // Nếu có keyword -> chạy pipeline tìm tin (giả lập)
    if (keyword) {
      await runPipeline('user-search', [
        {
          title: `Kết quả cho "${keyword}" (demo)`,
          url: `https://example.com/${keyword}`,
          publishedAt: new Date(),
        },
      ]);
    }

    // Lấy tin mới nhất
    const allArticles = await db
      .select()
      .from(articles)
      .orderBy(desc(articles.publishedAt))
      .limit(20);

    return NextResponse.json(allArticles);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
