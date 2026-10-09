import { act, cleanup, render, screen } from '@testing-library/react';
import Artplayer from 'artplayer';
import React from 'react';

import { getAllPlayRecords } from '@/lib/db.client';

import ContinueWatching from '@/components/ContinueWatching';

import PlayPage from '../page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () =>
    new URLSearchParams({
      source: 'kazumi_mxdm',
      id: 'signed-title',
      title: '测试番剧',
      scope: 'kazumi',
    }),
}));
jest.mock('@/lib/utils', () => ({ processImageUrl: (url: string) => url }));
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}));
jest.mock('@/components/EpisodeSelector', () => ({
  __esModule: true,
  default: () => <div>选集</div>,
}));
jest.mock('@/components/ScrollableRow', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
jest.mock('@/components/VideoCard', () => ({
  __esModule: true,
  default: ({
    title,
    currentEpisode,
  }: {
    title: string;
    currentEpisode: number;
  }) => (
    <div>
      {title} 第{currentEpisode}集
    </div>
  ),
}));
jest.mock('artplayer', () => {
  class Player {
    static instances: Player[] = [];
    currentTime = 0;
    duration = 120;
    paused = false;
    volume = 0.7;
    playbackRate = 1;
    video = document.createElement('video');
    notice = { show: '' };
    controls = { show: true };
    setting = { show: false };
    isDestroy = false;
    listeners = new Map<string, Array<() => void>>();
    constructor() {
      Player.instances.push(this);
    }
    on(name: string, callback: () => void) {
      this.listeners.set(name, [...(this.listeners.get(name) || []), callback]);
    }
    emit(name: string) {
      this.listeners.get(name)?.forEach((callback) => callback());
    }
    destroy() {
      this.isDestroy = true;
      this.listeners.clear();
    }
  }
  return { __esModule: true, default: Player };
});

type TestPlayer = {
  currentTime: number;
  duration: number;
  isDestroy: boolean;
  emit: (event: string) => void;
};
const Players = Artplayer as unknown as { instances: TestPlayer[] };

async function startPlayback() {
  const view = render(<PlayPage />);
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(Players.instances).toHaveLength(1);
  return { view, player: Players.instances[0] };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-09T00:00:00Z'));
  localStorage.clear();
  Players.instances.length = 0;
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      results: [
        {
          id: 'signed-title',
          source: 'kazumi_mxdm',
          source_name: 'Kazumi · MXdm',
          title: '测试番剧',
          episodes: [
            'http://localhost/first.m3u8',
            'http://localhost/second.m3u8',
          ],
          poster: '',
          year: 'unknown',
        },
      ],
    }),
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('first valid progress appears in Continue Watching before the five-second timer or any episode switch', async () => {
  const { player, view } = await startPlayback();
  await act(async () => {
    player.emit('video:timeupdate');
  });
  expect(await getAllPlayRecords()).toEqual({});
  await act(async () => {
    jest.advanceTimersByTime(1500);
    player.currentTime = 1.5;
    player.emit('video:timeupdate');
  });
  expect((await getAllPlayRecords())['kazumi_mxdm+signed-title']).toMatchObject(
    { index: 1, play_time: 1 }
  );
  view.unmount();
  render(<ContinueWatching />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByText('继续观看')).toBeInTheDocument();
  expect(screen.getByText('测试番剧 第1集')).toBeInTheDocument();
});

test('returning via client-side navigation flushes the last seconds and destroys the player', async () => {
  const { player, view } = await startPlayback();
  // A browser may not emit another timeupdate between this point and navigation.
  player.currentTime = 2.8;
  await act(async () => {
    view.unmount();
  });
  expect((await getAllPlayRecords())['kazumi_mxdm+signed-title']).toMatchObject(
    { index: 1, play_time: 2 }
  );
  expect(player.isDestroy).toBe(true);
});

test('native pause saves short playback even without the Artplayer pause command', async () => {
  const { player } = await startPlayback();
  player.currentTime = 2.2;
  await act(async () => {
    player.emit('video:pause');
  });
  expect((await getAllPlayRecords())['kazumi_mxdm+signed-title']).toMatchObject(
    { index: 1, play_time: 2 }
  );
});

test('opening or buffering a video without valid playback does not create history', async () => {
  const { player, view } = await startPlayback();
  await act(async () => {
    player.emit('video:timeupdate');
    player.emit('video:pause');
    view.unmount();
  });
  expect(await getAllPlayRecords()).toEqual({});
});
