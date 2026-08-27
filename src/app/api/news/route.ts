import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { articles } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import { runPipeline } from '@/lib/ingest/pipeline';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const keyword = searchParams.get('keyword');

    // Kiểm tra kết nối DB trước
    try {
      await db.select().from(articles).limit(1);
    } catch (dbErr) {
      console.error('DB Connection Error:', dbErr);
      return NextResponse.json(
        { error: 'Không thể kết nối database. Kiểm tra DATABASE_URL' },
        { status: 500 }
      );
    }

    if (keyword) {
      await runPipeline('user-search', [
        {
          title: `📌 Kết quả cho "${keyword}" (demo)`,
          url: `https://example.com/search?q=${keyword}`,
          publishedAt: new Date(),
        },
      ]);
    }

    const allArticles = await db
      .select()
      .from(articles)
      .orderBy(desc(articles.publishedAt))
      .limit(30);

    return NextResponse.json(allArticles);
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Lỗi không xác định' },
      { status: 500 }
    );
  }
}
