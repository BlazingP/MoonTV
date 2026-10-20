import {
  createRemoteHub,
  getRemoteHub,
  MAX_DEVICES,
  OFFLINE_TTL_MS,
} from '../hub';
import { RemoteDevice, RemoteStatus } from '../types';

const status = (overrides: Partial<RemoteStatus> = {}): RemoteStatus => ({
  path: '/',
  page: 'other',
  updatedAt: 1,
  ...overrides,
});

function setup() {
  let now = 1_000_000;
  const hub = createRemoteHub(() => now);
  return {
    hub,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** 已连接一台电视（tv-00000001）的 hub：状态上报只接受在线设备。 */
function connected() {
  const ctx = setup();
  ctx.hub.connectTv('tv-00000001', 'A', jest.fn());
  return ctx;
}

describe('connectTv / disconnect', () => {
  it('marks the device online on connect and offline on disconnect', () => {
    const { hub } = setup();
    const disconnect = hub.connectTv('tv-00000001', '客厅', jest.fn());
    expect(hub.getDevice('tv-00000001')).toMatchObject({
      name: '客厅',
      online: true,
    });
    disconnect();
    expect(hub.getDevice('tv-00000001')?.online).toBe(false);
  });

  it('replaces the old connection and closes it', () => {
    const { hub } = setup();
    const onReplaced = jest.fn();
    const oldSend = jest.fn();
    const newSend = jest.fn();
    const disconnectOld = hub.connectTv(
      'tv-00000001',
      'A',
      oldSend,
      onReplaced
    );
    hub.connectTv('tv-00000001', 'A', newSend);

    expect(onReplaced).toHaveBeenCalledTimes(1);
    expect(hub.sendCommand('tv-00000001', { type: 'play' })).toBe(true);
    expect(newSend).toHaveBeenCalledWith('command', { type: 'play' });
    expect(oldSend).not.toHaveBeenCalled();

    // the old connection disconnecting must not take the device offline
    disconnectOld();
    expect(hub.getDevice('tv-00000001')?.online).toBe(true);
  });

  it('sanitizes the device name', () => {
    const { hub } = setup();
    hub.connectTv('tv-00000001', '  ', jest.fn());
    expect(hub.getDevice('tv-00000001')?.name).toBe('Blazing TV');
  });
});

describe('sendCommand', () => {
  it('returns false for unknown or offline devices', () => {
    const { hub } = setup();
    expect(hub.sendCommand('tv-unknown1', { type: 'home' })).toBe(false);
    const disconnect = hub.connectTv('tv-00000001', 'A', jest.fn());
    disconnect();
    expect(hub.sendCommand('tv-00000001', { type: 'home' })).toBe(false);
  });

  it('delivers the command to the connected TV', () => {
    const { hub } = setup();
    const send = jest.fn();
    hub.connectTv('tv-00000001', 'A', send);
    expect(hub.sendCommand('tv-00000001', { type: 'seek', time: 5 })).toBe(
      true
    );
    expect(send).toHaveBeenCalledWith('command', { type: 'seek', time: 5 });
  });

  it('treats a throwing send as a dead connection', () => {
    const { hub } = setup();
    hub.connectTv('tv-00000001', 'A', () => {
      throw new Error('closed');
    });
    expect(hub.sendCommand('tv-00000001', { type: 'play' })).toBe(false);
    expect(hub.getDevice('tv-00000001')?.online).toBe(false);
  });
});

describe('status broadcast', () => {
  it('pushes the current device to watchers on every change', () => {
    const { hub } = setup();
    const watcher = jest.fn();
    hub.subscribeStatus('tv-00000001', watcher);

    const disconnect = hub.connectTv('tv-00000001', 'A', jest.fn());
    hub.updateStatus('tv-00000001', status({ title: 'X' }));
    disconnect();

    expect(watcher).toHaveBeenCalledTimes(3);
    const devices = watcher.mock.calls.map((c) => c[1] as RemoteDevice);
    expect(watcher.mock.calls.every((c) => c[0] === 'status')).toBe(true);
    expect(devices.map((d) => d.online)).toEqual([true, true, false]);
    expect(devices[1].status?.title).toBe('X');
  });

  it('only notifies watchers of the matching device', () => {
    const { hub } = setup();
    const other = jest.fn();
    hub.subscribeStatus('tv-00000002', other);
    hub.updateStatus('tv-00000001', status());
    expect(other).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', () => {
    const { hub } = setup();
    const watcher = jest.fn();
    const unsubscribe = hub.subscribeStatus('tv-00000001', watcher);
    unsubscribe();
    hub.updateStatus('tv-00000001', status());
    expect(watcher).not.toHaveBeenCalled();
  });

  it('drops watchers whose send throws without affecting others', () => {
    const { hub } = setup();
    const bad = jest.fn(() => {
      throw new Error('closed');
    });
    const good = jest.fn();
    hub.subscribeStatus('tv-00000001', bad);
    hub.subscribeStatus('tv-00000001', good);
    hub.connectTv('tv-00000001', 'A', jest.fn());
    hub.updateStatus('tv-00000001', status());
    hub.updateStatus('tv-00000001', status());
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(3);
  });

  it('rejects status from a TV that is not connected', () => {
    const { hub } = setup();
    const watcher = jest.fn();
    hub.subscribeStatus('tv-00000001', watcher);
    expect(hub.updateStatus('tv-00000001', status())).toBe(false);
    expect(watcher).not.toHaveBeenCalled();
    expect(hub.listDevices()).toEqual([]);
  });

  it('omits carried-over episodes from broadcasts but keeps them for new watchers', () => {
    const { hub } = connected();
    const episodes = [{ index: 0, label: '第 1 集' }];
    const watcher = jest.fn();
    hub.subscribeStatus('tv-00000001', watcher);
    const playing = { page: 'play' as const, source: 's', id: '1' };
    hub.updateStatus('tv-00000001', status({ ...playing, episodes }));
    hub.updateStatus('tv-00000001', status({ ...playing, currentTime: 3 }));

    const sent = watcher.mock.calls.map((c) => (c[1] as RemoteDevice).status);
    expect(sent[0]?.episodes).toEqual(episodes);
    expect(sent[1]).not.toHaveProperty('episodes');
    expect(sent[1]?.currentTime).toBe(3);
    expect(hub.getDevice('tv-00000001')?.status?.episodes).toEqual(episodes);
  });

  it('does not list a device that was only watched', () => {
    const { hub } = setup();
    hub.subscribeStatus('tv-00000001', jest.fn());
    expect(hub.listDevices()).toEqual([]);
  });
});

describe('episodes carry-over', () => {
  const episodes = [
    { index: 0, label: '第 1 集' },
    { index: 1, label: '第 2 集' },
  ];
  const playing = (overrides: Partial<RemoteStatus> = {}) =>
    status({ page: 'play', source: 'ffzy', id: '1', ...overrides });

  it('keeps previous episodes when the same video omits them', () => {
    const { hub } = connected();
    hub.updateStatus('tv-00000001', playing({ episodes }));
    hub.updateStatus('tv-00000001', playing({ currentTime: 9 }));
    const current = hub.getDevice('tv-00000001')?.status;
    expect(current?.episodes).toEqual(episodes);
    expect(current?.currentTime).toBe(9);
  });

  it('uses new episodes when provided', () => {
    const { hub } = connected();
    const next = [{ index: 0, label: '新' }];
    hub.updateStatus('tv-00000001', playing({ episodes }));
    hub.updateStatus('tv-00000001', playing({ episodes: next }));
    expect(hub.getDevice('tv-00000001')?.status?.episodes).toEqual(next);
  });

  it('drops episodes when source or id changed', () => {
    const { hub } = connected();
    hub.updateStatus('tv-00000001', playing({ episodes }));
    hub.updateStatus('tv-00000001', playing({ id: '2' }));
    expect(hub.getDevice('tv-00000001')?.status?.episodes).toBeUndefined();

    hub.updateStatus('tv-00000001', playing({ id: '2', episodes }));
    hub.updateStatus('tv-00000001', playing({ id: '2', source: 'bfzy' }));
    expect(hub.getDevice('tv-00000001')?.status?.episodes).toBeUndefined();
  });

  it('drops episodes when leaving the play page', () => {
    const { hub } = connected();
    hub.updateStatus('tv-00000001', playing({ episodes }));
    hub.updateStatus('tv-00000001', status({ source: 'ffzy', id: '1' }));
    expect(hub.getDevice('tv-00000001')?.status?.episodes).toBeUndefined();
  });
});

describe('listDevices', () => {
  it('orders online first, then by lastSeen descending', () => {
    const { hub, advance } = setup();
    hub.connectTv('off-old-001', 'X', jest.fn())();
    advance(1000);
    hub.connectTv('off-new-001', 'Y', jest.fn())();
    advance(1000);
    hub.connectTv('on-old-0001', 'A', jest.fn());
    advance(1000);
    hub.connectTv('on-new-0001', 'B', jest.fn());

    expect(hub.listDevices().map((d) => d.deviceId)).toEqual([
      'on-new-0001',
      'on-old-0001',
      'off-new-001',
      'off-old-001',
    ]);
  });

  it('drops devices offline for more than 10 minutes', () => {
    const { hub, advance } = setup();
    const disconnect = hub.connectTv('tv-00000001', 'A', jest.fn());
    disconnect();
    advance(OFFLINE_TTL_MS - 1);
    expect(hub.listDevices()).toHaveLength(1);
    advance(2);
    expect(hub.listDevices()).toHaveLength(0);
  });

  it('keeps online devices regardless of age', () => {
    const { hub, advance } = setup();
    hub.connectTv('tv-00000001', 'A', jest.fn());
    advance(OFFLINE_TTL_MS * 3);
    expect(hub.listDevices()).toHaveLength(1);
  });
});

describe('device limit', () => {
  it('evicts the least recently seen idle device when full', () => {
    const { hub, advance } = setup();
    for (let i = 0; i < MAX_DEVICES; i++) {
      hub.connectTv(`idle-${String(i).padStart(4, '0')}`, 'X', jest.fn())();
      advance(1);
    }
    hub.connectTv('tv-newcomer', 'N', jest.fn());
    const ids = hub.listDevices().map((d) => d.deviceId);
    expect(ids).toHaveLength(MAX_DEVICES);
    expect(ids).toContain('tv-newcomer');
    expect(ids).not.toContain('idle-0000');
  });
});

describe('getRemoteHub', () => {
  it('returns a process-wide singleton', () => {
    expect(getRemoteHub()).toBe(getRemoteHub());
  });
});
