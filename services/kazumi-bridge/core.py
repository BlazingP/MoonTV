"""Kazumi XPath rules and stateless, signed MoonTV identifiers."""
import base64
import hashlib
import hmac
import json
import re
import time
from pathlib import Path
from urllib.parse import parse_qsl, quote, unquote, urljoin, urlsplit, urlunsplit

from lxml import html

from network import UA, validate_url


class Signer:
    def __init__(self, secret):
        if len(secret) < 32:
            raise ValueError("KAZUMI_SECRET must contain at least 32 characters")
        self.secret = secret.encode()

    def encode(self, payload):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        signature = hmac.new(self.secret, body, hashlib.sha256).digest()
        return base64.urlsafe_b64encode(signature + body).decode().rstrip("=")

    def decode(self, token, kind=None):
        try:
            if len(token) > 16384 or not re.fullmatch(r"[\w-]+", token, re.ASCII):
                raise ValueError()
            raw = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
            signature, body = raw[:32], raw[32:]
            if not hmac.compare_digest(signature, hmac.new(self.secret, body, hashlib.sha256).digest()):
                raise ValueError()
            value = json.loads(body)
            if not isinstance(value, dict) or (kind and value.get("kind") != kind):
                raise ValueError()
            if value.get("expires", float("inf")) < time.time():
                raise ValueError()
            return value
        except (ValueError, TypeError, KeyError, UnicodeError) as exc:
            raise ValueError("Invalid or expired signed identifier") from exc


def relative_xpath(node, expression):
    # Kazumi's // selectors are relative to the current search item / road.
    return node.xpath("." + expression if expression.startswith("//") else expression)


def node_text(node):
    return " ".join((node.text_content() if hasattr(node, "text_content") else str(node)).split())


class Rule:
    def __init__(self, key, data):
        if not re.fullmatch(r"[a-z0-9_-]+", key):
            raise ValueError("Rule filename must use lowercase letters, numbers, _ or -")
        for mode in ("searchMode", "chapterMode"):
            if data.get(mode, "xpath") != "xpath":
                raise ValueError(f"{key}: API/JSONPath rules are not supported in this release")
        if data.get("antiCrawlerConfig", {}).get("enabled"):
            raise ValueError(f"{key}: interactive verification rules are not supported")
        for field in ("name", "baseURL", "searchURL", "searchList", "searchName", "searchResult", "chapterRoads", "chapterResult"):
            if not isinstance(data.get(field), str) or not data[field]:
                raise ValueError(f"{key}: missing {field}")
        if "@keyword" not in data["searchURL"]:
            raise ValueError(f"{key}: missing @keyword")
        validate_url(data["baseURL"])
        validate_url(data["searchURL"])
        for field in ("searchList", "searchName", "searchResult", "chapterRoads", "chapterResult"):
            html.etree.XPath(data[field])
        self.key, self.data = key, data

    def headers(self, page=None):
        return {"User-Agent": self.data.get("userAgent") or UA,
                "Referer": self.data.get("referer") or page or self.data["baseURL"]}

    async def search(self, http, keyword):
        url = self.data["searchURL"].replace("@keyword", quote(keyword, safe=""))
        method, data = "GET", None
        if self.data.get("usePost"):
            parts = urlsplit(url)
            method, data = "POST", list(parse_qsl(parts.query, keep_blank_values=True))
            url = urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
        final_url, body, _ = await http.read(url, headers=self.headers(), method=method, data=data)
        doc = html.fromstring(body)
        results, seen = [], set()
        for node in doc.xpath(self.data["searchList"]):
            names = relative_xpath(node, self.data["searchName"])
            links = relative_xpath(node, self.data["searchResult"])
            if not names or not links:
                continue
            link = links[0].get("href") if hasattr(links[0], "get") else str(links[0])
            if not link:
                continue
            target = urljoin(final_url, link)
            if urlsplit(target).netloc != urlsplit(final_url).netloc or target in seen:
                continue
            title = node_text(names[0])
            if not title:
                continue
            seen.add(target)
            images = node.xpath(".//img/@data-original | .//img/@data-src | .//img/@src")
            poster = next((urljoin(final_url, x) for x in images if not x.startswith("data:")), "")
            results.append({"url": target, "title": title, "poster": poster})
        return results

    async def chapters(self, http, url):
        final_url, body, _ = await http.read(url, headers=self.headers())
        doc = html.fromstring(body)
        roads = []
        for road in doc.xpath(self.data["chapterRoads"]):
            episodes, seen = [], set()
            for node in relative_xpath(road, self.data["chapterResult"]):
                link = node.get("href") if hasattr(node, "get") else str(node)
                if not link:
                    continue
                target = urljoin(final_url, link)
                if urlsplit(target).scheme not in ("http", "https") or target in seen:
                    continue
                seen.add(target)
                episodes.append({"name": node_text(node) or str(len(episodes) + 1), "url": target})
            if episodes:
                roads.append(episodes)
        return roads


def load_rules(directory):
    rules = {}
    for path in sorted(Path(directory).glob("*.json")):
        rule = Rule(path.stem, json.loads(path.read_text(encoding="utf-8-sig")))
        rules[rule.key] = rule
    if not rules:
        raise ValueError("No XPath rules loaded")
    return rules


def extract_hls(body, page_url):
    text = body.decode("utf-8", errors="replace")
    # Common player configurations; parse data, never eval untrusted JavaScript.
    for match in re.finditer(r"(?:var\s+)?player_[\w]+\s*=\s*(\{)", text):
        try:
            value, _ = json.JSONDecoder().raw_decode(text[match.start(1):])
            url = value.get("url", "")
            if str(value.get("encrypt")) == "2":
                url = base64.b64decode(url).decode()
            if str(value.get("encrypt")) in ("1", "2"):
                url = unquote(url)
            if ".m3u8" in urlsplit(url).path.lower():
                return urljoin(page_url, url)
        except (ValueError, TypeError, UnicodeError):
            continue
    # ArtPlayer / DPlayer and similar inline configurations use JS object
    # literals rather than JSON. Extract only an HTTP(S) string value.
    for match in re.finditer(r'''(?:url|src|file)\s*:\s*(['"])(https?://[^'"\r\n]+)\1''', text):
        url = match.group(2).replace("\\/", "/").replace("\\u0026", "&")
        if ".m3u8" in urlsplit(url).path.lower():
            return url
    doc = html.fromstring(body)
    for url in doc.xpath("//video/@src | //source/@src"):
        if ".m3u8" in urlsplit(url).path.lower():
            return urljoin(page_url, url)
    return None


def rewrite_manifest(text, upstream, make_url):
    if not text.lstrip("\ufeff\r\n ").startswith("#EXTM3U"):
        raise ValueError("The source did not return an HLS playlist")
    lines = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("#"):
            # Keys, initialization maps, alternate audio, subtitles, iframe variants.
            line = re.sub(r'URI="([^"\r\n]+)"', lambda m: 'URI="' + make_url(urljoin(upstream, m.group(1))) + '"', line)
        elif line:
            line = make_url(urljoin(upstream, line))
        lines.append(line)
    return "\n".join(lines) + "\n"
