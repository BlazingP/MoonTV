"""Private CMS-compatible source API and signed, streaming HLS gateway."""
import asyncio
import json
import logging
import os
import re
import time
from collections import OrderedDict
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from aiohttp import web
from lxml import html

from core import Signer, extract_hls, load_rules, rewrite_manifest
from network import PublicHTTP
from sniffer import Sniffer

LOG = logging.getLogger("kazumi")


class TTLCache:
    def __init__(self, capacity=128, max_bytes=16 * 1024 * 1024):
        self.items = OrderedDict()
        self.capacity, self.max_bytes, self.size = capacity, max_bytes, 0

    def remove(self, key):
        old = self.items.pop(key, None)
        if old:
            self.size -= old[2]

    def get(self, key):
        value = self.items.get(key)
        if value and value[0] > time.monotonic():
            self.items.move_to_end(key)
            return value[1]
        self.remove(key)
        return None

    def put(self, key, value, seconds=300):
        self.remove(key)
        weight = len(json.dumps(value, ensure_ascii=False).encode())
        if weight > self.max_bytes:
            return
        self.items[key] = (time.monotonic() + seconds, value, weight)
        self.size += weight
        self.items.move_to_end(key)
        while len(self.items) > self.capacity or self.size > self.max_bytes:
            self.remove(next(iter(self.items)))


class Bridge:
    def __init__(self, rules, secret, public_base, http=None, browser=False):
        parts = urlsplit(public_base)
        if parts.scheme not in ("http", "https") or not parts.netloc or parts.query or parts.fragment or parts.username:
            raise ValueError("KAZUMI_PUBLIC_BASE must be the externally reachable MoonTV /api/kazumi URL")
        self.rules, self.signer = rules, Signer(secret)
        self.public_base, self.http = public_base.rstrip("/"), http or PublicHTTP()
        self.cache, self.metadata_slots = TTLCache(), asyncio.Semaphore(8)
        self.sniffer = Sniffer(self.http) if browser else None

    def media_url(self, value, filename="index.m3u8"):
        return f"{self.public_base}/media/{self.signer.encode(value)}/{filename}"

    async def chapters(self, rule, url):
        key = ("chapters", rule.key, url)
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        async with self.metadata_slots:
            roads = await asyncio.wait_for(rule.chapters(self.http, url), 8)
        if not roads:
            raise ValueError("No episodes found; the rule may need updating")
        self.cache.put(key, roads)
        return roads

    def item(self, rule, title, road, episodes):
        identity = {"kind": "title", "rule": rule.key, **title, "road": road}
        play = []
        for episode in episodes:
            value = {"kind": "episode", "rule": rule.key, "url": episode["url"], "expires": int(time.time()) + 86400}
            name = re.sub(r"[#$]", " ", episode["name"])
            play.append(name + "$" + self.media_url(value))
        return {"vod_id": self.signer.encode(identity), "vod_name": title["title"],
                "vod_pic": title.get("poster", ""), "vod_play_url": "#".join(play),
                "vod_play_from": f"{rule.key}-{road + 1}", "vod_remarks": f"线路 {road + 1} · {len(episodes)} 集",
                "vod_year": "", "vod_content": "", "type_name": "动漫"}

    async def search(self, rule, keyword):
        key = ("search", rule.key, keyword)
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        titles = await asyncio.wait_for(rule.search(self.http, keyword), 8)
        async def expand(title):
            try:
                roads = await self.chapters(rule, title["url"])
                return [self.item(rule, title, index, episodes) for index, episodes in enumerate(roads[:4])]
            except Exception as exc:
                LOG.warning("Rule %s detail expansion failed: %s", rule.key, type(exc).__name__)
                return []
        # Bounded expansion supplies episodes for MoonTV's source-selection UI.
        groups = await asyncio.gather(*(expand(title) for title in titles[:8]))
        items = [item for group in groups for item in group]
        if titles and not items:
            raise ValueError("Search matched titles but episode extraction failed")
        self.cache.put(key, items, seconds=120)
        return items

    async def detail(self, rule, token):
        identity = self.signer.decode(token, "title")
        if identity["rule"] != rule.key:
            raise ValueError("Rule does not match title")
        roads = await self.chapters(rule, identity["url"])
        road = identity["road"]
        if not isinstance(road, int) or not 0 <= road < len(roads):
            raise ValueError("This playback road is no longer available")
        return self.item(rule, {k: identity[k] for k in ("url", "title", "poster")}, road, roads[road])

    async def resolve(self, rule, page):
        cached = self.cache.get(("resolve", rule.key, page))
        if cached is not None:
            return cached
        headers = rule.headers(page)
        async def inspect(url, depth=0):
            final, body, _ = await self.http.read(url, headers=headers)
            if body.lstrip().startswith(b"#EXTM3U"):
                return final
            media = extract_hls(body, final)
            if media:
                return media
            if depth < 2:
                doc = html.fromstring(body)
                for frame in doc.xpath("//iframe/@src")[:3]:
                    try:
                        candidate = await inspect(urljoin(final, frame), depth + 1)
                        if candidate:
                            return candidate
                    except Exception:
                        continue
            return None
        try:
            media = await asyncio.wait_for(inspect(page), 8)
        except (ValueError, OSError, asyncio.TimeoutError):
            media = None
        if not media and self.sniffer:
            media, observed_headers = await self.sniffer.resolve(page, headers)
            headers = {**observed_headers, **({"Referer": rule.data["referer"]} if rule.data.get("referer") else {})}
        if not media:
            raise ValueError("No HLS stream found; source may require browser mode or interactive verification")
        value = (media, headers)
        self.cache.put(("resolve", rule.key, page), value, seconds=60)
        return value

    async def media(self, request):
        value = self.signer.decode(request.match_info["token"])
        if value.get("rule") not in self.rules:
            raise ValueError("Unknown rule")
        rule = self.rules[value["rule"]]
        if value.get("kind") == "episode":
            url, headers = await self.resolve(rule, value["url"])
            is_manifest = True
        elif value.get("kind") == "resource":
            url, headers = value["url"], value["headers"]
            is_manifest = ".m3u8" in urlsplit(url).path.lower()
        else:
            raise ValueError("Not a media identifier")
        outgoing = dict(headers)
        range_header = request.headers.get("Range")
        if range_header and not is_manifest:
            if not re.fullmatch(r"bytes=\d*-\d*", range_header):
                raise web.HTTPRequestRangeNotSatisfiable()
            outgoing["Range"] = range_header
        upstream = await self.http.open(url, headers=outgoing)
        try:
            if upstream.status not in (200, 206):
                # Do not cache failing playback resolutions for future retries.
                if value["kind"] == "episode":
                    self.cache.remove(("resolve", rule.key, value["url"]))
                raise web.HTTPBadGateway(text="Upstream media request failed")
            content_type = upstream.headers.get("Content-Type", "application/octet-stream")
            is_manifest = is_manifest or "mpegurl" in content_type.lower()
            response_headers = {"Cache-Control": "no-store", "Access-Control-Allow-Origin": "*",
                                "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
                                "X-Content-Type-Options": "nosniff"}
            if is_manifest:
                body = bytearray()
                async for chunk in upstream.content.iter_chunked(65536):
                    body.extend(chunk)
                    if len(body) > 2 * 1024 * 1024:
                        raise ValueError("HLS manifest exceeds size limit")
                def make_url(target):
                    return self.media_url({"kind": "resource", "rule": rule.key, "url": target,
                                           "headers": headers, "expires": int(time.time()) + 14400}, "media.bin")
                manifest = rewrite_manifest(body.decode("utf-8-sig"), str(upstream.url), make_url)
                return web.Response(text=manifest, content_type="application/vnd.apple.mpegurl", headers=response_headers)
            for key in ("Content-Length", "Content-Range", "Accept-Ranges"):
                if key == "Content-Length" and upstream.headers.get("Content-Encoding", "identity") != "identity":
                    continue  # aiohttp automatically decompresses upstream responses.
                if key in upstream.headers:
                    response_headers[key] = upstream.headers[key]
            # Never serve executable upstream HTML/JS at the MoonTV origin.
            response_headers["Content-Type"] = "application/octet-stream"
            response = web.StreamResponse(status=upstream.status, headers=response_headers)
            await response.prepare(request)
            if request.method != "HEAD":
                async for chunk in upstream.content.iter_chunked(65536):
                    await response.write(chunk)
            await response.write_eof()
            return response
        finally:
            upstream.release()


@web.middleware
async def errors(request, handler):
    try:
        return await handler(request)
    except web.HTTPException:
        raise
    except ValueError as exc:
        if request.path.startswith("/media/"):
            return web.json_response({"error": str(exc)}, status=400, headers={"Cache-Control": "no-store"})
        return web.json_response({"error": str(exc)}, status=502)
    except asyncio.TimeoutError:
        return web.json_response({"error": "Source request timed out"}, status=504)
    except Exception as exc:
        LOG.warning("Request failed: %s", type(exc).__name__)
        return web.json_response({"error": "Source unavailable"}, status=502)


def create_app(bridge):
    app = web.Application(middlewares=[errors], client_max_size=16384)
    async def health(request):
        return web.json_response({"status": "ok", "rules": list(bridge.rules)})
    async def vod(request):
        rule = bridge.rules.get(request.match_info["rule"])
        if not rule:
            raise web.HTTPNotFound()
        if request.query.get("ac") != "videolist":
            raise web.HTTPBadRequest(text="Use ac=videolist")
        if request.query.get("ids"):
            items = [await bridge.detail(rule, request.query["ids"])]
        else:
            keyword = request.query.get("wd", "").strip()
            if not keyword or len(keyword) > 100:
                raise web.HTTPBadRequest(text="A search keyword of 1-100 characters is required")
            items = await bridge.search(rule, keyword)
        return web.json_response({"code": 1, "page": 1, "pagecount": 1, "limit": len(items), "total": len(items), "list": items})
    async def preflight(request):
        return web.Response(headers={"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
                                     "Access-Control-Allow-Headers": "Range"})
    app.router.add_get("/health", health)
    app.router.add_get("/vod/{rule}", vod)
    app.router.add_get("/media/{token}/{filename:index.m3u8|media.bin}", bridge.media)
    app.router.add_options("/media/{token}/{filename:index.m3u8|media.bin}", preflight)
    async def resources(application):
        await bridge.http.start()
        yield
        if bridge.sniffer:
            await bridge.sniffer.close()
        await bridge.http.close()
    app.cleanup_ctx.append(resources)
    return app


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    bridge = Bridge(load_rules(os.environ.get("KAZUMI_RULES_DIR", Path(__file__).parent / "rules")),
                    os.environ["KAZUMI_SECRET"], os.environ["KAZUMI_PUBLIC_BASE"],
                    browser=os.environ.get("KAZUMI_BROWSER", "true").lower() == "true")
    # Signed URLs are bearer capabilities; do not write them to access logs.
    web.run_app(create_app(bridge), host=os.environ.get("KAZUMI_BIND", "0.0.0.0"),
                port=int(os.environ.get("PORT", "8787")), access_log=None)
