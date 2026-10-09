// Kazumi's default popular page uses Bangumi's trending anime subjects.
// Keep metadata separate from playback: Bangumi IDs are not CMS video IDs.
export const KAZUMI_TAGS = [
  '日常',
  '原创',
  '校园',
  '搞笑',
  '奇幻',
  '百合',
  '恋爱',
  '悬疑',
  '热血',
  '后宫',
  '机战',
  '轻改',
  '偶像',
  '治愈',
  '异世界',
] as const;

export interface KazumiSubject {
  id: number;
  title: string;
  originalTitle: string;
  poster: string;
  score: string;
  info: string;
}

export interface KazumiCatalog {
  items: KazumiSubject[];
  page: number;
  hasMore: boolean;
}

export class CatalogInputError extends Error {}

const PAGE_SIZE = 24;
const USER_AGENT = 'BlazingP/MoonTV (https://github.com/BlazingP/MoonTV)';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, limit = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function normalizeSubject(value: unknown): KazumiSubject | null {
  const item = record(value);
  if (
    !Number.isSafeInteger(item.id) ||
    Number(item.id) <= 0 ||
    item.type !== 2 ||
    item.nsfw === true
  )
    return null;
  const originalTitle = text(item.name);
  const title = text(item.nameCN) || text(item.name_cn) || originalTitle;
  if (!title) return null;
  const images = record(item.images);
  let poster = text(images.common || images.large || images.medium, 500);
  // The browser only receives Bangumi covers, never an upstream-supplied URL
  // to an arbitrary host or executable scheme.
  try {
    const url = new URL(poster);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'lain.bgm.tv' ||
      url.username ||
      url.password ||
      url.port
    )
      poster = '';
  } catch {
    poster = '';
  }
  const score = record(item.rating).score;
  return {
    id: Number(item.id),
    title,
    originalTitle,
    poster,
    score:
      typeof score === 'number' && score > 0 && score <= 10
        ? score.toFixed(1)
        : '',
    info:
      text(item.info) ||
      [text(item.date), text(item.platform)].filter(Boolean).join(' · '),
  };
}

export async function fetchKazumiCatalog(
  params: URLSearchParams,
  fetcher: typeof fetch = fetch
): Promise<KazumiCatalog> {
  const pageText = params.get('page') || '1';
  const page = Number(pageText);
  const tag = (params.get('tag') || '').trim();
  const query = (params.get('q') || '').trim();
  if (
    !/^\d+$/.test(pageText) ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 42 ||
    query.length > 100 ||
    (tag && !KAZUMI_TAGS.some((value) => value === tag))
  ) {
    throw new CatalogInputError('无效的页码、分类或搜索词');
  }
  const offset = (page - 1) * PAGE_SIZE;
  const trending = !tag && !query;
  const url = trending
    ? `https://next.bgm.tv/p1/trending/subjects?type=2&limit=${PAGE_SIZE}&offset=${offset}`
    : `https://api.bgm.tv/v0/search/subjects?limit=${PAGE_SIZE}&offset=${offset}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetcher(url, {
      method: trending ? 'GET' : 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      ...(trending
        ? {}
        : {
            body: JSON.stringify({
              keyword: query,
              sort: query ? 'match' : 'rank',
              filter: {
                type: [2],
                tag: tag ? [tag] : [],
                nsfw: false,
                ...(!query ? { rank: ['>0', '<=99999'] } : {}),
              },
            }),
          }),
      signal: controller.signal,
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Bangumi request failed');
    const data = record(await response.json());
    if (!Array.isArray(data.data)) throw new Error('Invalid Bangumi response');
    const seen = new Set<number>();
    const items = data.data.slice(0, PAGE_SIZE).flatMap((value) => {
      const item = normalizeSubject(trending ? record(value).subject : value);
      if (!item || seen.has(item.id)) return [];
      seen.add(item.id);
      return [item];
    });
    return {
      items,
      page,
      hasMore:
        page < 42 &&
        data.data.length >= PAGE_SIZE &&
        (typeof data.total !== 'number' ||
          offset + data.data.length < data.total),
    };
  } finally {
    clearTimeout(timeout);
  }
}
