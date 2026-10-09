// Node's real Fetch/Streams are needed; the repository's Jest environment is jsdom.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const Module = require('node:module');

const filename = path.resolve(__dirname, '../src/lib/kazumi.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const helper = new Module(filename, module);
helper.filename = filename;
helper.paths = module.paths;
helper._compile(compiled, filename);
const { isKazumiApi, relayKazumiMedia } = helper.exports;
process.env.KAZUMI_BRIDGE_URL = 'http://kazumi-bridge:8787';
const mediaPath = ['media', 'a'.repeat(80), 'index.m3u8'];

test('only configured bridge source receives extended timeout', () => {
  assert.equal(isKazumiApi('http://kazumi-bridge:8787/vod/mxdm'), true);
  for (const api of [
    'https://other.example/vod/mxdm',
    'http://kazumi-bridge:8787/admin',
    'http://kazumi-bridge:8787/vod/mxdm?target=private',
  ]) {
    assert.equal(isKazumiApi(api), false);
  }
});

test('media relay streams signed URLs, forwards range, strips credentials', async () => {
  const request = new Request(
    'https://moontv.example/api/kazumi/' + mediaPath.join('/'),
    {
      headers: {
        Cookie: 'auth=secret',
        Authorization: 'Bearer secret',
        Range: 'bytes=0-1',
      },
    }
  );
  let called = false;
  const response = await relayKazumiMedia(
    request,
    mediaPath,
    async (url, options) => {
      called = true;
      assert.equal(url, 'http://kazumi-bridge:8787/' + mediaPath.join('/'));
      assert.equal(options.headers.get('Range'), 'bytes=0-1');
      assert.equal(options.headers.get('Cookie'), null);
      assert.equal(options.headers.get('Authorization'), null);
      assert.equal(options.redirect, 'manual');
      return new Response(new Uint8Array([1, 2]), {
        status: 206,
        headers: {
          'Content-Range': 'bytes 0-1/9',
          'Set-Cookie': 'do-not-forward=1',
        },
      });
    }
  );
  assert.equal(called, true);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(response.headers.get('Content-Range'), 'bytes 0-1/9');
  assert.deepEqual(
    new Uint8Array(await response.arrayBuffer()),
    new Uint8Array([1, 2])
  );
});

test('malformed paths cannot reach sidecar or proxy arbitrary URLs', async () => {
  const request = new Request('https://moontv.example/api/kazumi/test');
  for (const parts of [
    ['vod', 'mxdm'],
    ['media', '..', 'index.m3u8'],
    ['media', 'a'.repeat(80), 'admin'],
    ['media', 'https://private/', 'index.m3u8'],
  ]) {
    const response = await relayKazumiMedia(request, parts, () => {
      throw new Error('must not fetch');
    });
    assert.equal(response.status, 400);
  }
});

test('sidecar errors and preflight remain usable without a login cookie', async () => {
  const request = new Request('https://moontv.example/media');
  const response = await relayKazumiMedia(
    request,
    mediaPath,
    async () => new Response('expired', { status: 400 })
  );
  assert.equal(response.status, 400);
  assert.equal(await response.text(), 'expired');
  const preflight = await relayKazumiMedia(
    new Request(request, { method: 'OPTIONS' }),
    mediaPath,
    () => {
      throw new Error('must not fetch');
    }
  );
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Headers'), 'Range');
});

test('unexpected redirects cannot expose an internal sidecar URL', async () => {
  const request = new Request('https://moontv.example/media');
  const response = await relayKazumiMedia(
    request,
    mediaPath,
    async () =>
      new Response(null, {
        status: 302,
        headers: { Location: 'http://private/' },
      })
  );
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('Location'), null);
});
