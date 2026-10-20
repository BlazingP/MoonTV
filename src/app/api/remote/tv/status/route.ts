import { NextRequest, NextResponse } from 'next/server';

import { readJsonBody } from '@/lib/remote/body';
import { getRemoteHub } from '@/lib/remote/hub';
import { isValidDeviceId, sanitizeStatus } from '@/lib/remote/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/remote/tv/status
 *
 * 电视端上报状态，body：{ deviceId, status }。
 */
export async function POST(request: NextRequest) {
  const body = await readJsonBody(request);
  if (!body.ok) {
    return NextResponse.json(
      { ok: false, error: body.error },
      { status: body.status }
    );
  }

  const payload = body.value as { deviceId?: unknown; status?: unknown } | null;
  const deviceId = payload?.deviceId;
  const status = sanitizeStatus(payload?.status);
  if (!isValidDeviceId(deviceId) || !status) {
    return NextResponse.json({ ok: false, error: '参数无效' }, { status: 400 });
  }

  if (!getRemoteHub().updateStatus(deviceId, status)) {
    // 只接受已建立 SSE 连接的电视上报，电视连上后会立即补报
    return NextResponse.json(
      { ok: false, error: '电视未连接' },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}
