// NAS library (Blazing NAS nas-bridge on the Mac mini): browse-by-poster helpers.
// The bridge is configured as a normal CMS source; its /library endpoint lives next to the CMS path.

export const NAS_SOURCE_KEY = 'blazing-nas';
export const NAS_TYPES = ['movie', 'tv'] as const;
export type NasType = (typeof NAS_TYPES)[number];
const MAX_PAGE = 1000;
const CMS_SUFFIX = /\/api\.php\/provide\/vod\/?$/;

export interface NasCard {
  vod_id: string;
  vod_name: string;
  /** Series name for seasons; what the play page should search for. */
  search_title: string;
  vod_pic: string;
  vod_year: string;
  vod_remarks: string;
  episodes: number;
}

export interface NasLibrary {
  page: number;
  pagecount: number;
  total: number;
  list: NasCard[];
}

export class NasInputError extends Error {}

export function parseNasQuery(params: URLSearchParams): {
  type: NasType;
  page: number;
} {
  const type = params.get('type') || 'movie';
  const page = Number(params.get('page') || '1');
  if (!(NAS_TYPES as readonly string[]).includes(type))
    throw new NasInputError('type 只能是 movie 或 tv');
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE)
    throw new NasInputError('page 必须是 1-1000 的整数');
  return { type: type as NasType, page };
}

/** Turn the configured CMS api URL into the bridge's /library URL. */
export function nasLibraryUrl(api: string, type: NasType, page: number) {
  if (!CMS_SUFFIX.test(api))
    throw new Error('NAS 片源地址不是 nas-bridge 的 CMS 接口');
  const base = api.replace(CMS_SUFFIX, '');
  return `${base}/library?${new URLSearchParams({
    type,
    page: String(page),
  })}`;
}

const VOD_ID = /^(m\.[0-9a-f]{32}|s\.[0-9a-f]{32}\.[0-9a-f]{32})$/;

function toCard(value: unknown): NasCard | null {
  const card = value as Record<string, unknown> | null;
  if (
    !card ||
    typeof card.vod_id !== 'string' ||
    !VOD_ID.test(card.vod_id) ||
    typeof card.vod_name !== 'string'
  )
    return null;
  const text = (key: string) =>
    typeof card[key] === 'string' ? (card[key] as string) : '';
  const year = text('vod_year');
  const poster = text('vod_pic');
  const episodes = Number(card.episodes);
  return {
    vod_id: card.vod_id,
    vod_name: card.vod_name,
    search_title: text('search_title') || card.vod_name,
    vod_pic: /^https?:\/\//.test(poster) ? poster : '',
    vod_year: /^\d{4}$/.test(year) ? year : '',
    vod_remarks: text('vod_remarks'),
    episodes: Number.isInteger(episodes) && episodes > 0 ? episodes : 1,
  };
}

/** Keep only well-formed cards so a bad upstream entry cannot break the page. */
export function sanitizeLibrary(data: unknown): NasLibrary {
  const raw = (data || {}) as Partial<NasLibrary>;
  const list = Array.isArray(raw.list) ? raw.list : [];
  return {
    page: Number(raw.page) || 1,
    pagecount: Number(raw.pagecount) || 1,
    total: Number(raw.total) || 0,
    list: list.map(toCard).filter((card): card is NasCard => card !== null),
  };
}
