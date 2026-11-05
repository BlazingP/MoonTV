import {
  NasInputError,
  nasLibraryUrl,
  parseNasQuery,
  sanitizeLibrary,
} from '../nas';

const MOVIE = `m.${'a'.repeat(32)}`;
const SEASON = `s.${'b'.repeat(32)}.${'c'.repeat(32)}`;

describe('parseNasQuery', () => {
  test('defaults to the first page of movies', () => {
    expect(parseNasQuery(new URLSearchParams())).toEqual({
      type: 'movie',
      page: 1,
    });
  });

  test('accepts tv and a page number', () => {
    expect(parseNasQuery(new URLSearchParams('type=tv&page=3'))).toEqual({
      type: 'tv',
      page: 3,
    });
  });

  test.each(['type=music', 'page=0', 'page=1.5', 'page=abc', 'page=1001'])(
    'rejects %s',
    (query) => {
      expect(() => parseNasQuery(new URLSearchParams(query))).toThrow(
        NasInputError
      );
    }
  );
});

describe('nasLibraryUrl', () => {
  test('swaps the CMS path for /library', () => {
    expect(
      nasLibraryUrl('http://192.168.0.96:8095/api.php/provide/vod', 'tv', 2)
    ).toBe('http://192.168.0.96:8095/library?type=tv&page=2');
  });

  test('tolerates a trailing slash', () => {
    expect(
      nasLibraryUrl('http://nas:8095/api.php/provide/vod/', 'movie', 1)
    ).toBe('http://nas:8095/library?type=movie&page=1');
  });

  test('refuses sources that are not nas-bridge', () => {
    expect(() =>
      nasLibraryUrl('https://example.com/api', 'movie', 1)
    ).toThrow();
  });
});

describe('sanitizeLibrary', () => {
  test('keeps well-formed cards and drops the rest', () => {
    const data = sanitizeLibrary({
      page: 1,
      pagecount: 2,
      total: 30,
      list: [
        { vod_id: MOVIE, vod_name: '沙丘2' },
        { vod_id: SEASON, vod_name: '漫长的季节' },
        { vod_id: '../etc', vod_name: 'bad' },
        null,
        { vod_id: MOVIE },
      ],
    });
    expect(data.list.map((c) => c.vod_id)).toEqual([MOVIE, SEASON]);
    expect(data.pagecount).toBe(2);
  });

  test('normalises optional fields before they reach URLs', () => {
    const [card] = sanitizeLibrary({
      list: [
        {
          vod_id: SEASON,
          vod_name: '漫长的季节 第2季',
          search_title: '漫长的季节',
          vod_year: '2025&x=1',
          vod_pic: 'javascript:alert(1)',
          episodes: 'many',
        },
      ],
    }).list;
    expect(card).toMatchObject({
      search_title: '漫长的季节',
      vod_year: '',
      vod_pic: '',
      episodes: 1,
    });
    const [movie] = sanitizeLibrary({
      list: [{ vod_id: MOVIE, vod_name: '沙丘2', vod_year: '2024' }],
    }).list;
    expect(movie.search_title).toBe('沙丘2');
    expect(movie.vod_year).toBe('2024');
  });

  test('survives garbage', () => {
    expect(sanitizeLibrary('nope')).toEqual({
      page: 1,
      pagecount: 1,
      total: 0,
      list: [],
    });
  });
});
