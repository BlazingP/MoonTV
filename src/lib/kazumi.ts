// Only the administrator-configured sidecar receives extended source timeouts.
export function isKazumiApi(api: string): boolean {
  const bridge = process.env.KAZUMI_BRIDGE_URL;
  if (!bridge) return false;
  try {
    const base = new URL(bridge);
    const candidate = new URL(api);
    return (
      candidate.origin === base.origin &&
      /^\/vod\/[a-z0-9_-]+$/.test(candidate.pathname) &&
      !candidate.search &&
      !candidate.username &&
      !candidate.password
    );
  } catch {
    return false;
  }
}

// Media URLs have a signed capability in the path, so OrionTV / native players
// can request playlists and segments without copying the user's login cookie.
// No upstream URL, user cookie or Authorization header is accepted here.
export async function relayKazumiMedia(
  request: Request,
  path: string[],
  fetcher: typeof fetch = fetch
): Promise<Response> {
  const bridge = process.env.KAZUMI_BRIDGE_URL;
  if (!bridge)
    return new Response('Kazumi bridge is disabled', { status: 503 });
  if (
    path.length !== 3 ||
    path[0] !== 'media' ||
    !/^[A-Za-z0-9_-]{44,16384}$/.test(path[1]) ||
    !['index.m3u8', 'media.bin'].includes(path[2])
  ) {
    return new Response('Invalid media path', { status: 400 });
  }
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers':
      'Content-Length, Content-Range, Accept-Ranges',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, 45000);
  request.signal.addEventListener('abort', abort, { once: true });
  const cleanup = () => {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abort);
  };
  if (request.signal.aborted) abort();
  try {
    const headers = new Headers();
    const range = request.headers.get('range');
    if (range) headers.set('Range', range);
    const upstream = await fetcher(
      `${bridge.replace(/\/$/, '')}/${path.join('/')}`,
      {
        method: request.method,
        headers,
        signal: controller.signal,
        redirect: 'manual',
        cache: 'no-store',
      }
    );
    // The bridge itself follows and validates upstream redirects. Do not expose
    // its internal address or follow an unexpected sidecar redirect here.
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel();
      cleanup();
      return new Response('Unexpected bridge redirect', {
        status: 502,
        headers: cors,
      });
    }
    const outputHeaders = new Headers(cors);
    for (const key of [
      'Content-Type',
      'Content-Length',
      'Content-Range',
      'Accept-Ranges',
    ]) {
      const value = upstream.headers.get(key);
      if (value) outputHeaders.set(key, value);
    }
    if (!upstream.body || request.method === 'HEAD') {
      await upstream.body?.cancel();
      cleanup();
      return new Response(null, {
        status: upstream.status,
        headers: outputHeaders,
      });
    }
    const reader = upstream.body.getReader();
    const stream = new ReadableStream({
      async pull(output) {
        try {
          const { value, done } = await reader.read();
          if (done) {
            cleanup();
            output.close();
          } else {
            output.enqueue(value);
          }
        } catch (error) {
          cleanup();
          output.error(error);
        }
      },
      async cancel() {
        abort();
        cleanup();
        await reader.cancel();
      },
    });
    return new Response(stream, {
      status: upstream.status,
      headers: outputHeaders,
    });
  } catch {
    cleanup();
    return new Response('Kazumi media gateway unavailable', {
      status: controller.signal.aborted ? 504 : 502,
      headers: cors,
    });
  }
}
