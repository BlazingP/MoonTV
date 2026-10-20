// 遥控中转站：进程内存中的电视连接与遥控页订阅。纯 TS，不依赖 Next。
import {
  DEFAULT_DEVICE_NAME,
  RemoteCommand,
  RemoteDevice,
  RemoteStatus,
  sanitizeDeviceName,
} from './types';

/** 向订阅者推送一个具名事件；抛错表示对端已断开。 */
export type HubSend = (event: string, data: unknown) => void;

/** 离线超过该时长的设备不再返回。 */
export const OFFLINE_TTL_MS = 10 * 60 * 1000;

/** 最多记录的设备数，防止随意的 deviceId 把内存撑大。 */
export const MAX_DEVICES = 32;

interface TvConnection {
  send: HubSend;
  close?: () => void;
}

interface DeviceEntry {
  deviceId: string;
  name: string;
  lastSeen: number;
  status: RemoteStatus | null;
  tv: TvConnection | null;
  watchers: Set<HubSend>;
}

export interface RemoteHub {
  connectTv(
    deviceId: string,
    name: string,
    send: HubSend,
    onReplaced?: () => void
  ): () => void;
  /** 只接受在线电视的上报；返回 false 表示该设备没有连接。 */
  updateStatus(deviceId: string, status: RemoteStatus): boolean;
  listDevices(): RemoteDevice[];
  getDevice(deviceId: string): RemoteDevice | null;
  subscribeStatus(deviceId: string, send: HubSend): () => void;
  sendCommand(deviceId: string, command: RemoteCommand): boolean;
}

export function offlineDevice(deviceId: string): RemoteDevice {
  return {
    deviceId,
    name: DEFAULT_DEVICE_NAME,
    online: false,
    lastSeen: 0,
    status: null,
  };
}

/** includeEpisodes 为 false 时去掉分集列表，避免每秒的进度广播都带上几百条分集。 */
function toDevice(entry: DeviceEntry, includeEpisodes = true): RemoteDevice {
  let status = entry.status;
  if (!includeEpisodes && status?.episodes) {
    const { episodes: _omitted, ...rest } = status;
    status = rest;
  }
  return {
    deviceId: entry.deviceId,
    name: entry.name,
    online: entry.tv !== null,
    lastSeen: entry.lastSeen,
    status,
  };
}

/**
 * 电视只在集数列表变化时上报 episodes；新状态缺省时沿用上一份，
 * 但仅限同一视频（source + id 相同）且仍在播放页。
 */
function withCarriedEpisodes(
  previous: RemoteStatus | null,
  next: RemoteStatus
): RemoteStatus {
  if (next.episodes !== undefined || !previous?.episodes) return next;
  if (next.page !== 'play') return next;
  if (next.source !== previous.source || next.id !== previous.id) return next;
  return { ...next, episodes: previous.episodes };
}

function safeCall(fn: (() => void) | undefined): void {
  if (!fn) return;
  try {
    fn();
  } catch {
    // 对端可能已关闭，忽略
  }
}

export function createRemoteHub(now: () => number = Date.now): RemoteHub {
  const devices = new Map<string, DeviceEntry>();

  /** 设备数到上限时，淘汰最久没活动、且没有连接和订阅的设备。 */
  const evictIdle = (): void => {
    let victim: DeviceEntry | null = null;
    for (const entry of Array.from(devices.values())) {
      if (entry.tv || entry.watchers.size > 0) continue;
      if (!victim || entry.lastSeen < victim.lastSeen) victim = entry;
    }
    if (victim) devices.delete(victim.deviceId);
  };

  const ensure = (deviceId: string, lastSeen = now()): DeviceEntry => {
    const existing = devices.get(deviceId);
    if (existing) return existing;
    if (devices.size >= MAX_DEVICES) {
      prune();
      if (devices.size >= MAX_DEVICES) evictIdle();
    }
    const created: DeviceEntry = {
      deviceId,
      name: DEFAULT_DEVICE_NAME,
      lastSeen,
      status: null,
      tv: null,
      watchers: new Set(),
    };
    devices.set(deviceId, created);
    return created;
  };

  const broadcast = (entry: DeviceEntry, includeEpisodes = true): void => {
    const device = toDevice(entry, includeEpisodes);
    for (const watcher of Array.from(entry.watchers)) {
      try {
        watcher('status', device);
      } catch {
        entry.watchers.delete(watcher);
      }
    }
  };

  const prune = (): void => {
    const cutoff = now() - OFFLINE_TTL_MS;
    devices.forEach((entry, id) => {
      if (!entry.tv && entry.watchers.size === 0 && entry.lastSeen < cutoff) {
        devices.delete(id);
      }
    });
  };

  const connectTv: RemoteHub['connectTv'] = (
    deviceId,
    name,
    send,
    onReplaced
  ) => {
    prune();
    const entry = ensure(deviceId);
    const previous = entry.tv;
    const connection: TvConnection = { send, close: onReplaced };
    entry.tv = connection;
    entry.name = sanitizeDeviceName(name);
    entry.lastSeen = now();
    if (previous) safeCall(previous.close);
    broadcast(entry);

    return () => {
      // 已被新连接取代时，旧连接断开不影响在线状态
      if (entry.tv !== connection) return;
      entry.tv = null;
      entry.lastSeen = now();
      broadcast(entry);
    };
  };

  const updateStatus: RemoteHub['updateStatus'] = (deviceId, status) => {
    const entry = devices.get(deviceId);
    if (!entry || !entry.tv) return false;
    const previousEpisodes = entry.status?.episodes;
    entry.status = withCarriedEpisodes(entry.status, status);
    entry.lastSeen = now();
    // 沿用的分集是同一个数组引用；只有列表真的变了才随广播下发
    broadcast(entry, entry.status.episodes !== previousEpisodes);
    return true;
  };

  const listDevices: RemoteHub['listDevices'] = () => {
    prune();
    const cutoff = now() - OFFLINE_TTL_MS;
    return Array.from(devices.values())
      .filter((entry) => entry.tv !== null || entry.lastSeen >= cutoff)
      .map((entry) => toDevice(entry))
      .sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return b.lastSeen - a.lastSeen;
      });
  };

  const getDevice: RemoteHub['getDevice'] = (deviceId) => {
    const entry = devices.get(deviceId);
    return entry ? toDevice(entry) : null;
  };

  const subscribeStatus: RemoteHub['subscribeStatus'] = (deviceId, send) => {
    // 仅订阅而未见过的设备 lastSeen 为 0，不会出现在设备列表里
    const entry = ensure(deviceId, 0);
    entry.watchers.add(send);
    return () => {
      entry.watchers.delete(send);
    };
  };

  const sendCommand: RemoteHub['sendCommand'] = (deviceId, command) => {
    const entry = devices.get(deviceId);
    const tv = entry?.tv;
    if (!entry || !tv) return false;
    try {
      tv.send('command', command);
      return true;
    } catch {
      // 推送失败说明连接已断开
      if (entry.tv === tv) {
        entry.tv = null;
        entry.lastSeen = now();
        broadcast(entry);
      }
      return false;
    }
  };

  return {
    connectTv,
    updateStatus,
    listDevices,
    getDevice,
    subscribeStatus,
    sendCommand,
  };
}

const HUB_KEY = Symbol.for('moontv.remote.hub');

type HubGlobal = typeof globalThis & { [HUB_KEY]?: RemoteHub };

/** 进程内单例，挂在 globalThis 上以便开发模式热更新后保留状态。 */
export function getRemoteHub(): RemoteHub {
  const holder = globalThis as HubGlobal;
  if (!holder[HUB_KEY]) {
    holder[HUB_KEY] = createRemoteHub();
  }
  return holder[HUB_KEY] as RemoteHub;
}
