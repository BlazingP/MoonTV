// 读取并限制大小的 JSON 请求体。

export const MAX_BODY_BYTES = 64 * 1024;

export type BodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; error: string };

/** 只需要 body.getReader，方便测试时传入替身。 */
export interface BodySource {
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
}

const TOO_LARGE: BodyResult = { ok: false, status: 413, error: '请求体过大' };

/** 边读边计数，超过上限立即中止，避免分块请求先把整个请求体读进内存。 */
async function readLimitedText(
  source: BodySource,
  maxBytes: number
): Promise<string | null> {
  if (!source.body) return '';
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function readJsonBody(
  request: BodySource,
  maxBytes: number = MAX_BODY_BYTES
): Promise<BodyResult> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return TOO_LARGE;

  let text: string | null;
  try {
    text = await readLimitedText(request, maxBytes);
  } catch {
    return { ok: false, status: 400, error: '无法读取请求体' };
  }
  if (text === null) return TOO_LARGE;
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: '请求体不是有效的 JSON' };
  }
}
