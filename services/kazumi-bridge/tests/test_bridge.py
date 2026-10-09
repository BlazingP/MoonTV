import asyncio
import base64
import json
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aiohttp.test_utils import TestClient, TestServer
from aiohttp.resolver import ThreadedResolver
from app import Bridge, TTLCache, create_app
from core import Rule, Signer, extract_hls, rewrite_manifest
from network import PublicHTTP, PublicResolver, validate_url

SECRET = "test-secret-do-not-use-in-production-0123456789"
RULE = {"name": "Fixture", "baseURL": "https://source.example/", "searchURL": "https://source.example/search?wd=@keyword",
        "searchList": "//article", "searchName": "//h3/a", "searchResult": "//h3/a",
        "chapterRoads": "//ul[@class='road']", "chapterResult": "//li/a"}
SEARCH = b'<article><h3><a href="/title/1">First title</a></h3><img src="/1.jpg"></article><article><h3><a href="/title/2">Second title</a></h3></article>'
CHAPTERS = b'<ul class="road"><li><a href="/play/1">Episode 1</a></li><li><a href="/play/2">Episode 2</a></li></ul><ul class="road"><li><a href="/play/3">Alternate</a></li></ul>'
MASTER = b'#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8?key=a%2Bb"\n#EXT-X-STREAM-INF:BANDWIDTH=80000\nvideo.m3u8?sig=x%2By\n'
PLAYLIST = b'#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin?token=k"\n#EXT-X-MAP:URI="init.mp4?token=i"\n#EXTINF:2,\nseg.ts?token=s%2Bt\n#EXT-X-ENDLIST\n'


class BytesContent:
    def __init__(self, value):
        self.value = value
    async def iter_chunked(self, size):
        for offset in range(0, len(self.value), size):
            yield self.value[offset:offset+size]


class FakeResponse:
    def __init__(self, url, body, headers=None, status=200):
        self.url, self.status, self.headers = url, status, headers or {}
        self.content = BytesContent(body)
        self.released = False
    def release(self):
        self.released = True


class FixtureHTTP:
    def __init__(self):
        self.calls = []
    async def start(self):
        pass
    async def close(self):
        pass
    async def read(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if '/search' in url:
            body = SEARCH
        elif '/title/' in url:
            body = CHAPTERS
        else:
            body = b'<script>var player_demo = {"url":"https://cdn.example/master.m3u8?signature=a%2Bb","encrypt":0};</script>'
        return url, body, {}
    async def open(self, url, headers=None, **kwargs):
        self.calls.append((url, {"headers": headers, **kwargs}))
        if 'master.m3u8' in url:
            return FakeResponse(url, MASTER, {"Content-Type": "application/vnd.apple.mpegurl"})
        if '.m3u8' in url:
            return FakeResponse(url, PLAYLIST, {"Content-Type": "application/vnd.apple.mpegurl"})
        if headers.get("Range"):
            return FakeResponse(url, b"bc", {"Content-Length": "2", "Content-Range": "bytes 1-2/6", "Accept-Ranges": "bytes"}, 206)
        return FakeResponse(url, b"abcdef", {"Content-Length": "6"})


class CoreTests(unittest.TestCase):
    def test_cache_is_bounded_by_payload_size(self):
        cache = TTLCache(max_bytes=50)
        cache.put('one', 'a'*25)
        cache.put('two', 'b'*25)
        self.assertIsNone(cache.get('one'))
        self.assertEqual(cache.get('two'), 'b'*25)
        cache.put('huge', 'c'*100)
        self.assertIsNone(cache.get('huge'))
        cache.remove('two')
        self.assertEqual(cache.size, 0)

    def test_signatures_expiry_and_persisted_identity(self):
        signer = Signer(SECRET)
        token = signer.encode({"kind": "title", "url": "https://source.example/1"})
        self.assertRegex(token, r'^[\w-]+$')
        self.assertEqual(Signer(SECRET).decode(token, "title")["url"], "https://source.example/1")
        for bad in (token[:-2] + "xx", Signer("x"*32).encode({"kind": "title"}), signer.encode({"expires": 1})):
            with self.assertRaises(ValueError):
                signer.decode(bad)

    def test_reject_private_and_unsafe_upstreams(self):
        for url in ('http://localhost/', 'http://127.0.0.1/', 'http://169.254.169.254/',
                    'http://10.0.0.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/',
                    'file:///etc/passwd', 'http://user:pass@example.com/', 'http://example.com:2375/',
                    'http://router.local/', 'http://224.0.0.1/'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                validate_url(url)

    def test_rule_unsupported_modes_fail_loudly(self):
        with self.assertRaisesRegex(ValueError, 'API/JSONPath'):
            Rule('fixture', {**RULE, "searchMode": "api"})
        with self.assertRaisesRegex(ValueError, 'interactive'):
            Rule('fixture', {**RULE, "antiCrawlerConfig": {"enabled": True}})

    def test_player_data_is_decoded_without_evaluating_scripts(self):
        url = 'https://cdn.example/a.m3u8?sig=a%2Bb&time=123'
        encoded = base64.b64encode(url.encode()).decode()
        body = f'<script>var player_x = {{"url":"{encoded}","encrypt":2}};</script>'.encode()
        self.assertEqual(extract_hls(body, 'https://source.example/'), url.replace('%2B', '+'))

    def test_artplayer_literal_preserves_signed_query(self):
        body = b"new Artplayer({ url: 'https://cdn.example/index.m3u8?token=a%2Bb&expires=99', type: 'm3u8' });"
        self.assertEqual(extract_hls(body, 'https://source.example/'), 'https://cdn.example/index.m3u8?token=a%2Bb&expires=99')

    def test_manifest_rewrites_all_resources_and_preserves_queries(self):
        urls = []
        def rewrite(url):
            urls.append(url)
            return 'https://moontv.example/proxy/' + str(len(urls))
        output = rewrite_manifest(PLAYLIST.decode(), 'https://cdn.example/sub/video.m3u8', rewrite)
        self.assertEqual(urls, ['https://cdn.example/sub/key.bin?token=k', 'https://cdn.example/sub/init.mp4?token=i', 'https://cdn.example/sub/seg.ts?token=s%2Bt'])
        self.assertNotIn('cdn.example', output)
        self.assertIn('#EXT-X-ENDLIST', output)


class IntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.http = FixtureHTTP()
        self.rule = Rule('fixture', RULE)
        self.bridge = Bridge({'fixture': self.rule}, SECRET, 'http://moontv.example/api/kazumi', self.http)
        self.client = TestClient(TestServer(create_app(self.bridge)))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def media_get(self, url, **kwargs):
        return await self.client.get(urlsplit(url).path.replace('/api/kazumi', '', 1), **kwargs)

    async def test_search_detail_nested_hls_and_byte_range(self):
        search = await self.client.get('/vod/fixture', params={'ac':'videolist', 'wd':'title'})
        self.assertEqual(search.status, 200)
        items = (await search.json())['list']
        self.assertEqual(len(items), 4)  # two titles, two independent roads
        self.assertEqual([items[0]['vod_name'], items[2]['vod_name']], ['First title', 'Second title'])
        detail = await self.client.get('/vod/fixture', params={'ac':'videolist','ids':items[0]['vod_id']})
        self.assertEqual(detail.status, 200)
        item = (await detail.json())['list'][0]
        episode = item['vod_play_url'].split('#')[0].split('$')[1]
        master = await self.media_get(episode)
        self.assertEqual(master.status, 200)
        master_text = await master.text()
        nested = next(line for line in master_text.splitlines() if line and not line.startswith('#'))
        video = await self.media_get(nested)
        playlist = await video.text()
        segment = next(line for line in playlist.splitlines() if line and not line.startswith('#'))
        data = await self.media_get(segment, headers={'Range':'bytes=1-2'})
        self.assertEqual(data.status, 206)
        self.assertEqual(await data.read(), b'bc')
        self.assertEqual(data.headers['Content-Range'], 'bytes 1-2/6')
        self.assertEqual(self.http.calls[-1][0], 'https://cdn.example/seg.ts?token=s%2Bt')
        self.assertEqual(self.http.calls[-1][1]['headers']['Referer'], 'https://source.example/play/1')
        self.assertEqual(data.headers['Access-Control-Allow-Origin'], '*')

    async def test_invalid_token_never_makes_upstream_request(self):
        response = await self.client.get('/media/' + 'x'*80 + '/index.m3u8')
        self.assertEqual(response.status, 400)
        self.assertEqual(self.http.calls, [])

    async def test_post_search_encoding_and_relative_selectors(self):
        rule = Rule('post', {**RULE, 'usePost': True})
        items = await rule.search(self.http, '测试 & x')
        self.assertEqual([x['title'] for x in items], ['First title', 'Second title'])
        self.assertEqual(self.http.calls[0][0], 'https://source.example/search')
        self.assertEqual(self.http.calls[0][1]['data'], [('wd', '测试 & x')])

    async def test_dns_rebinding_results_are_rejected(self):
        with patch.object(ThreadedResolver, 'resolve', AsyncMock(return_value=[{'host':'127.0.0.1'}])):
            resolver = PublicResolver()
            with self.assertRaises(OSError):
                await resolver.resolve('public-looking.example', 443)
            await resolver.close()

    async def test_redirect_to_metadata_is_blocked_before_second_request(self):
        http = PublicHTTP()
        http.session = type('Session', (), {})()
        http.session.request = AsyncMock(return_value=FakeResponse('https://public.example/', b'', {'Location':'http://169.254.169.254/latest/meta-data/'}, 302))
        with self.assertRaises(ValueError):
            await http.open('https://public.example/')
        self.assertEqual(http.session.request.await_count, 1)


if __name__ == '__main__':
    unittest.main()
