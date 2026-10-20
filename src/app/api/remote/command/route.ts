import { NextRequest, NextResponse } from 'next/server';

import { readJsonBody } from '@/lib/remote/body';
import { getRemoteHub } from '@/lib/remote/hub';
import { isValidDeviceId, parseRemoteCommand } from '@/lib/remote/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/remote/command
 *
 * 遥控页下发命令，body：{ deviceId, command }。
 */
export async function POST(request: NextRequest) {
  const body = await readJsonBody(request);
  if (!body.ok) {
    return NextResponse.json(
      { ok: false, error: body.error },
      { status: body.status }
    );
  }

  const payload = body.value as {
    deviceId?: unknown;
    command?: unknown;
  } | null;
  const deviceId = payload?.deviceId;
  const command = parseRemoteCommand(payload?.command);
  if (!isValidDeviceId(deviceId) || !command) {
    return NextResponse.json({ ok: false, error: '参数无效' }, { status: 400 });
  }

  if (!getRemoteHub().sendCommand(deviceId, command)) {
    return NextResponse.json(
      { ok: false, error: '电视不在线' },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}
