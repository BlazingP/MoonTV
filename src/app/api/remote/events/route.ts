import { NextRequest, NextResponse } from 'next/server';

import { getRemoteHub, offlineDevice } from '@/lib/remote/hub';
import { createSseResponse } from '@/lib/remote/sse';
import { isValidDeviceId } from '@/lib/remote/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/remote/events?device=<id>
 *
 * 遥控页 SSE：先推一次当前设备，之后每次状态/在线变化推 `status` 事件。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const deviceId = searchParams.get('device');
  if (!isValidDeviceId(deviceId)) {
    return NextResponse.json({ error: '设备 ID 无效' }, { status: 400 });
  }

  const hub = getRemoteHub();
  return createSseResponse(request, ({ send }) => {
    send('status', hub.getDevice(deviceId) ?? offlineDevice(deviceId));
    return hub.subscribeStatus(deviceId, send);
  });
}
