import { NextResponse } from 'next/server';

import {
  CatalogInputError,
  fetchKazumiCatalog,
  KazumiCatalog,
} from '@/lib/kazumi-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Bound the cache; searches must not grow server memory indefinitely.
const cache = new Map<string, { expires: number; data: KazumiCatalog }>();

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const canonical = new URLSearchParams();
  for (const name of ['page', 'tag', 'q'])
    canonical.set(name, params.get(name) || '');
  const key = canonical.toString();
  try {
    const cached = cache.get(key);
    let data = cached && cached.expires > Date.now() ? cached.data : undefined;
    if (!data) {
      data = await fetchKazumiCatalog(canonical);
      cache.delete(key);
      if (cache.size >= 64) cache.delete(cache.keys().next().value as string);
      cache.set(key, { expires: Date.now() + 300000, data });
    }
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'private, max-age=300' },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof CatalogInputError
            ? error.message
            : '番剧目录暂时无法加载，请稍后重试。',
      },
      {
        status: error instanceof CatalogInputError ? 400 : 502,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
