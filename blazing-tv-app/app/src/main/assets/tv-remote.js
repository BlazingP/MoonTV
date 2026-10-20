/*
 * Blazing TV 电视遥控脚本（协议见 docs/tv-remote.md）。
 * 原生壳与 tv-nav.js 一起注入；只在顶层 http(s) 页面且存在 window.TvBridge 时启动。
 * - EventSource 订阅 /api/remote/tv/events，收到 command 事件后校验并执行
 * - 定时把播放状态 POST 到 /api/remote/tv/status
 * - 播放页优先走 window.__moontvPlayer，没有时直接操作 <video>
 */
(function () {
  'use strict';
  if (window.__tvRemoteInstalled) return;
  if (!isHttpPage() || !isTopFrame()) return;
  window.__tvRemoteInstalled = true;

  var DEVICE_ID_KEY = 'blazingtv:deviceId';
  var DEVICE_ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;
  var DEVICE_ID_LENGTH = 16;
  var DEVICE_ID_ALPHABET =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  var DEVICE_NAME = 'Blazing TV';
  var EVENTS_PATH = '/api/remote/tv/events';
  var STATUS_PATH = '/api/remote/tv/status';

  var TICK_MS = 1000;
  var PLAY_REPORT_MS = 1000;
  var OTHER_REPORT_MS = 5000;
  var BACKOFF_REPORT_MS = 10000;
  var FAILURES_BEFORE_BACKOFF = 3;
  var HEARTBEAT_MS = 5000;
  var AFTER_COMMAND_DELAY_MS = 300;
  var REPORT_TIMEOUT_MS = 8000;
  var RECONNECT_MIN_MS = 3000;
  var RECONNECT_MAX_MS = 30000;
  var EVENT_SOURCE_CLOSED = 2;

  var MAX_EPISODES = 500;
  var MAX_URL_LENGTH = 2048;
  var MAX_SEEK_BY_SECONDS = 600;
  var MAX_TITLE_LENGTH = 200;
  var MAX_SHORT_TEXT_LENGTH = 128;
  var MAX_LABEL_LENGTH = 24;

  var deviceId = '';
  var source = null;
  var reconnectTimer = 0;
  var reconnectDelay = RECONNECT_MIN_MS;

  var lastHref = location.href;
  var lastKey = '';
  var lastSentAt = 0;
  var lastEpisodesSig = null;
  var nextReportAt = 0;
  var failures = 0;
  var inflight = false;
  var pendingForce = false;

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', start);
  else start();

  function isHttpPage() {
    return location.protocol === 'http:' || location.protocol === 'https:';
  }

  // 注入脚本对所有 frame 生效，广告/内嵌 iframe 不能抢占同一个 deviceId 的连接
  function isTopFrame() {
    try {
      return window.top === window;
    } catch (e) {
      return false;
    }
  }

  function start() {
    if (source || reconnectTimer || !window.TvBridge) return;
    deviceId = loadDeviceId();
    connect();
    setInterval(tick, TICK_MS);
    window.addEventListener('pagehide', closeSource);
  }

  // ------------------------------------------------------------ 设备 id
  function loadDeviceId() {
    var id = null;
    try {
      id = localStorage.getItem(DEVICE_ID_KEY);
    } catch (e) {
      id = null;
    }
    if (id && DEVICE_ID_PATTERN.test(id)) return id;
    id = randomId();
    try {
      localStorage.setItem(DEVICE_ID_KEY, id);
    } catch (e) {
      // 存储不可用时退回内存 id，本次页面内保持稳定
    }
    return id;
  }

  function randomId() {
    var out = '';
    var limit = 256 - (256 % DEVICE_ID_ALPHABET.length);
    while (out.length < DEVICE_ID_LENGTH) {
      var byte = randomByte();
      if (byte < limit)
        out += DEVICE_ID_ALPHABET.charAt(byte % DEVICE_ID_ALPHABET.length);
    }
    return out;
  }

  function randomByte() {
    try {
      var buf = new Uint8Array(1);
      window.crypto.getRandomValues(buf);
      return buf[0];
    } catch (e) {
      return Math.floor(Math.random() * 256);
    }
  }

  // ------------------------------------------------------------ SSE 连接
  function connect() {
    closeSource();
    var url =
      EVENTS_PATH +
      '?device=' +
      encodeURIComponent(deviceId) +
      '&name=' +
      encodeURIComponent(DEVICE_NAME);
    var es = new EventSource(url);
    source = es;
    es.addEventListener('command', onCommandEvent);
    es.onopen = function () {
      reconnectDelay = RECONNECT_MIN_MS;
      lastEpisodesSig = null; // 服务器可能重启过，重新带上分集列表
      report(true);
    };
    es.onerror = function () {
      // 浏览器会自动重连；遇到 HTTP 错误（如未登录）连接会被彻底关闭，需要自己重建
      if (es.readyState === EVENT_SOURCE_CLOSED) scheduleReconnect();
    };
  }

  function closeSource() {
    if (!source) return;
    try {
      source.close();
    } catch (e) {
      // 关闭失败无需处理
    }
    source = null;
  }

  function scheduleReconnect() {
    closeSource();
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = 0;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  function onCommandEvent(event) {
    var command = parseCommand(event.data);
    if (!command) return;
    try {
      execute(command);
    } catch (e) {
      // 单条命令失败不影响后续命令
    }
    setTimeout(function () {
      report(true);
    }, AFTER_COMMAND_DELAY_MS);
  }

  // ------------------------------------------------------------ 命令校验
  function isFiniteNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function isIndex(value) {
    return isFiniteNumber(value) && value >= 0 && Math.floor(value) === value;
  }

  // 站内路径：以 "/" 开头、不以 "//" 开头、无反斜杠和空白/控制字符
  // （浏览器会吞掉 \t \n，"/\t/evil.com" 会变成 "//evil.com"）
  function isSafePath(url) {
    if (typeof url !== 'string') return false;
    if (url.length < 1 || url.length > MAX_URL_LENGTH) return false;
    if (url.charAt(0) !== '/' || url.charAt(1) === '/') return false;
    for (var i = 0; i < url.length; i++) {
      var code = url.charCodeAt(i);
      if (code <= 0x20 || code === 0x7f || code === 0x5c) return false;
    }
    try {
      return new URL(url, location.origin).origin === location.origin;
    } catch (e) {
      return false;
    }
  }

  function parseCommand(raw) {
    var c;
    try {
      c = JSON.parse(raw);
    } catch (e) {
      return null;
    }
    if (!c || typeof c !== 'object' || typeof c.type !== 'string') return null;
    switch (c.type) {
      case 'toggle':
      case 'play':
      case 'pause':
      case 'next':
      case 'prev':
      case 'home':
        return { type: c.type };
      case 'seek':
        if (!isFiniteNumber(c.time) || c.time < 0) return null;
        return { type: 'seek', time: c.time };
      case 'seekBy':
        if (!isFiniteNumber(c.delta)) return null;
        if (Math.abs(c.delta) > MAX_SEEK_BY_SECONDS) return null;
        return { type: 'seekBy', delta: c.delta };
      case 'episode':
        if (!isIndex(c.index)) return null;
        return { type: 'episode', index: c.index };
      case 'fullscreen':
        if (typeof c.on !== 'boolean') return null;
        return { type: 'fullscreen', on: c.on };
      case 'navigate':
        if (!isSafePath(c.url)) return null;
        return { type: 'navigate', url: c.url };
      default:
        return null;
    }
  }

  // ------------------------------------------------------------ 命令执行
  function video() {
    return document.querySelector('video');
  }

  function viaPlayer(method, arg) {
    var player = window.__moontvPlayer;
    if (!player || typeof player[method] !== 'function') return false;
    try {
      player[method](arg);
      return true;
    } catch (e) {
      return false;
    }
  }

  function ignoreError() {
    // 播放/全屏请求被浏览器拒绝时无需处理
  }

  function swallow(promise) {
    if (promise && typeof promise.catch === 'function')
      promise.catch(ignoreError);
  }

  function playVideo() {
    var v = video();
    if (v) swallow(v.play());
  }

  function pauseVideo() {
    var v = video();
    if (v) v.pause();
  }

  function toggleVideo() {
    var v = video();
    if (!v) return;
    if (v.paused) swallow(v.play());
    else v.pause();
  }

  function seekVideo(time) {
    var v = video();
    if (!v) return;
    var max =
      isFinite(v.duration) && v.duration > 1 ? v.duration - 1 : Infinity;
    v.currentTime = Math.min(Math.max(time, 0), max);
  }

  function seekTo(time) {
    if (!viaPlayer('seek', time)) seekVideo(time);
  }

  function seekBy(delta) {
    var v = video();
    var base = v ? v.currentTime : readPlayerState().currentTime;
    if (!isFiniteNumber(base)) return;
    seekTo(Math.max(base + delta, 0));
  }

  function isFullscreen() {
    return !!(
      document.fullscreenElement ||
      document.querySelector('.art-fullscreen, .art-fullscreen-web')
    );
  }

  // 远程命令没有用户手势，浏览器会拒绝真正的全屏，所以进入时点“网页全屏”按钮
  function setFullscreenFallback(on) {
    if (isFullscreen() === on) return;
    if (!on && document.fullscreenElement && document.exitFullscreen) {
      swallow(document.exitFullscreen());
      return;
    }
    var btn = document.querySelector('.art-control-fullscreenWeb');
    if (btn) btn.click();
  }

  function execute(command) {
    switch (command.type) {
      case 'play':
        if (!viaPlayer('play')) playVideo();
        break;
      case 'pause':
        if (!viaPlayer('pause')) pauseVideo();
        break;
      case 'toggle':
        if (!viaPlayer('toggle')) toggleVideo();
        break;
      case 'seek':
        seekTo(command.time);
        break;
      case 'seekBy':
        seekBy(command.delta);
        break;
      case 'episode':
        viaPlayer('setEpisode', command.index);
        break;
      case 'next':
        viaPlayer('next');
        break;
      case 'prev':
        viaPlayer('prev');
        break;
      case 'fullscreen':
        if (!viaPlayer('setFullscreen', command.on))
          setFullscreenFallback(command.on);
        break;
      case 'navigate':
        if (isSafePath(command.url)) location.assign(command.url);
        break;
      case 'home':
        location.assign('/');
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------ 状态采集
  function isPlayPage() {
    return location.pathname.indexOf('/play') === 0;
  }

  function text(value, max) {
    return typeof value === 'string' ? value.slice(0, max) : undefined;
  }

  function sanitizeEpisodes(list) {
    if (!Array.isArray(list)) return undefined;
    var out = [];
    for (var i = 0; i < list.length && out.length < MAX_EPISODES; i++) {
      var item = list[i];
      if (!item || !isIndex(item.index)) continue;
      out.push({
        index: item.index,
        label: text(item.label, MAX_LABEL_LENGTH) || '',
      });
    }
    return out;
  }

  function copyIf(target, key, value) {
    if (value !== undefined) target[key] = value;
  }

  function numberOrUndefined(value, round) {
    if (!isFiniteNumber(value)) return undefined;
    return round ? Math.round(value * 10) / 10 : value;
  }

  // 只复制白名单字段，避免页面侧状态把意外内容带进上报
  function sanitizeState(state) {
    var out = {};
    copyIf(out, 'title', text(state.title, MAX_TITLE_LENGTH));
    copyIf(out, 'year', text(state.year, MAX_SHORT_TEXT_LENGTH));
    copyIf(out, 'source', text(state.source, MAX_SHORT_TEXT_LENGTH));
    copyIf(out, 'id', text(state.id, MAX_SHORT_TEXT_LENGTH));
    copyIf(out, 'poster', text(state.poster, MAX_URL_LENGTH));
    if (isIndex(state.episodeIndex)) out.episodeIndex = state.episodeIndex;
    if (isIndex(state.totalEpisodes)) out.totalEpisodes = state.totalEpisodes;
    copyIf(out, 'currentTime', numberOrUndefined(state.currentTime, true));
    var duration = numberOrUndefined(state.duration, true);
    if (duration > 0) out.duration = duration;
    if (typeof state.paused === 'boolean') out.paused = state.paused;
    if (typeof state.fullscreen === 'boolean')
      out.fullscreen = state.fullscreen;
    copyIf(out, 'episodes', sanitizeEpisodes(state.episodes));
    return out;
  }

  function readPlayerState() {
    var player = window.__moontvPlayer;
    if (!player || typeof player.getState !== 'function') return {};
    try {
      var state = player.getState();
      return state && typeof state === 'object' ? sanitizeState(state) : {};
    } catch (e) {
      return {};
    }
  }

  function readVideoState() {
    var v = video();
    var state = { title: document.title };
    if (v) {
      state.currentTime = v.currentTime;
      state.duration = v.duration;
      state.paused = v.paused;
    }
    return sanitizeState(state);
  }

  function buildStatus() {
    var state = readPlayerState();
    var base = readVideoState();
    // 播放器 API 给出的字段优先，缺失的用 <video> / document.title 补齐
    var status = {
      path: location.pathname + location.search,
      page: isPlayPage() ? 'play' : 'other',
    };
    Object.keys(base).forEach(function (k) {
      status[k] = base[k];
    });
    Object.keys(state).forEach(function (k) {
      status[k] = state[k];
    });
    if (typeof status.fullscreen !== 'boolean')
      status.fullscreen = isFullscreen();
    status.updatedAt = Date.now();
    return status;
  }

  // ------------------------------------------------------------ 状态上报
  // 签名带上 source/id：换源后集数和标签可能都一样，但服务器会因视频变了丢弃旧列表，必须重发
  function episodesSignature(status) {
    var episodes = status.episodes;
    if (!episodes || !episodes.length) return '';
    var parts = [status.source || '', status.id || '', episodes.length];
    for (var i = 0; i < episodes.length; i++)
      parts.push(episodes[i].index + ':' + episodes[i].label);
    return parts.join('|');
  }

  // 不含 updatedAt / episodes 的状态指纹，用来判断“除时间戳外没有变化”
  function statusKey(status, episodesSig) {
    var rest = {};
    Object.keys(status).forEach(function (k) {
      if (k !== 'updatedAt' && k !== 'episodes') rest[k] = status[k];
    });
    return JSON.stringify(rest) + '#' + episodesSig;
  }

  function reportInterval() {
    if (failures >= FAILURES_BEFORE_BACKOFF) return BACKOFF_REPORT_MS;
    return isPlayPage() ? PLAY_REPORT_MS : OTHER_REPORT_MS;
  }

  function tick() {
    var changed = location.href !== lastHref;
    lastHref = location.href;
    if (changed || Date.now() >= nextReportAt) report(changed);
  }

  function report(force) {
    if (inflight) {
      if (force) pendingForce = true;
      return;
    }
    var now = Date.now();
    nextReportAt = now + reportInterval();
    var status = buildStatus();
    var sig = episodesSignature(status);
    var key = statusKey(status, sig);
    if (!force && key === lastKey && now - lastSentAt < HEARTBEAT_MS) return;
    var withEpisodes = sig !== '' && sig !== lastEpisodesSig;
    if (sig === '') lastEpisodesSig = null; // 离开播放页后服务器可能丢掉分集，回来时重发
    if (!withEpisodes) delete status.episodes;
    send(status, function () {
      lastKey = key;
      lastSentAt = now;
      if (withEpisodes) lastEpisodesSig = sig;
    });
  }

  function send(status, onSuccess) {
    inflight = true;
    // 请求挂住时 inflight 会一直为 true、上报停摆，所以加超时
    var controller =
      typeof AbortController === 'function' ? new AbortController() : null;
    var timeout = setTimeout(function () {
      if (controller) controller.abort();
    }, REPORT_TIMEOUT_MS);
    var request;
    try {
      request = fetch(STATUS_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId, status: status }),
        keepalive: true,
        signal: controller ? controller.signal : undefined,
      });
    } catch (e) {
      request = Promise.reject(e);
    }
    request
      .then(function (res) {
        if (!res.ok) throw new Error('status ' + res.status);
        failures = 0;
        onSuccess();
      })
      .catch(function () {
        failures++;
        nextReportAt = Date.now() + reportInterval();
      })
      .then(function () {
        clearTimeout(timeout);
        inflight = false;
        if (!pendingForce) return;
        pendingForce = false;
        report(true);
      });
  }
})();
