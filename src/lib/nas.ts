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

// ---------------------------------------------------------------- Jellyfin
// NAS films play in Jellyfin's own web player by default (real subtitle tracks,
// no burn-in); nas-bridge's transcoding stays as the fallback.

const HEX32 = /^[0-9a-f]{32}$/;
const NAS_BRIDGE_PORT = '8095';
const JELLYFIN_PORT = '8096';

/** Jellyfin's address: JELLYFIN_URL if set, else the NAS source host on port 8096. */
export function jellyfinBaseUrl(
  nasApi: string | undefined,
  override?: string
): string {
  const pick = (override || '').trim();
  try {
    if (pick) {
      const url = new URL(pick);
      if (!/^https?:$/.test(url.protocol)) return '';
      return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    }
    if (!nasApi) return '';
    const url = new URL(nasApi);
    if (!/^https?:$/.test(url.protocol)) return '';
    if (url.port && url.port !== NAS_BRIDGE_PORT) return '';
    url.port = JELLYFIN_PORT;
    return url.origin;
  } catch {
    return '';
  }
}

function decodeBase64Url(text: string): string {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
}

/**
 * Jellyfin item id inside a nas-bridge play link `/play/{token}.m3u8`.
 * The token is base64url(32-byte HMAC + JSON {"kind":"play","item":id}); the
 * signature is not checked here, the id only builds a Jellyfin link.
 */
export function jellyfinItemFromPlayUrl(playUrl: string): string {
  const match = /\/play\/([A-Za-z0-9_-]+)\.m3u8$/.exec(playUrl || '');
  if (!match) return '';
  try {
    const raw = decodeBase64Url(match[1]);
    if (raw.length <= 32) return '';
    const body = JSON.parse(raw.slice(32));
    return body && body.kind === 'play' && HEX32.test(body.item)
      ? body.item
      : '';
  } catch {
    return '';
  }
}

/** Jellyfin item for a NAS card: the movie, or the season of a season card. */
export function jellyfinItemFromVodId(vodId: string): string {
  const movie = /^m\.([0-9a-f]{32})$/.exec(vodId || '');
  if (movie) return movie[1];
  const season = /^s\.[0-9a-f]{32}\.([0-9a-f]{32})$/.exec(vodId || '');
  return season ? season[1] : '';
}

/** Jellyfin web's details page for an item; its 播放 button starts playback. */
export function jellyfinDetailsUrl(base: string, itemId: string): string {
  if (!base || !HEX32.test(itemId)) return '';
  return `${base}/web/#/details?id=${itemId}`;
}
