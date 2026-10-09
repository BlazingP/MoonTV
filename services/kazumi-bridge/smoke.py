"""Explicit, bounded real-source check. No episode downloads."""
import asyncio
import sys
from pathlib import Path

from app import Bridge
from core import load_rules


async def main():
    bridge = Bridge(load_rules(Path(__file__).parent / 'rules'), 'smoke-test-signing-secret-only-0123456789',
                    'http://localhost:3000/api/kazumi', browser='--browser' in sys.argv)
    await bridge.http.start()
    failures = 0
    try:
        for key, rule in bridge.rules.items():
            try:
                items = await asyncio.wait_for(bridge.search(rule, '海贼王'), 24)
                print(f'{key}: search={len(items)}', flush=True)
                if not items:
                    failures += 1
                    continue
                detail = await bridge.detail(rule, items[0]['vod_id'])
                episodes = detail['vod_play_url'].split('#')
                print(f'{key}: episodes={len(episodes)}', flush=True)
                token = episodes[0].split('$')[1].split('/media/')[1].split('/')[0]
                value = bridge.signer.decode(token, 'episode')
                url, headers = await asyncio.wait_for(bridge.resolve(rule, value['url']), 30)
                _, body, _ = await bridge.http.read(url, headers=headers, limit=2*1024*1024)
                print(f'{key}: hls_manifest={body.lstrip().startswith(b"#EXTM3U")}', flush=True)
            except Exception as exc:
                failures += 1
                print(f'{key}: FAILED {type(exc).__name__}: {str(exc)[:180]}', flush=True)
    finally:
        if bridge.sniffer:
            await bridge.sniffer.close()
        await bridge.http.close()
    return failures


if __name__ == '__main__':
    sys.exit(1 if asyncio.run(main()) else 0)
