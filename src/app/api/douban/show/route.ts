import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import {
  buildShowRecommendUrl,
  DoubanRecommendItem,
  isValidShowFilter,
  toDoubanItems,
} from '@/lib/doubanShow';
import { DoubanResult } from '@/lib/types';

export const runtime = 'edge';

// 综艺按类型 / 地区筛选（豆瓣推荐接口）
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const genre = searchParams.get('genre') || '全部';
  const region = searchParams.get('region') || '全部';
  const pageLimit = parseInt(searchParams.get('limit') || '25');
  const pageStart = parseInt(searchParams.get('start') || '0');

  if (!isValidShowFilter(genre, region)) {
    return NextResponse.json(
      { error: '不支持的综艺类型或地区' },
      { status: 400 }
    );
  }

  if (!(pageLimit >= 1 && pageLimit <= 100) || !(pageStart >= 0)) {
    return NextResponse.json(
      { error: 'limit 必须在 1-100 之间，start 不能小于 0' },
      { status: 400 }
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(
      buildShowRecommendUrl(genre, region, pageStart, pageLimit),
      {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          Referer: 'https://movie.douban.com/',
          Accept: 'application/json, text/plain, */*',
        },
      }
    );
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const doubanData: { items?: DoubanRecommendItem[] } = await response.json();

    const result: DoubanResult = {
      code: 200,
      message: '获取成功',
      list: toDoubanItems(doubanData.items || []),
    };

    const cacheTime = await getCacheTime();
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
      },
    });
  } catch (error) {
    clearTimeout(timeoutId);
    return NextResponse.json(
      { error: '获取豆瓣数据失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
