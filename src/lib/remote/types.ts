// 电视遥控协议的类型与校验，详见 docs/tv-remote.md

export interface RemoteEpisode {
  index: number;
  label: string;
}

/** 播放页可切换的播放源（换源列表的一项）。 */
export interface RemoteSource {
  source: string; // 源 key，如 "bfzy"、"kazumi_mxdm"
  id: string;
  name: string; // 源显示名
  episodes: number; // 该源的集数
  quality?: string; // 测速得到的清晰度，如 "1080p"
  speed?: string; // 测速得到的加载速度，如 "2.3 MB/s"
}

export interface RemoteStatus {
  path: string;
  page: 'play' | 'other';
  title?: string;
  year?: string;
  source?: string;
  id?: string;
  poster?: string;
  episodeIndex?: number;
  totalEpisodes?: number;
  episodes?: RemoteEpisode[];
  sources?: RemoteSource[]; // 仅在列表变化时上报，服务端沿用
  sourcesLoading?: boolean; // 播放页正在搜索可用源
  currentTime?: number;
  duration?: number;
  paused?: boolean;
  fullscreen?: boolean;
  updatedAt: number;
}

export interface RemoteDevice {
  deviceId: string;
  name: string;
  online: boolean;
  /** 连接还在但很久没上报：电视多半进入了屏保或 APP 在后台，命令要等它回到前台才执行。 */
  idle?: boolean;
  lastSeen: number;
  status: RemoteStatus | null;
}

export type RemoteCommand =
  | { type: 'toggle' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; time: number }
  | { type: 'seekBy'; delta: number }
  | { type: 'episode'; index: number }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'fullscreen'; on: boolean }
  | { type: 'navigate'; url: string }
  | { type: 'source'; source: string; id: string } // 换源
  | { type: 'home' };

export const MAX_SEEK_SECONDS = 86400;
export const MAX_SEEK_DELTA = 600;
export const MAX_EPISODE_INDEX = 9999;
export const MAX_NAVIGATE_URL_LENGTH = 2048;
export const MAX_EPISODES = 500;
export const MAX_EPISODE_LABEL = 80;
export const MAX_DEVICE_NAME = 40;
export const MAX_STATUS_TEXT = 500;
export const MAX_SOURCES = 100;
// source / id 的最大长度：Kazumi 的 id 是 base64 编码的 JSON，常见 300 字符以上
export const MAX_SOURCE_KEY = 1024;
export const MAX_SOURCE_TEXT = 40; // 源名称、清晰度、速度的最大长度
export const DEFAULT_DEVICE_NAME = 'Blazing TV';

const DEVICE_ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
// eslint-disable-next-line no-control-regex
const HAS_CONTROL_CHAR = /[\u0000-\u001f\u007f-\u009f]/;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInRange(value: unknown, min: number, max: number): value is number {
  return isFiniteNumber(value) && value >= min && value <= max;
}

export function isValidDeviceId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value);
}

export function sanitizeDeviceName(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_DEVICE_NAME;
  const cleaned = value.replace(CONTROL_CHARS, '').trim();
  const name = cleaned.slice(0, MAX_DEVICE_NAME).trim();
  return name || DEFAULT_DEVICE_NAME;
}

export function isSafeNavigateUrl(url: unknown): url is string {
  return (
    typeof url === 'string' &&
    url.length <= MAX_NAVIGATE_URL_LENGTH &&
    url.startsWith('/') &&
    !url.startsWith('//') &&
    !url.includes('\\') &&
    !HAS_CONTROL_CHAR.test(url)
  );
}

/** 换源命令里的 source / id：非空、长度有限、不含控制字符。 */
export function isSafeSourceKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_SOURCE_KEY &&
    !HAS_CONTROL_CHAR.test(value)
  );
}

const SIMPLE_COMMANDS = new Set([
  'toggle',
  'play',
  'pause',
  'next',
  'prev',
  'home',
]);

function parseParamCommand(input: UnknownRecord): RemoteCommand | null {
  switch (input.type) {
    case 'seek':
      return isInRange(input.time, 0, MAX_SEEK_SECONDS)
        ? { type: 'seek', time: input.time }
        : null;
    case 'seekBy':
      return isInRange(input.delta, -MAX_SEEK_DELTA, MAX_SEEK_DELTA)
        ? { type: 'seekBy', delta: input.delta }
        : null;
    case 'episode':
      return isInRange(input.index, 0, MAX_EPISODE_INDEX) &&
        Number.isInteger(input.index)
        ? { type: 'episode', index: input.index }
        : null;
    case 'fullscreen':
      return typeof input.on === 'boolean'
        ? { type: 'fullscreen', on: input.on }
        : null;
    case 'navigate':
      return isSafeNavigateUrl(input.url)
        ? { type: 'navigate', url: input.url }
        : null;
    case 'source':
      return isSafeSourceKey(input.source) && isSafeSourceKey(input.id)
        ? { type: 'source', source: input.source, id: input.id }
        : null;
    default:
      return null;
  }
}

export function parseRemoteCommand(input: unknown): RemoteCommand | null {
  if (!isRecord(input) || typeof input.type !== 'string') return null;
  if (SIMPLE_COMMANDS.has(input.type)) {
    return { type: input.type } as RemoteCommand;
  }
  return parseParamCommand(input);
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.replace(CONTROL_CHARS, '').slice(0, max);
}

function sanitizeEpisodes(value: unknown): RemoteEpisode[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const episodes: RemoteEpisode[] = [];
  for (const item of value.slice(0, MAX_EPISODES)) {
    if (!isRecord(item)) continue;
    if (!isInRange(item.index, 0, MAX_EPISODE_INDEX)) continue;
    if (!Number.isInteger(item.index)) continue;
    const label = cleanText(item.label, MAX_EPISODE_LABEL);
    if (label === undefined) continue;
    episodes.push({ index: item.index, label });
  }
  return episodes;
}

function sanitizeSource(item: unknown): RemoteSource | null {
  if (!isRecord(item)) return null;
  if (!isSafeSourceKey(item.source) || !isSafeSourceKey(item.id)) return null;
  if (!isInRange(item.episodes, 0, MAX_EPISODE_INDEX + 1)) return null;
  const quality = cleanText(item.quality, MAX_SOURCE_TEXT);
  const speed = cleanText(item.speed, MAX_SOURCE_TEXT);
  return {
    source: item.source,
    id: item.id,
    name: cleanText(item.name, MAX_SOURCE_TEXT) || item.source,
    episodes: Math.floor(item.episodes),
    ...(quality ? { quality } : {}),
    ...(speed ? { speed } : {}),
  };
}

function sanitizeSources(value: unknown): RemoteSource[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sources: RemoteSource[] = [];
  for (const item of value.slice(0, MAX_SOURCES)) {
    const source = sanitizeSource(item);
    if (source) sources.push(source);
  }
  return sources;
}

function sanitizeNumbers(input: UnknownRecord): Partial<RemoteStatus> {
  const result: Partial<RemoteStatus> = {};
  if (isFiniteNumber(input.episodeIndex)) {
    result.episodeIndex = input.episodeIndex;
  }
  if (isFiniteNumber(input.totalEpisodes)) {
    result.totalEpisodes = input.totalEpisodes;
  }
  if (isFiniteNumber(input.currentTime)) result.currentTime = input.currentTime;
  if (isFiniteNumber(input.duration)) result.duration = input.duration;
  return result;
}

function sanitizeStrings(input: UnknownRecord): Partial<RemoteStatus> {
  const result: Partial<RemoteStatus> = {};
  const keys = ['title', 'year', 'poster'] as const;
  for (const key of keys) {
    const text = cleanText(input[key], MAX_STATUS_TEXT);
    if (text !== undefined) result[key] = text;
  }
  // source / id 不截断（截断后就对不上源了），超长直接丢弃
  if (isSafeSourceKey(input.source)) result.source = input.source;
  if (isSafeSourceKey(input.id)) result.id = input.id;
  return result;
}

function sanitizeFlags(input: UnknownRecord): Partial<RemoteStatus> {
  const result: Partial<RemoteStatus> = {};
  if (typeof input.paused === 'boolean') result.paused = input.paused;
  if (typeof input.fullscreen === 'boolean') {
    result.fullscreen = input.fullscreen;
  }
  if (typeof input.sourcesLoading === 'boolean') {
    result.sourcesLoading = input.sourcesLoading;
  }
  return result;
}

export function sanitizeStatus(input: unknown): RemoteStatus | null {
  if (!isRecord(input)) return null;
  const path = cleanText(input.path, MAX_NAVIGATE_URL_LENGTH);
  if (!path) return null;
  if (input.page !== 'play' && input.page !== 'other') return null;
  if (!isFiniteNumber(input.updatedAt)) return null;

  const episodes = sanitizeEpisodes(input.episodes);
  const sources = sanitizeSources(input.sources);
  return {
    path,
    page: input.page,
    ...sanitizeStrings(input),
    ...sanitizeNumbers(input),
    ...sanitizeFlags(input),
    ...(episodes ? { episodes } : {}),
    ...(sources ? { sources } : {}),
    updatedAt: input.updatedAt,
  };
}
