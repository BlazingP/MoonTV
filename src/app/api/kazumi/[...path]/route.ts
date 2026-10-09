import { relayKazumiMedia } from '@/lib/kazumi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: { path: string[] } }
) {
  return relayKazumiMedia(request, context.params.path);
}

export const HEAD = GET;
export const OPTIONS = GET;
