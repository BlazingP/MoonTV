/**
 * @jest-environment node
 */
import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import {
  TextDecoder as NodeTextDecoder,
  TextEncoder as NodeTextEncoder,
} from 'node:util';

import { BodySource, readJsonBody } from '../body';

beforeAll(() => {
  Object.assign(globalThis, {
    ReadableStream: NodeReadableStream,
    TextEncoder: NodeTextEncoder,
    TextDecoder: NodeTextDecoder,
  });
});

/** 构造一个分块到达的请求体，可选声明 Content-Length。 */
function source(chunks: string[], contentLength?: number): BodySource {
  const encoder = new NodeTextEncoder();
  const body = new NodeReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }) as unknown as ReadableStream<Uint8Array>;
  return {
    headers: {
      get: (name: string) =>
        name === 'content-length' && contentLength !== undefined
          ? String(contentLength)
          : null,
    },
    body,
  };
}

describe('readJsonBody', () => {
  it('parses JSON split across chunks', async () => {
    const result = await readJsonBody(source(['{"a":', '1}']));
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it('rejects a declared Content-Length over the limit without reading', async () => {
    const result = await readJsonBody(source(['{}'], 999), 10);
    expect(result).toMatchObject({ ok: false, status: 413 });
  });

  it('rejects a chunked body that grows past the limit', async () => {
    const result = await readJsonBody(
      source(['{"a":"', 'x'.repeat(20), '"}']),
      16
    );
    expect(result).toMatchObject({ ok: false, status: 413 });
  });

  it('returns 400 for invalid JSON', async () => {
    const result = await readJsonBody(source(['not json']));
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('treats a missing body as invalid JSON', async () => {
    const result = await readJsonBody({
      headers: { get: () => null },
      body: null,
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });
});
