import { NextResponse } from 'next/server';

import { getRemoteHub } from '@/lib/remote/hub';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/remote/devices
 *
 * 返回电视设备列表（在线优先，最近活跃在前）。
 */
export async function GET() {
  return NextResponse.json(
    { devices: getRemoteHub().listDevices() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
