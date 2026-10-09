const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');

function load(relative, overrides = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const helper = new Module(filename, module);
  helper.filename = filename;
  helper.paths = module.paths;
  const originalRequire = helper.require.bind(helper);
  helper.require = (name) => overrides[name] || originalRequire(name);
  helper._compile(compiled, filename);
  return helper.exports;
}

const { fetchKazumiCatalog, CatalogInputError } = load(
  'src/lib/kazumi-catalog.ts'
);
const { isKazumiApi } = load('src/lib/kazumi.ts');
const subject = {
  id: 123,
  type: 2,
  name: 'Original title',
  nameCN: '中文标题',
  images: { common: 'https://lain.bgm.tv/pic/cover/test.jpg' },
  rating: { score: 8.34 },
};
const json = (data) =>
  new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  });

test('popular page uses the same Bangumi trending endpoint as Kazumi and normalizes Next fields', async () => {
  const result = await fetchKazumiCatalog(
    new URLSearchParams(),
    async (url, options) => {
      assert.equal(
        url,
        'https://next.bgm.tv/p1/trending/subjects?type=2&limit=24&offset=0'
      );
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      assert.match(options.headers['User-Agent'], /BlazingP\/MoonTV/);
      return json({ data: [{ subject }], total: 1 });
    }
  );
  assert.deepEqual(result, {
    items: [
      {
        id: 123,
        title: '中文标题',
        originalTitle: 'Original title',
        poster: subject.images.common,
        score: '8.3',
        info: '',
      },
    ],
    page: 1,
    hasMore: false,
  });
});

test('categories and text search send anime-only v0 filters with paginated offsets', async () => {
  const result = await fetchKazumiCatalog(
    new URLSearchParams({ tag: '日常', q: '夏目', page: '2' }),
    async (url, options) => {
      assert.equal(
        url,
        'https://api.bgm.tv/v0/search/subjects?limit=24&offset=24'
      );
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body);
      assert.equal(body.keyword, '夏目');
      assert.equal(body.sort, 'match');
      assert.deepEqual(body.filter, { type: [2], tag: ['日常'], nsfw: false });
      return json({
        data: [
          {
            ...subject,
            nameCN: undefined,
            name_cn: '夏目友人帐',
            date: '2008-07-07',
            platform: 'TV',
          },
        ],
        total: 25,
      });
    }
  );
  assert.equal(result.items[0].title, '夏目友人帐');
  assert.equal(result.items[0].info, '2008-07-07 · TV');
  assert.equal(result.hasMore, false);
});

test('ranking filters remain deterministic; full pages expose another page only when available', async () => {
  for (const total of [24, 25]) {
    const result = await fetchKazumiCatalog(
      new URLSearchParams({ tag: '治愈' }),
      async (_url, options) => {
        const body = JSON.parse(options.body);
        assert.equal(body.sort, 'rank');
        assert.deepEqual(body.filter.rank, ['>0', '<=99999']);
        return json({
          data: Array.from({ length: 24 }, (_, id) => ({
            ...subject,
            id: id + 1,
          })),
          total,
        });
      }
    );
    assert.equal(result.items.length, 24);
    assert.equal(result.hasMore, total === 25);
  }
});

test('malformed entries, non-anime, duplicates, and unsafe images do not become catalog cards', async () => {
  const result = await fetchKazumiCatalog(new URLSearchParams(), async () =>
    json({
      data: [
        { subject },
        { subject },
        {},
        { subject: { ...subject, id: 124, type: 1 } },
        { subject: { ...subject, id: 125, nsfw: true } },
        { subject: { ...subject, id: 'invalid' } },
        {
          subject: {
            ...subject,
            id: 126,
            images: { common: 'http://127.0.0.1/private' },
          },
        },
      ],
    })
  );
  assert.deepEqual(
    result.items.map((item) => item.id),
    [123, 126]
  );
  assert.equal(result.items[1].poster, '');
});

test('invalid filters and unbounded page requests are rejected before contacting upstream', async () => {
  for (const params of [
    { page: '0' },
    { page: '1.5' },
    { page: '43' },
    { tag: 'arbitrary' },
    { q: 'x'.repeat(101) },
  ]) {
    await assert.rejects(
      fetchKazumiCatalog(new URLSearchParams(params), () => {
        throw new Error('must not fetch');
      }),
      CatalogInputError
    );
  }
});

test('upstream outages or incompatible payloads stay errors rather than false empty lists', async () => {
  await assert.rejects(
    fetchKazumiCatalog(
      new URLSearchParams(),
      async () => new Response('', { status: 503 })
    ),
    /request failed/
  );
  await assert.rejects(
    fetchKazumiCatalog(new URLSearchParams(), async () =>
      json({ message: 'rate limit' })
    ),
    /Invalid Bangumi/
  );
});

const sites = [
  {
    key: 'kazumi_mxdm',
    api: 'http://kazumi-bridge:8787/vod/mxdm',
    disabled: false,
  },
  {
    key: 'disabled',
    api: 'http://kazumi-bridge:8787/vod/disabled',
    disabled: true,
  },
  { key: 'ordinary', api: 'https://cms.example/api', disabled: false },
  {
    key: 'kazumi_spoofed',
    api: 'https://elsewhere.example/vod/mxdm',
    disabled: false,
  },
];

function searchRoute(called) {
  return load('src/app/api/search/route.ts', {
    '@/lib/config': {
      getConfig: async () => ({
        SourceConfig: sites,
        SiteConfig: { DisableYellowFilter: true },
      }),
      getCacheTime: async () => 600,
    },
    '@/lib/kazumi': { isKazumiApi },
    '@/lib/yellow': { yellowWords: [] },
    '@/lib/downstream': {
      searchFromApi: async (site) => {
        called.push(site.key);
        return [{ source: site.key }];
      },
    },
  });
}

test('Kazumi source selection and playback search contact only enabled sources on the configured bridge', async () => {
  process.env.KAZUMI_BRIDGE_URL = 'http://kazumi-bridge:8787';
  const called = [];
  const response = await searchRoute(called).GET(
    new Request('http://localhost/api/search?q=anime&scope=kazumi')
  );
  assert.deepEqual(called, ['kazumi_mxdm']);
  assert.deepEqual(await response.json(), {
    results: [{ source: 'kazumi_mxdm' }],
    sourcesConfigured: true,
  });
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('CDN-Cache-Control'), null);
  delete process.env.KAZUMI_BRIDGE_URL;
  const disabled = await searchRoute([]).GET(
    new Request('http://localhost/api/search?q=anime&scope=kazumi')
  );
  assert.deepEqual(await disabled.json(), {
    results: [],
    sourcesConfigured: false,
  });
});

test('the ordinary MoonTV search still searches all enabled sources', async () => {
  const called = [];
  const response = await searchRoute(called).GET(
    new Request('http://localhost/api/search?q=anime')
  );
  assert.deepEqual(called, ['kazumi_mxdm', 'ordinary', 'kazumi_spoofed']);
  assert.match(response.headers.get('Cache-Control'), /^public,/);
});
