# 电视遥控协议（Blazing TV ⇄ MoonTV）

手机/电脑打开 MoonTV 的 `/remote` 页面，遥控 Blazing TV APP 里正在播放的 MoonTV。

```
遥控页 /remote ──POST /api/remote/command──▶ MoonTV 服务器（内存中转）──SSE command──▶ Blazing TV
遥控页 /remote ◀──SSE status──────────────── MoonTV 服务器 ◀──POST /api/remote/tv/status── Blazing TV
```

设计约束：

- **只有 Blazing TV APP 会连接中转站并执行命令**（APP 注入的 `tv-remote.js`）。普通浏览器打开 MoonTV 不会连接、不会被控制。
- 中转站状态只放在服务器进程内存里（MoonTV 是单个 Node 进程）；重启后电视会自动重连。
- 不做配对码（家庭局域网使用）。接口沿用现有 middleware 的登录校验。
- 所有 SSE 路由：`export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';`，响应头 `Content-Type: text/event-stream`、`Cache-Control: no-cache, no-transform`、`Connection: keep-alive`、`X-Accel-Buffering: no`，每 15 秒发一次注释心跳 `: ping\n\n`，`request.signal` abort 时清理订阅。

## 数据结构（`src/lib/remote/types.ts`）

```ts
export interface RemoteEpisode {
  index: number;
  label: string;
} // label 如 "第 3 集" 或分集名

export interface RemoteStatus {
  path: string; // 当前页面路径（含 query），如 "/play?source=ffzy&id=1"
  page: 'play' | 'other';
  title?: string;
  year?: string;
  source?: string;
  id?: string;
  poster?: string;
  episodeIndex?: number; // 0 基
  totalEpisodes?: number;
  episodes?: RemoteEpisode[]; // 仅在集数变化或首次上报时带上，最多 500 条
  currentTime?: number; // 秒
  duration?: number; // 秒（未知时省略）
  paused?: boolean;
  fullscreen?: boolean;
  updatedAt: number; // 电视端 Date.now()
}

export interface RemoteDevice {
  deviceId: string; // 电视端生成并持久化的随机 id，/^[a-zA-Z0-9_-]{8,64}$/
  name: string; // 显示名，最长 40 字符，默认 "Blazing TV"
  online: boolean;
  lastSeen: number;
  status: RemoteStatus | null;
}

export type RemoteCommand =
  | { type: 'toggle' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; time: number } // 绝对秒数，>= 0
  | { type: 'seekBy'; delta: number } // 相对秒数，-600..600
  | { type: 'episode'; index: number } // 0 基
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'fullscreen'; on: boolean }
  | { type: 'navigate'; url: string } // 只允许以 "/" 开头、不以 "//" 开头的站内路径，最长 2048
  | { type: 'home' };
```

服务端必须用白名单校验命令（类型、字段类型、数值范围、navigate 的 url），不合法返回 400。

## 接口

| 方法 | 路径                                            | 调用方 | 说明                                                                                                                                         |
| ---- | ----------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| GET  | `/api/remote/tv/events?device=<id>&name=<name>` | 电视   | SSE。连接即表示电视在线；推送 `event: command`，`data` 为 `RemoteCommand` JSON。同一 deviceId 新连接到来时关闭旧连接。断开后设备标记为离线。 |
| POST | `/api/remote/tv/status`                         | 电视   | body `{ deviceId, status: RemoteStatus }`。更新最新状态并广播给遥控页。返回 `{ ok: true }`。body 最大 64KB。                                 |
| GET  | `/api/remote/devices`                           | 遥控页 | 返回 `{ devices: RemoteDevice[] }`（在线优先，最近活跃排序；离线超过 10 分钟的不返回）。                                                     |
| GET  | `/api/remote/events?device=<id>`                | 遥控页 | SSE。连接时先推一次 `event: status`（当前 `RemoteDevice`），之后每次状态或在线状态变化推 `event: status`。                                   |
| POST | `/api/remote/command`                           | 遥控页 | body `{ deviceId, command: RemoteCommand }`。电视在线则推送并返回 `{ ok: true }`；离线返回 404 `{ ok: false, error: '电视不在线' }`。        |

## 播放页控制接口（`window.__moontvPlayer`）

`src/app/play/page.tsx` 在播放器就绪后挂到 window 上，卸载时删除。只是暴露现有能力，不改变页面原有行为。

```ts
interface MoonTvPlayerApi {
  getState(): Omit<RemoteStatus, 'path' | 'page' | 'updatedAt'>; // episodes 每次都给，由电视端决定是否上报
  play(): void;
  pause(): void;
  toggle(): void;
  seek(time: number): void; // 夹在 [0, duration-1]
  setEpisode(index: number): void; // 复用 handleEpisodeChange
  next(): void; // 复用 handleNextEpisode
  prev(): void; // 复用 handlePreviousEpisode
  setFullscreen(on: boolean): void; // 用 ArtPlayer 的 fullscreen
}
```

## 电视端（`blazing-tv-app/app/src/main/assets/tv-remote.js`）

- 只在页面 origin 为 http(s) 且存在 `window.TvBridge` 时启动（本地错误页 `file://` 不启动）。
- deviceId 存 `localStorage['blazingtv:deviceId']`，不存在时随机生成 16 位。
- 用 `EventSource` 连接 `/api/remote/tv/events`，断线由浏览器自动重连；收到 `command` 时执行。
- 在播放页优先用 `window.__moontvPlayer`，没有时退回直接操作 `<video>`。
- `navigate`：再次校验站内路径后 `location.assign(url)`；`home`：`location.assign('/')`。
- 状态上报：播放页每 1 秒一次，其他页面每 5 秒一次，命令执行后立即上报一次；`episodes` 只在集数列表变化时带上。用 `fetch(..., { keepalive: true })`，失败静默重试。
