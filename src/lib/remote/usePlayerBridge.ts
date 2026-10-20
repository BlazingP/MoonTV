// 播放页控制接口：把现有播放器能力挂到 window.__moontvPlayer，供 Blazing TV 的 tv-remote.js 调用。
import { MutableRefObject, useEffect, useRef } from 'react';

import { SearchResult } from '@/lib/types';

import { RemoteEpisode, RemoteSource, RemoteStatus } from './types';

export type MoonTvPlayerState = Omit<
  RemoteStatus,
  'path' | 'page' | 'updatedAt'
>;

export interface MoonTvPlayerApi {
  getState(): MoonTvPlayerState;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(time: number): void;
  setEpisode(index: number): void;
  next(): void;
  prev(): void;
  setFullscreen(on: boolean): void;
  setSource(source: string, id: string): void; // 只能切到当前可用源列表里的源
}

declare global {
  interface Window {
    __moontvPlayer?: MoonTvPlayerApi;
  }
}

/** 本桥接用到的 ArtPlayer 成员（ArtPlayer 没有 paused 属性，只有 playing 和底层 video）。 */
export interface PlayerLike {
  currentTime: number;
  duration: number;
  playing: boolean;
  video?: { paused: boolean } | null;
  fullscreen: boolean;
  fullscreenWeb: boolean;
  play(): unknown;
  pause(): unknown;
  toggle(): unknown;
}

export interface PlayerBridgeInfo {
  title: string;
  year: string;
  source: string;
  id: string;
  cover: string;
  detail: SearchResult | null;
  episodeIndex: number;
  sources: SearchResult[];
  sourcesLoading: boolean;
  /** 播放页的测速结果，key 为 `${source}-${id}`。 */
  videoInfo: Map<string, { quality: string; loadSpeed: string }>;
}

export interface PlayerBridgeActions {
  setEpisode: (index: number) => void;
  next: () => void;
  prev: () => void;
  changeSource: (source: string, id: string, title: string) => unknown;
}

interface PlayerBridgeInput {
  playerRef: MutableRefObject<unknown>;
  info: PlayerBridgeInfo;
  actions: PlayerBridgeActions;
}

function swallow(result: unknown): void {
  if (result instanceof Promise) {
    result.catch(() => undefined);
  }
}

function buildEpisodes(detail: SearchResult | null): RemoteEpisode[] {
  if (!detail?.episodes) return [];
  return detail.episodes.map((_, index) => ({
    index,
    label: `第 ${index + 1} 集`,
  }));
}

function buildSources(info: PlayerBridgeInfo): RemoteSource[] {
  return info.sources.map((item) => {
    const speedInfo = info.videoInfo.get(`${item.source}-${item.id}`);
    return {
      source: item.source,
      id: item.id,
      name: item.source_name || item.source,
      episodes: item.episodes?.length || 0,
      ...(speedInfo?.quality ? { quality: speedInfo.quality } : {}),
      ...(speedInfo?.loadSpeed ? { speed: speedInfo.loadSpeed } : {}),
    };
  });
}

/** 换源期间忽略新的换源请求，避免两次换源并发、把播放记录和片头片尾配置留在中间源上。 */
let sourceChangeInFlight = false;

/**
 * 只允许切到当前可用源列表里的源（新命令唯一的权限边界），
 * 复用播放页的换源流程（保存进度、换集数等）。返回是否真的发起了换源。
 */
export function changeSource(
  input: Pick<PlayerBridgeInput, 'info' | 'actions'>,
  source: string,
  id: string
): boolean {
  const { info, actions } = input;
  if (sourceChangeInFlight) return false;
  if (source === info.source && id === info.id) return false;
  const target = info.sources.find((s) => s.source === source && s.id === id);
  if (!target) return false;
  sourceChangeInFlight = true;
  Promise.resolve(actions.changeSource(source, id, target.title))
    .catch(() => undefined)
    .finally(() => {
      sourceChangeInFlight = false;
    });
  return true;
}

/** 暂停状态以底层 video 为准；playing 在缓冲时也是 false，只作兜底。 */
function isPaused(player: PlayerLike): boolean {
  if (player.video && typeof player.video.paused === 'boolean') {
    return player.video.paused;
  }
  return !player.playing;
}

export function buildState(
  player: PlayerLike | null,
  info: PlayerBridgeInfo
): MoonTvPlayerState {
  const duration = player?.duration;
  const currentTime = player?.currentTime;
  return {
    title: info.title || info.detail?.title || undefined,
    year: info.year || info.detail?.year || undefined,
    source: info.source || undefined,
    id: info.id || undefined,
    poster: info.detail?.poster || info.cover || undefined,
    episodeIndex: info.episodeIndex,
    totalEpisodes: info.detail?.episodes?.length || 0,
    episodes: buildEpisodes(info.detail),
    sources: buildSources(info),
    sourcesLoading: info.sourcesLoading,
    currentTime: Number.isFinite(currentTime) ? currentTime : undefined,
    duration:
      Number.isFinite(duration) && (duration as number) > 0
        ? duration
        : undefined,
    paused: player ? isPaused(player) : undefined,
    fullscreen: player
      ? Boolean(player.fullscreen || player.fullscreenWeb)
      : undefined,
  };
}

function clampSeek(time: number, duration: number): number {
  const lower = Math.max(0, time);
  if (!Number.isFinite(duration) || duration <= 1) return lower;
  return Math.min(lower, duration - 1);
}

function createApi(
  getPlayer: () => PlayerLike | null,
  getLatest: () => PlayerBridgeInput
): MoonTvPlayerApi {
  return {
    getState: () => buildState(getPlayer(), getLatest().info),
    play: () => swallow(getPlayer()?.play()),
    pause: () => swallow(getPlayer()?.pause()),
    toggle: () => swallow(getPlayer()?.toggle()),
    seek: (time) => {
      const player = getPlayer();
      if (!player || !Number.isFinite(time)) return;
      player.currentTime = clampSeek(time, player.duration);
    },
    setEpisode: (index) => getLatest().actions.setEpisode(index),
    next: () => getLatest().actions.next(),
    prev: () => getLatest().actions.prev(),
    setFullscreen: (on) => {
      const player = getPlayer();
      if (!player) return;
      // 远程命令没有用户手势，浏览器会拒绝真正的全屏；电视本来就满屏，用网页全屏即可
      if (on) {
        // 已在网页全屏时不要重复设置：ArtPlayer 每次进入都会保存当前尺寸，重复进入会存下全屏尺寸，退出后恢复不了
        if (!player.fullscreenWeb) player.fullscreenWeb = true;
        return;
      }
      if (player.fullscreen) player.fullscreen = false;
      player.fullscreenWeb = false;
    },
    setSource: (source, id) => {
      changeSource(getLatest(), source, id);
    },
  };
}

/** 在 window 上注册 __moontvPlayer，卸载时移除；函数始终读取最新状态。 */
export function usePlayerBridge(input: PlayerBridgeInput): void {
  const latestRef = useRef(input);
  useEffect(() => {
    latestRef.current = input;
  });

  const { playerRef } = input;
  useEffect(() => {
    const api = createApi(
      () => (playerRef.current as PlayerLike | null) ?? null,
      () => latestRef.current
    );
    window.__moontvPlayer = api;
    return () => {
      if (window.__moontvPlayer === api) delete window.__moontvPlayer;
    };
  }, [playerRef]);
}
