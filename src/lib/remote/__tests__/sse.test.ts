/**
 * @jest-environment node
 */
import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import {
  TextDecoder as NodeTextDecoder,
  TextEncoder as NodeTextEncoder,
} from 'node:util';

import {
  createSseResponse,
  SSE_HEADERS,
  SSE_MAX_BACKLOG,
  SseChannel,
} from '../sse';

// Jest 的 node 沙箱不暴露 Web Streams / Response，这里补最小实现。
class FakeResponse {
  readonly body: ReadableStream<Uint8Array>;
  readonly headers: Map<string, string>;

  constructor(body: ReadableStream<Uint8Array>, init: ResponseInit) {
    this.body = body;
    this.headers = new Map(
      Object.entries((init.headers ?? {}) as Record<string, string>)
    );
  }
}

beforeAll(() => {
  Object.assign(globalThis, {
    ReadableStream: NodeReadableStream,
    TextEncoder: NodeTextEncoder,
    TextDecoder: NodeTextDecoder,
    Response: FakeResponse,
  });
});

function fakeRequest(controller: AbortController): Request {
  return { signal: controller.signal } as Request;
}

function bodyOf(response: Response): ReadableStream<Uint8Array> {
  if (!response.body) throw new Error('response has no body');
  return response.body;
}

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const { value } = await reader.read();
  return new TextDecoder().decode(value);
}

describe('createSseResponse', () => {
  it('sets the SSE headers and streams named events', async () => {
    const controller = new AbortController();
    const response = createSseResponse(fakeRequest(controller), ({ send }) => {
      send('status', { a: 1 });
    });
    for (const [key, value] of Object.entries(SSE_HEADERS)) {
      expect(response.headers.get(key)).toBe(value);
    }
    const reader = bodyOf(response).getReader();
    expect(await readChunk(reader)).toBe(': connected\n\n');
    expect(await readChunk(reader)).toBe('event: status\ndata: {"a":1}\n\n');
    controller.abort();
  });

  it('runs teardown exactly once on abort and stops the heartbeat', async () => {
    const controller = new AbortController();
    const teardown = jest.fn();
    const response = createSseResponse(
      fakeRequest(controller),
      () => teardown,
      10
    );
    const reader = bodyOf(response).getReader();
    await readChunk(reader);
    expect(await readChunk(reader)).toBe(': ping\n\n');
    controller.abort();
    controller.abort();
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it('runs teardown when the consumer cancels', async () => {
    const controller = new AbortController();
    const teardown = jest.fn();
    const response = createSseResponse(fakeRequest(controller), () => teardown);
    await bodyOf(response).cancel();
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it('disconnects a client that stops reading once the backlog is too large', () => {
    const controller = new AbortController();
    const teardown = jest.fn();
    let channel: SseChannel | null = null;
    createSseResponse(fakeRequest(controller), (c) => {
      channel = c;
      return teardown;
    });
    const send = (channel as unknown as SseChannel).send;
    const flood = () => {
      for (let i = 0; i <= SSE_MAX_BACKLOG + 2; i++) send('status', { i });
    };
    expect(flood).toThrow('SSE stream closed');
    expect(teardown).toHaveBeenCalledTimes(1);
    controller.abort();
  });

  it('runs teardown when setup closes the stream synchronously', () => {
    const controller = new AbortController();
    const teardown = jest.fn();
    createSseResponse(fakeRequest(controller), ({ close }) => {
      close();
      return teardown;
    });
    expect(teardown).toHaveBeenCalledTimes(1);
  });
});
