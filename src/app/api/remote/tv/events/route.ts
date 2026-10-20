import { NextRequest, NextResponse } from 'next/server';

import { getRemoteHub } from '@/lib/remote/hub';
import { createSseResponse } from '@/lib/remote/sse';
import { isValidDeviceId, sanitizeDeviceName } from '@/lib/remote/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/remote/tv/events?device=<id>&name=<name>
 *
 * 电视端 SSE：连接即在线，向其推送 `command` 事件。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const deviceId = searchParams.get('device');
  if (!isValidDeviceId(deviceId)) {
    return NextResponse.json({ error: '设备 ID 无效' }, { status: 400 });
  }
  const name = sanitizeDeviceName(searchParams.get('name'));

  return createSseResponse(request, ({ send, close }) =>
    getRemoteHub().connectTv(deviceId, name, send, close)
  );
}
