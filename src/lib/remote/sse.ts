// SSE 响应构造：统一响应头、15 秒心跳，以及断开时的清理。

export const SSE_HEARTBEAT_MS = 15_000;

/**
 * 队列里积压的事件数上限。客户端锁屏/冻结但 TCP 没断时，数据会一直堆在服务端；
 * 超过就主动断开，客户端恢复后 EventSource 会自动重连并先拿到全量状态。
 */
export const SSE_MAX_BACKLOG = 32;

export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

export interface SseChannel {
  /** 推送具名事件，data 序列化为 JSON；流已关闭时抛错。 */
  send: (event: string, data: unknown) => void;
  /** 主动结束流。 */
  close: () => void;
}

/**
 * setup 在流建立后调用，可返回清理函数；
 * 客户端断开（request.signal abort / stream cancel）或 close() 时清理函数恰好执行一次。
 */
export type SseSetup = (channel: SseChannel) => (() => void) | void;

export function createSseResponse(
  request: Request,
  setup: SseSetup,
  heartbeatMs: number = SSE_HEARTBEAT_MS
): Response {
  const encoder = new TextEncoder();
  let finish: () => void = () => undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const handle: {
        teardown?: (() => void) | void;
        timer?: ReturnType<typeof setInterval>;
      } = {};

      const write = (chunk: string) => {
        if (closed) throw new Error('SSE stream closed');
        controller.enqueue(encoder.encode(chunk));
        const desired = controller.desiredSize;
        if (desired !== null && desired < -SSE_MAX_BACKLOG) finish();
      };

      finish = () => {
        if (closed) return;
        closed = true;
        if (handle.timer) clearInterval(handle.timer);
        request.signal.removeEventListener('abort', finish);
        try {
          handle.teardown?.();
        } finally {
          try {
            controller.close();
          } catch {
            // 流可能已被取消
          }
        }
      };

      const channel: SseChannel = {
        send: (event, data) =>
          write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        close: () => finish(),
      };

      request.signal.addEventListener('abort', finish);
      write(': connected\n\n');
      handle.timer = setInterval(() => {
        try {
          write(': ping\n\n');
        } catch {
          finish();
        }
      }, heartbeatMs);

      handle.teardown = setup(channel);
      if (closed) {
        // setup 期间流已被关闭，清理函数尚未登记，这里补执行
        handle.teardown?.();
      } else if (request.signal.aborted) {
        finish();
      }
    },
    cancel() {
      finish();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
