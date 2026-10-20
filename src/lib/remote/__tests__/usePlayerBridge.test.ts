import { SearchResult } from '@/lib/types';

import {
  buildState,
  changeSource,
  PlayerBridgeInfo,
  PlayerLike,
} from '../usePlayerBridge';

const detail: SearchResult = {
  id: '1',
  title: '嫁金钗',
  poster: 'p.jpg',
  episodes: ['a', 'b'],
  source: 'bfzy',
  source_name: '暴风资源',
  year: '2026',
};

const info = (overrides: Partial<PlayerBridgeInfo> = {}): PlayerBridgeInfo => ({
  title: '嫁金钗',
  year: '2026',
  source: 'bfzy',
  id: '1',
  cover: '',
  detail,
  episodeIndex: 0,
  sources: [detail, { ...detail, source: 'ruyi', id: '2', source_name: '' }],
  sourcesLoading: false,
  videoInfo: new Map([['bfzy-1', { quality: '1080p', loadSpeed: '2 MB/s' }]]),
  ...overrides,
});

const player = (overrides: Partial<PlayerLike> = {}): PlayerLike => ({
  currentTime: 10,
  duration: 100,
  playing: true,
  video: { paused: false },
  fullscreen: false,
  fullscreenWeb: false,
  play: jest.fn(),
  pause: jest.fn(),
  toggle: jest.fn(),
  ...overrides,
});

describe('buildState paused', () => {
  it('reads paused from the underlying video element', () => {
    expect(buildState(player({ video: { paused: true } }), info()).paused).toBe(
      true
    );
    // 缓冲时 playing 为 false，但视频并没有暂停
    expect(
      buildState(player({ playing: false, video: { paused: false } }), info())
        .paused
    ).toBe(false);
  });

  it('falls back to !playing without a video element', () => {
    expect(
      buildState(player({ video: null, playing: false }), info()).paused
    ).toBe(true);
  });

  it('leaves player fields undefined before the player exists', () => {
    const state = buildState(null, info());
    expect(state.paused).toBeUndefined();
    expect(state.fullscreen).toBeUndefined();
  });
});

describe('buildState sources', () => {
  it('maps available sources with names, episodes and speed info', () => {
    expect(buildState(player(), info()).sources).toEqual([
      {
        source: 'bfzy',
        id: '1',
        name: '暴风资源',
        episodes: 2,
        quality: '1080p',
        speed: '2 MB/s',
      },
      { source: 'ruyi', id: '2', name: 'ruyi', episodes: 2 },
    ]);
  });

  it('reports web fullscreen as fullscreen', () => {
    expect(buildState(player({ fullscreenWeb: true }), info()).fullscreen).toBe(
      true
    );
  });
});

describe('changeSource (the only gate for the remote source command)', () => {
  const setup = () => {
    const actions = {
      setEpisode: jest.fn(),
      next: jest.fn(),
      prev: jest.fn(),
      changeSource: jest.fn(() => Promise.resolve()),
    };
    return { actions, input: { info: info(), actions } };
  };

  it('ignores a source that is not in the available list', () => {
    const { actions, input } = setup();
    expect(changeSource(input, 'evil', '9')).toBe(false);
    expect(changeSource(input, 'ruyi', '999')).toBe(false);
    expect(actions.changeSource).not.toHaveBeenCalled();
  });

  it('ignores the current source', () => {
    const { actions, input } = setup();
    expect(changeSource(input, 'bfzy', '1')).toBe(false);
    expect(actions.changeSource).not.toHaveBeenCalled();
  });

  it('switches to a listed source using its title, one switch at a time', async () => {
    const { actions, input } = setup();
    expect(changeSource(input, 'ruyi', '2')).toBe(true);
    expect(actions.changeSource).toHaveBeenCalledWith('ruyi', '2', '嫁金钗');
    // 上一次换源还没结束，第二次请求被忽略
    expect(changeSource(input, 'ruyi', '2')).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(changeSource(input, 'ruyi', '2')).toBe(true);
    expect(actions.changeSource).toHaveBeenCalledTimes(2);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
