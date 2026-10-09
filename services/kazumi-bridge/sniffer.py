"""Optional browser fallback. All browser HTTP traffic uses PublicHTTP."""
import asyncio

from network import validate_url


class Sniffer:
    def __init__(self, http):
        self.http = http
        self.slots = asyncio.Semaphore(2)
        self.browser = None
        self.lock = asyncio.Lock()

    async def close(self):
        if self.browser:
            await self.browser.close()
            await self.playwright.stop()

    async def resolve(self, url, headers):
        from playwright.async_api import async_playwright

        async with self.slots:
            async with self.lock:
                if self.browser is None:
                    self.playwright = await async_playwright().start()
                    self.browser = await self.playwright.chromium.launch(
                        headless=True,
                        args=["--disable-background-networking", "--disable-quic",
                              "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
                              "--host-resolver-rules=MAP * ~NOTFOUND"],
                    )
            context = await self.browser.new_context(
                user_agent=headers["User-Agent"], service_workers="block", accept_downloads=False,
            )
            found = asyncio.get_running_loop().create_future()
            request_count = 0

            async def intercept(route):
                nonlocal request_count
                request_count += 1
                request = route.request
                try:
                    validate_url(request.url)
                    if request_count > 120 or request.method not in ("GET", "POST"):
                        await route.abort()
                        return
                    observed = await request.all_headers()
                    media_headers = {
                        "User-Agent": headers["User-Agent"],
                        "Referer": observed.get("referer") or url,
                    }
                    if ".m3u8" in request.url.split("?", 1)[0].lower():
                        if not found.done():
                            found.set_result((request.url, media_headers))
                        await route.abort()
                        return
                    if request.resource_type in ("image", "font", "media"):
                        await route.abort()
                        return
                    if observed.get("content-type"):
                        media_headers["Content-Type"] = observed["content-type"]
                    final, body, response_headers = await self.http.read(
                        request.url, headers=media_headers, method=request.method,
                        data=request.post_data_buffer, limit=4 * 1024 * 1024,
                    )
                    if body.lstrip().startswith(b"#EXTM3U") and not found.done():
                        found.set_result((final, {k: v for k, v in media_headers.items() if k != "Content-Type"}))
                    safe_headers = {k: v for k, v in response_headers.items()
                                    if k.lower() in ("content-type", "access-control-allow-origin", "access-control-allow-methods", "access-control-allow-headers")}
                    await route.fulfill(status=200, headers=safe_headers, body=body)
                except Exception:
                    try:
                        await route.abort()
                    except Exception:
                        pass  # The context may have closed after another request found HLS.

            try:
                await context.route("**/*", intercept)
                await context.route_web_socket("**/*", lambda socket: socket.close())
                page = await context.new_page()
                async def navigate():
                    try:
                        await page.goto(url, wait_until="domcontentloaded", timeout=15000)
                    except Exception:
                        pass  # A media request can complete while navigation is pending.
                navigation = asyncio.create_task(navigate())
                try:
                    return await asyncio.wait_for(found, timeout=18)
                finally:
                    navigation.cancel()
                    await asyncio.gather(navigation, return_exceptions=True)
            finally:
                await context.close()
