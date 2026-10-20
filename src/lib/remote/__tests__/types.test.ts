import {
  isValidDeviceId,
  parseRemoteCommand,
  sanitizeDeviceName,
  sanitizeStatus,
} from '../types';

describe('parseRemoteCommand', () => {
  it.each(['toggle', 'play', 'pause', 'next', 'prev', 'home'])(
    'accepts simple command %s',
    (type) => {
      expect(parseRemoteCommand({ type })).toEqual({ type });
    }
  );

  it('drops unknown fields from simple commands', () => {
    expect(parseRemoteCommand({ type: 'play', evil: 1 })).toEqual({
      type: 'play',
    });
  });

  it.each([null, undefined, 'play', 42, [], {}, { type: 1 }, { type: 'rm' }])(
    'rejects non-command input %p',
    (input) => {
      expect(parseRemoteCommand(input)).toBeNull();
    }
  );

  it('validates seek time range and finiteness', () => {
    expect(parseRemoteCommand({ type: 'seek', time: 0 })).toEqual({
      type: 'seek',
      time: 0,
    });
    expect(parseRemoteCommand({ type: 'seek', time: 86400 })).not.toBeNull();
    expect(parseRemoteCommand({ type: 'seek', time: -1 })).toBeNull();
    expect(parseRemoteCommand({ type: 'seek', time: 86401 })).toBeNull();
    expect(parseRemoteCommand({ type: 'seek', time: NaN })).toBeNull();
    expect(parseRemoteCommand({ type: 'seek', time: Infinity })).toBeNull();
    expect(parseRemoteCommand({ type: 'seek', time: '10' })).toBeNull();
    expect(parseRemoteCommand({ type: 'seek' })).toBeNull();
  });

  it('validates seekBy range', () => {
    expect(parseRemoteCommand({ type: 'seekBy', delta: -600 })).not.toBeNull();
    expect(parseRemoteCommand({ type: 'seekBy', delta: 600 })).not.toBeNull();
    expect(parseRemoteCommand({ type: 'seekBy', delta: 601 })).toBeNull();
    expect(parseRemoteCommand({ type: 'seekBy', delta: -601 })).toBeNull();
    expect(parseRemoteCommand({ type: 'seekBy', delta: null })).toBeNull();
  });

  it('validates episode index as integer 0..9999', () => {
    expect(parseRemoteCommand({ type: 'episode', index: 0 })).not.toBeNull();
    expect(parseRemoteCommand({ type: 'episode', index: 9999 })).not.toBeNull();
    expect(parseRemoteCommand({ type: 'episode', index: 10000 })).toBeNull();
    expect(parseRemoteCommand({ type: 'episode', index: -1 })).toBeNull();
    expect(parseRemoteCommand({ type: 'episode', index: 1.5 })).toBeNull();
  });

  it('requires boolean for fullscreen', () => {
    expect(parseRemoteCommand({ type: 'fullscreen', on: true })).toEqual({
      type: 'fullscreen',
      on: true,
    });
    expect(parseRemoteCommand({ type: 'fullscreen', on: 'yes' })).toBeNull();
    expect(parseRemoteCommand({ type: 'fullscreen' })).toBeNull();
  });

  describe('navigate url', () => {
    const nav = (url: unknown) => parseRemoteCommand({ type: 'navigate', url });

    it('accepts site-internal paths', () => {
      expect(nav('/')).toEqual({ type: 'navigate', url: '/' });
      expect(nav('/play?source=a&id=1&title=%E4%BD%A0')).not.toBeNull();
    });

    it('rejects external or ambiguous urls', () => {
      expect(nav('//evil.com')).toBeNull();
      expect(nav('https://evil.com')).toBeNull();
      expect(nav('javascript:alert(1)')).toBeNull();
      expect(nav('play')).toBeNull();
      expect(nav('/\\evil.com')).toBeNull();
      expect(nav('/a\nb')).toBeNull();
      expect(nav('/a\u0000b')).toBeNull();
      expect(nav(123)).toBeNull();
      expect(nav(undefined)).toBeNull();
    });

    it('enforces the 2048 length limit', () => {
      expect(nav('/' + 'a'.repeat(2047))).not.toBeNull();
      expect(nav('/' + 'a'.repeat(2048))).toBeNull();
    });
  });
});

describe('isValidDeviceId', () => {
  it('accepts 8-64 chars of [a-zA-Z0-9_-]', () => {
    expect(isValidDeviceId('abcd1234')).toBe(true);
    expect(isValidDeviceId('A-b_c-1234567890')).toBe(true);
    expect(isValidDeviceId('a'.repeat(64))).toBe(true);
  });

  it('rejects other values', () => {
    expect(isValidDeviceId('short')).toBe(false);
    expect(isValidDeviceId('a'.repeat(65))).toBe(false);
    expect(isValidDeviceId('has space 123')).toBe(false);
    expect(isValidDeviceId('../../etc/passwd')).toBe(false);
    expect(isValidDeviceId(null)).toBe(false);
    expect(isValidDeviceId(12345678)).toBe(false);
  });
});

describe('sanitizeDeviceName', () => {
  it('trims and strips control characters', () => {
    expect(sanitizeDeviceName('  客厅\u0000电视\n ')).toBe('客厅电视');
  });

  it('caps the length at 40', () => {
    expect(sanitizeDeviceName('x'.repeat(100))).toHaveLength(40);
  });

  it('falls back to the default name', () => {
    expect(sanitizeDeviceName('')).toBe('Blazing TV');
    expect(sanitizeDeviceName('   ')).toBe('Blazing TV');
    expect(sanitizeDeviceName(null)).toBe('Blazing TV');
    expect(sanitizeDeviceName(42)).toBe('Blazing TV');
  });
});

describe('sanitizeStatus', () => {
  const base = { path: '/play?source=a&id=1', page: 'play', updatedAt: 1000 };

  it('accepts a minimal status', () => {
    expect(sanitizeStatus(base)).toEqual(base);
  });

  it('copies only known fields', () => {
    const full = {
      title: '标题',
      year: '2024',
      source: 'ffzy',
      id: '1',
      poster: 'http://x/p.jpg',
      episodeIndex: 2,
      totalEpisodes: 10,
      currentTime: 12.5,
      duration: 100,
      paused: true,
      fullscreen: false,
    };
    const result = sanitizeStatus({ ...base, ...full, evil: '<script>' });
    expect(result).toEqual({ ...base, ...full });
    expect(result).not.toHaveProperty('evil');
  });

  it('drops fields with the wrong type', () => {
    const result = sanitizeStatus({
      ...base,
      title: 5,
      currentTime: '1',
      duration: NaN,
      paused: 'yes',
      episodeIndex: Infinity,
    });
    expect(result).toEqual(base);
  });

  it('rejects invalid required fields', () => {
    expect(sanitizeStatus(null)).toBeNull();
    expect(sanitizeStatus('x')).toBeNull();
    expect(sanitizeStatus([])).toBeNull();
    expect(sanitizeStatus({ ...base, path: '' })).toBeNull();
    expect(sanitizeStatus({ ...base, path: 1 })).toBeNull();
    expect(sanitizeStatus({ ...base, page: 'weird' })).toBeNull();
    expect(sanitizeStatus({ ...base, updatedAt: 'now' })).toBeNull();
    expect(sanitizeStatus({ ...base, updatedAt: NaN })).toBeNull();
  });

  it('caps episodes at 500 entries and labels at 80 chars', () => {
    const episodes = Array.from({ length: 800 }, (_, index) => ({
      index,
      label: 'L'.repeat(200),
    }));
    const result = sanitizeStatus({ ...base, episodes });
    expect(result?.episodes).toHaveLength(500);
    expect(result?.episodes?.[0].label).toHaveLength(80);
  });

  it('skips malformed episode entries', () => {
    const result = sanitizeStatus({
      ...base,
      episodes: [
        { index: 0, label: '第 1 集' },
        { index: 'x', label: 'bad' },
        { index: 1.5, label: 'bad' },
        { index: 2 },
        null,
        { index: 3, label: '第 4 集' },
      ],
    });
    expect(result?.episodes).toEqual([
      { index: 0, label: '第 1 集' },
      { index: 3, label: '第 4 集' },
    ]);
  });

  it('omits episodes when not an array', () => {
    expect(sanitizeStatus({ ...base, episodes: 'x' })).not.toHaveProperty(
      'episodes'
    );
  });
});
