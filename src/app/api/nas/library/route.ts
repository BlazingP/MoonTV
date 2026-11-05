import { NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import {
  NAS_SOURCE_KEY,
  NasInputError,
  nasLibraryUrl,
  parseNasQuery,
  sanitizeLibrary,
} from '@/lib/nas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 10000;

export async function GET(request: Request) {
  try {
    const { type, page } = parseNasQuery(new URL(request.url).searchParams);
    const config = await getConfig();
    const source = config.SourceConfig.find(
      (s) => s.key === NAS_SOURCE_KEY && !s.disabled
    );
    if (!source)
      return NextResponse.json(
        { error: '还没有配置或已停用「我的 NAS」片源。' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    const response = await fetch(nasLibraryUrl(source.api, type, page), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`nas-bridge ${response.status}`);
    return NextResponse.json(sanitizeLibrary(await response.json()), {
      headers: { 'Cache-Control': 'private, max-age=60' },
    });
  } catch (error) {
    const isInput = error instanceof NasInputError;
    if (!isInput)
      // eslint-disable-next-line no-console
      console.error(
        'NAS library request failed:',
        error instanceof Error ? error.message : error
      );
    return NextResponse.json(
      {
        error: isInput
          ? error.message
          : 'NAS 片库暂时连不上，请确认 Mac mini 已开机。',
      },
      { status: isInput ? 400 : 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
