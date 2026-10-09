import { NextResponse } from 'next/server';

import { getCacheTime, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { isKazumiApi } from '@/lib/kazumi';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'edge';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const kazumiOnly = searchParams.get('scope') === 'kazumi';

  if (!query) {
    const cacheTime = await getCacheTime();
    return NextResponse.json(
      { results: [] },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        },
      }
    );
  }

  const config = await getConfig();
  const apiSites = config.SourceConfig.filter(
    (site) => !site.disabled && (!kazumiOnly || isKazumiApi(site.api))
  );
  const searchPromises = apiSites.map((site) => searchFromApi(site, query));

  try {
    const results = await Promise.all(searchPromises);
    let flattenedResults = results.flat();
    if (!config.SiteConfig.DisableYellowFilter) {
      flattenedResults = flattenedResults.filter((result) => {
        const typeName = result.type_name || '';
        return !yellowWords.some((word: string) => typeName.includes(word));
      });
    }
    const cacheTime = await getCacheTime();

    return NextResponse.json(
      {
        results: flattenedResults,
        ...(kazumiOnly ? { sourcesConfigured: apiSites.length > 0 } : {}),
      },
      {
        headers: {
          'Cache-Control': kazumiOnly
            ? 'private, no-store'
            : `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          ...(!kazumiOnly
            ? {
                'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
                'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
              }
            : {}),
        },
      }
    );
  } catch (error) {
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}
