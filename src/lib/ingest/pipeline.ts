import { db } from '../db';
import { articles, sources } from '../db/schema';
import { eq } from 'drizzle-orm';

type RowWithId = { id: number };

function extractRows(result: any): RowWithId[] {
  if (!result || !Array.isArray(result)) return [];
  return result.map((row: any) => ({ id: Number(row.id) }));
}

export async function getOrCreateSource(
  sourceName: string,
  opts?: { sourceName?: string }
): Promise<number | null> {
  const found = await db
    .select()
    .from(sources)
    .where(eq(sources.name, sourceName))
    .limit(1);

  const rows = extractRows(found);
  if (rows.length > 0) return (rows[0] as RowWithId).id;

  if (!opts?.sourceName) return null;

  const [newSource] = await db
    .insert(sources)
    .values({ name: sourceName })
    .returning({ id: sources.id });

  return newSource?.id ?? null;
}

export async function runPipeline(
  sourceName: string,
  articlesData: Array<{ title: string; url: string; publishedAt: Date }>
) {
  const sourceId = await getOrCreateSource(sourceName, { sourceName });
  if (!sourceId) throw new Error('Cannot create source');

  for (const item of articlesData) {
    await db.insert(articles).values({
      title: item.title,
      url: item.url,
      publishedAt: item.publishedAt,
      source: sourceName,
    });
  }

  return { sourceId, count: articlesData.length };
}
