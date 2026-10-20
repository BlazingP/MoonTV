'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { RemoteCommand, RemoteDevice, RemoteEpisode } from '@/lib/remote/types';

import { applyOptimistic } from './optimistic';

const DEVICE_POLL_MS = 8000;
const NOTICE_MS = 4000;
const STORAGE_KEY = 'moontv:remote:deviceId';

export interface RemoteNotice {
  kind: 'error' | 'info';
  text: string;
}

export interface UseRemoteResult {
  devices: RemoteDevice[];
  loading: boolean;
  deviceId: string | null;
  device: RemoteDevice | null;
  episodes: RemoteEpisode[];
  notice: RemoteNotice | null;
  selectDevice: (id: string) => void;
  send: (command: RemoteCommand, okText?: string) => Promise<boolean>;
}

function readSavedDevice(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveDevice(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // 隐私模式下可能不可用，忽略
  }
}

/** 手动选择优先；记忆的设备仅在在线时沿用；否则只有一台在线电视时自动选中。 */
function pickDeviceId(
  devices: RemoteDevice[],
  chosen: string | null,
  saved: string | null
): string | null {
  if (chosen && devices.some((d) => d.deviceId === chosen)) return chosen;
  const online = devices.filter((d) => d.online);
  if (saved && online.some((d) => d.deviceId === saved)) return saved;
  return online.length === 1 ? online[0].deviceId : null;
}

function useDevices() {
  const [devices, setDevices] = useState<RemoteDevice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/remote/devices', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { devices?: RemoteDevice[] };
        if (!cancelled) setDevices(data.devices ?? []);
      } catch {
        // 保留上一次的列表，下个周期再试
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const timer = setInterval(load, DEVICE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return { devices, loading };
}

function useDeviceStream(deviceId: string | null) {
  const [device, setDevice] = useState<RemoteDevice | null>(null);
  const [episodes, setEpisodes] = useState<RemoteEpisode[]>([]);

  useEffect(() => {
    setDevice(null);
    setEpisodes([]);
    if (!deviceId) return;
    const source = new EventSource(
      `/api/remote/events?device=${encodeURIComponent(deviceId)}`
    );
    source.addEventListener('status', (event) => {
      try {
        const next = JSON.parse((event as MessageEvent).data) as RemoteDevice;
        if (next.deviceId !== deviceId) return;
        setDevice(next);
        const list = next.status?.episodes;
        if (list && list.length > 0) setEpisodes(list);
        else if (next.status?.page === 'other') setEpisodes([]);
      } catch {
        // 忽略无法解析的事件
      }
    });
    return () => source.close();
  }, [deviceId]);

  return { device, setDevice, episodes };
}

function useNotice() {
  const [notice, setNotice] = useState<RemoteNotice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((next: RemoteNotice) => {
    if (timer.current) clearTimeout(timer.current);
    setNotice(next);
    timer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return { notice, show };
}

async function postCommand(
  deviceId: string,
  command: RemoteCommand
): Promise<string | null> {
  try {
    const res = await fetch('/api/remote/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, command }),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    return data?.error || `操作失败（${res.status}）`;
  } catch {
    return '网络异常，请稍后重试';
  }
}

export function useRemote(): UseRemoteResult {
  const { devices, loading } = useDevices();
  const [chosen, setChosen] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    setSaved(readSavedDevice());
  }, []);

  const deviceId = useMemo(
    () => pickDeviceId(devices, chosen, saved),
    [devices, chosen, saved]
  );
  // 自动选中的设备也记下来：电视整页跳转时会短暂离线，不能因此清空遥控页
  useEffect(() => {
    if (deviceId && !chosen) setChosen(deviceId);
  }, [deviceId, chosen]);

  const stream = useDeviceStream(deviceId);
  const { notice, show } = useNotice();
  const { setDevice } = stream;

  const selectDevice = useCallback((id: string) => {
    setChosen(id);
    saveDevice(id);
  }, []);

  const send = useCallback(
    async (command: RemoteCommand, okText?: string) => {
      if (!deviceId) return false;
      setDevice((prev) => (prev ? applyOptimistic(prev, command) : prev));
      const error = await postCommand(deviceId, command);
      if (error) show({ kind: 'error', text: error });
      else if (okText) show({ kind: 'info', text: okText });
      return error === null;
    },
    [deviceId, setDevice, show]
  );

  const device = stream.device ?? devices.find((d) => d.deviceId === deviceId);
  return {
    devices,
    loading,
    deviceId,
    device: device ?? null,
    episodes: stream.episodes,
    notice,
    selectDevice,
    send,
  };
}
