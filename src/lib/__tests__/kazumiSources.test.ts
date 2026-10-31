import { buildKazumiSites } from '../kazumiSources';

describe('buildKazumiSites', () => {
  test('generates kazumi_ sources pointing at the bridge', () => {
    const sites = buildKazumiSites('http://kazumi-bridge:8787', [
      { key: 'mxdm', name: 'MXdm' },
    ]);

    expect(sites).toEqual({
      kazumi_mxdm: {
        key: 'kazumi_mxdm',
        api: 'http://kazumi-bridge:8787/vod/mxdm',
        name: 'Kazumi · MXdm',
      },
    });
  });

  test('strips a trailing slash from the bridge url', () => {
    const sites = buildKazumiSites('http://kazumi-bridge:8787/', [
      { key: 'mxdm', name: 'MXdm' },
    ]);

    expect(sites.kazumi_mxdm.api).toBe('http://kazumi-bridge:8787/vod/mxdm');
  });

  test('falls back to the rule key when the rule has no name', () => {
    const sites = buildKazumiSites('http://kazumi-bridge:8787', [
      { key: 'demo' },
    ]);

    expect(sites.kazumi_demo.name).toBe('Kazumi · demo');
  });

  test('skips rule keys the bridge route would reject', () => {
    const sites = buildKazumiSites('http://kazumi-bridge:8787', [
      { key: 'Bad Key', name: 'x' },
      { key: '../etc', name: 'y' },
    ]);

    expect(sites).toEqual({});
  });
});
