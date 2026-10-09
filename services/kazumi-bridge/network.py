"""Public Internet requests with DNS pinning and redirect validation."""
import ipaddress
import socket
from urllib.parse import urljoin, urlsplit

import aiohttp
from aiohttp.resolver import ThreadedResolver

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36"


def public_ip(address):
    ip = ipaddress.ip_address(address)
    return ip.is_global and not (ip.is_multicast or ip.is_unspecified)


def validate_url(url):
    if not isinstance(url, str) or len(url) > 8192 or any(ord(c) < 32 for c in url):
        raise ValueError("Invalid upstream URL")
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password:
        raise ValueError("Only public HTTP(S) URLs are supported")
    if parts.port not in (None, 80, 443):
        raise ValueError("Unsupported upstream port")
    host = parts.hostname.rstrip(".").lower()
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        raise ValueError("Private upstream is not allowed")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        if not public_ip(host):
            raise ValueError("Private upstream is not allowed")
    return url


class PublicResolver(ThreadedResolver):
    async def resolve(self, host, port=0, family=socket.AF_INET):
        addresses = await super().resolve(host, port, family)
        if not addresses or any(not public_ip(item["host"]) for item in addresses):
            raise OSError("Upstream DNS returned a non-public address")
        return addresses


class PublicHTTP:
    async def start(self):
        self.session = aiohttp.ClientSession(
            connector=aiohttp.TCPConnector(resolver=PublicResolver(), limit=32, ttl_dns_cache=60),
            timeout=aiohttp.ClientTimeout(total=20, connect=6, sock_read=12),
            cookie_jar=aiohttp.DummyCookieJar(), trust_env=False,
            headers={"User-Agent": UA, "Accept-Encoding": "identity"},
        )

    async def close(self):
        await self.session.close()

    async def open(self, url, *, headers=None, method="GET", data=None):
        # Validate each redirect before connecting. The resolver supplies the actual
        # public IPs to the connector, avoiding a check-then-resolve DNS race.
        for _ in range(6):
            validate_url(url)
            response = await self.session.request(method, url, headers=headers, data=data, allow_redirects=False)
            if response.status not in (301, 302, 303, 307, 308):
                return response
            location = response.headers.get("Location")
            response.release()
            if not location:
                raise ValueError("Redirect without a location")
            url = urljoin(str(response.url), location)
            if response.status == 303 or (method == "POST" and response.status in (301, 302)):
                method, data = "GET", None
        raise ValueError("Too many upstream redirects")

    async def read(self, url, *, headers=None, method="GET", data=None, limit=4 * 1024 * 1024):
        response = await self.open(url, headers=headers, method=method, data=data)
        try:
            response.raise_for_status()
            body = bytearray()
            async for chunk in response.content.iter_chunked(65536):
                body.extend(chunk)
                if len(body) > limit:
                    raise ValueError("Upstream document exceeds size limit")
            return str(response.url), bytes(body), dict(response.headers)
        finally:
            response.release()
