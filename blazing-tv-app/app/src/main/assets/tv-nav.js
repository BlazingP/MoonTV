/*
 * Blazing TV 遥控器导航脚本。
 * 原生壳在文档开始时注入（addDocumentStartJavaScript），页面提交/加载完成时再兜底注入一次。
 * - 方向键：在可点击元素间移动焦点（空间导航），画面跟随焦点滚动
 * - 确认键：点击当前元素；文本框则进入输入状态并弹出键盘
 * - 播放器全屏时：左右快退/快进，确认键暂停/播放
 * - 返回键：先退出播放器全屏 / 退出输入状态（window.__tvBack）
 */
(function () {
  'use strict';
  if (window.__tvNavInstalled) return;
  window.__tvNavInstalled = true;

  var SEEK_STEP_SECONDS = 10;
  var MEDIA_SEEK_SECONDS = 30;
  var EDGE_TOLERANCE_PX = 8;
  var ORTHOGONAL_WEIGHT = 4;
  var CENTER_WEIGHT = 0.2;
  var SCROLL_RATIO = 0.6;
  var SAFE_MARGIN_PX = 64;
  var OSD_HIDE_MS = 1200;

  var FOCUSABLE = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    'summary',
    '[tabindex]:not([tabindex="-1"])',
    '[role="button"]',
    '[role="tab"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[onclick]',
    '[class*="cursor-pointer"]',
    '.art-video-player',
  ].join(',');
  var TEXT_TYPES = /^(|text|search|url|email|password|number|tel)$/i;
  var SCROLLABLE = /(auto|scroll|overlay)/;
  var DIRECTIONS = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
  };

  var current = null;
  var lastHref = location.href;
  var osd = null;
  var osdTimer = 0;

  // document-start 注入时 DOM 还没解析，等就绪后再加样式（setFocus 时也会再检查一次）
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', installStyle);
  else installStyle();

  // ------------------------------------------------------------ 样式与提示
  function installStyle() {
    if (document.getElementById('tv-nav-style')) return;
    var style = document.createElement('style');
    style.id = 'tv-nav-style';
    style.textContent =
      ':focus:not(.tv-focus){outline:none !important;}' +
      '.tv-focus{outline:3px solid #ff6a00 !important;outline-offset:-3px !important;' +
      'box-shadow:0 0 0 3px rgba(255,106,0,.35),0 0 18px rgba(255,106,0,.55) !important;' +
      'border-radius:8px;transition:box-shadow .12s ease-out;}' +
      '#tv-osd{position:fixed;left:50%;top:12%;transform:translateX(-50%);z-index:2147483647;' +
      'padding:10px 22px;border-radius:999px;background:rgba(0,0,0,.72);color:#fff;' +
      'font:600 22px/1.2 system-ui,sans-serif;pointer-events:none;opacity:0;transition:opacity .15s;}' +
      '#tv-osd.show{opacity:1;}';
    (document.head || document.documentElement).appendChild(style);
  }

  function showOsd(text) {
    var host = document.fullscreenElement || document.body;
    if (!osd || !host.contains(osd)) {
      osd = osd || document.createElement('div');
      osd.id = 'tv-osd';
      host.appendChild(osd);
    }
    osd.textContent = text;
    osd.classList.add('show');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () {
      osd.classList.remove('show');
    }, OSD_HIDE_MS);
  }

  function formatTime(sec) {
    if (!isFinite(sec)) return '--:--';
    var s = Math.max(0, Math.floor(sec));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var ss = s % 60;
    var mm = h > 0 && m < 10 ? '0' + m : String(m);
    return (h > 0 ? h + ':' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
  }

  // ------------------------------------------------------------ 候选元素
  function isTextField(el) {
    if (!el) return false;
    if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
    return (
      el.tagName === 'INPUT' && TEXT_TYPES.test(el.getAttribute('type') || '')
    );
  }

  function isVisible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    if (el.disabled || el.getAttribute('aria-hidden') === 'true') return false;
    var cs = getComputedStyle(el);
    return (
      cs.visibility !== 'hidden' &&
      cs.pointerEvents !== 'none' &&
      parseFloat(cs.opacity) > 0.05
    );
  }

  function candidates() {
    var scope = document.fullscreenElement || document;
    var list = scope.querySelectorAll(FOCUSABLE);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (isVisible(list[i])) out.push(list[i]);
    }
    return out;
  }

  function isAlive(el) {
    return el && document.contains(el) && isVisible(el);
  }

  // ------------------------------------------------------------ 滚动跟随
  /** 由内到外列出 el 所在的可滚动容器；MoonTV 是 <body> 自己滚动，不是 window。 */
  function scrollContainers(el) {
    var list = [];
    for (var p = el.parentElement; p; p = p.parentElement) {
      var cs = getComputedStyle(p);
      var isRoot = p === document.body || p === document.documentElement;
      var canY =
        SCROLLABLE.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1;
      // 整页不做横向滚动，避免页面被推偏、底部冒出横向滚动条
      var canX =
        !isRoot &&
        SCROLLABLE.test(cs.overflowX) &&
        p.scrollWidth > p.clientWidth + 1;
      if (canY || canX) list.push({ el: p, y: canY, x: canX });
    }
    var root = document.scrollingElement;
    if (
      root &&
      root.scrollHeight > root.clientHeight + 1 &&
      !list.some(function (c) {
        return c.el === root;
      })
    ) {
      list.push({ el: root, y: true, x: false });
    }
    return list;
  }

  /** 容器在屏幕上真正可见的区域（与视口取交集）。 */
  function visibleArea(container) {
    var r =
      container === document.scrollingElement || container === document.body
        ? { top: 0, left: 0, bottom: innerHeight, right: innerWidth }
        : container.getBoundingClientRect();
    return {
      top: Math.max(r.top, 0),
      left: Math.max(r.left, 0),
      bottom: Math.min(r.bottom, innerHeight),
      right: Math.min(r.right, innerWidth),
    };
  }

  /** 焦点离开可见区域的安全边距时，把它滚到容器中间；滚动目标用绝对值，连按也不会错位。 */
  function axisDelta(start, end, viewStart, viewEnd) {
    var margin = Math.min(SAFE_MARGIN_PX, (viewEnd - viewStart) / 4);
    if (start >= viewStart + margin && end <= viewEnd - margin) return 0;
    if (end - start > viewEnd - viewStart - 2 * margin)
      return start - viewStart - margin;
    return (start + end) / 2 - (viewStart + viewEnd) / 2;
  }

  function ensureVisible(el) {
    var containers = scrollContainers(el);
    for (var i = 0; i < containers.length; i++) {
      var c = containers[i];
      var r = el.getBoundingClientRect();
      var view = visibleArea(c.el);
      var dy = c.y ? axisDelta(r.top, r.bottom, view.top, view.bottom) : 0;
      var dx = c.x ? axisDelta(r.left, r.right, view.left, view.right) : 0;
      if (Math.abs(dy) < 1 && Math.abs(dx) < 1) continue;
      c.el.scrollTo({
        top: c.el.scrollTop + dy,
        left: c.el.scrollLeft + dx,
        behavior: 'smooth',
      });
    }
  }

  function scrollPage(dir) {
    var from = current || document.body;
    var containers = scrollContainers(from).filter(function (c) {
      return c.y;
    });
    var target = containers.length
      ? containers[containers.length - 1].el
      : document.scrollingElement;
    if (!target) return;
    var step = (dir === 'down' ? 1 : -1) * innerHeight * SCROLL_RATIO;
    target.scrollTo({ top: target.scrollTop + step, behavior: 'smooth' });
  }

  // ------------------------------------------------------------ 空间导航
  function directionalScore(from, to, dir) {
    var primary;
    var orthGap;
    var centerDiff;
    if (dir === 'left' || dir === 'right') {
      primary = dir === 'right' ? to.left - from.right : from.left - to.right;
      orthGap = Math.max(
        0,
        Math.max(from.top, to.top) - Math.min(from.bottom, to.bottom)
      );
      centerDiff = Math.abs(
        (to.top + to.bottom) / 2 - (from.top + from.bottom) / 2
      );
    } else {
      primary = dir === 'down' ? to.top - from.bottom : from.top - to.bottom;
      orthGap = Math.max(
        0,
        Math.max(from.left, to.left) - Math.min(from.right, to.right)
      );
      centerDiff = Math.abs(
        (to.left + to.right) / 2 - (from.left + from.right) / 2
      );
    }
    if (primary < -EDGE_TOLERANCE_PX) return Infinity;
    return (
      Math.max(primary, 0) +
      orthGap * ORTHOGONAL_WEIGHT +
      centerDiff * CENTER_WEIGHT
    );
  }

  function findNext(dir) {
    var from = current.getBoundingClientRect();
    var best = null;
    var bestScore = Infinity;
    var list = candidates();
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el === current || el.contains(current) || current.contains(el))
        continue;
      var score = directionalScore(from, el.getBoundingClientRect(), dir);
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function firstInViewport() {
    // 播放页优先选中播放器，按确认键即可全屏
    var player = document.querySelector('.art-video-player');
    if (player && isVisible(player)) return player;
    var list = candidates();
    var best = null;
    var bestScore = Infinity;
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      if (
        r.bottom < 0 ||
        r.top > innerHeight ||
        r.right < 0 ||
        r.left > innerWidth
      )
        continue;
      var score = Math.max(r.top, 0) * 2 + Math.max(r.left, 0);
      if (score < bestScore) {
        bestScore = score;
        best = list[i];
      }
    }
    return best || list[0] || null;
  }

  function setFocus(el) {
    if (current && current !== el) {
      current.classList.remove('tv-focus');
      current.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    }
    current = el;
    if (!el) return;
    installStyle();
    el.classList.add('tv-focus');
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    // 文本框只高亮不聚焦：否则左右键会被困在框里，确认键也弹不出键盘
    if (!isTextField(el) && typeof el.focus === 'function')
      el.focus({ preventScroll: true });
    // 不可聚焦的元素（如带 cursor-pointer 的 div）不会抢走焦点，需要手动让旧元素失焦
    var active = document.activeElement;
    if (
      active &&
      active !== el &&
      active !== document.body &&
      !el.contains(active)
    )
      active.blur();
    ensureVisible(el);
  }

  function move(dir) {
    if (!isAlive(current)) {
      setFocus(firstInViewport());
      return;
    }
    var next = findNext(dir);
    if (next) {
      setFocus(next);
    } else if (dir === 'up' || dir === 'down') {
      scrollPage(dir);
    }
  }

  // ------------------------------------------------------------ 播放器
  function video() {
    return document.querySelector('video');
  }

  function isPlayerFullscreen() {
    return !!(
      document.fullscreenElement ||
      document.querySelector('.art-fullscreen, .art-fullscreen-web')
    );
  }

  function seek(delta) {
    var v = video();
    if (!v || !isFinite(v.duration)) return;
    v.currentTime = Math.min(
      Math.max(v.currentTime + delta, 0),
      v.duration - 1
    );
    showOsd(
      (delta > 0 ? '⏩ +' : '⏪ ') +
        delta +
        's   ' +
        formatTime(v.currentTime) +
        ' / ' +
        formatTime(v.duration)
    );
  }

  function togglePlay(force) {
    var v = video();
    if (!v) return;
    var shouldPlay = force === 'play' || (force !== 'pause' && v.paused);
    if (shouldPlay) {
      var p = v.play();
      if (p && p.catch)
        p.catch(function () {
          /* 浏览器拒绝自动播放时忽略 */
        });
      showOsd(
        '▶ ' + formatTime(v.currentTime) + ' / ' + formatTime(v.duration)
      );
    } else {
      v.pause();
      showOsd(
        '⏸ ' + formatTime(v.currentTime) + ' / ' + formatTime(v.duration)
      );
    }
  }

  function enterPlayerFullscreen(player) {
    var btn = player.querySelector('.art-control-fullscreen');
    if (btn) btn.click();
    else if (player.requestFullscreen) player.requestFullscreen();
    togglePlay('play');
  }

  function handlePlayerKey(e) {
    var key = e.key;
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      seek(key === 'ArrowRight' ? SEEK_STEP_SECONDS : -SEEK_STEP_SECONDS);
    } else if (key === 'Enter' || key === ' ') {
      togglePlay();
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      var v = video();
      if (v)
        showOsd(formatTime(v.currentTime) + ' / ' + formatTime(v.duration));
    } else {
      return false;
    }
    return true;
  }

  // ------------------------------------------------------------ 按键入口
  function activate() {
    if (!isAlive(current)) {
      setFocus(firstInViewport());
      return;
    }
    if (isTextField(current)) {
      current.focus();
      if (window.TvBridge) window.TvBridge.showKeyboard();
      return;
    }
    if (current.classList.contains('art-video-player')) {
      enterPlayerFullscreen(current);
      return;
    }
    current.click();
  }

  function swallow(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onKeyDown(e) {
    if (location.href !== lastHref) {
      lastHref = location.href;
      setFocus(null);
    }
    // 长按确认键只算一次，避免连点穿透到下一页或反复暂停/播放
    if (e.repeat && (e.key === 'Enter' || e.key === ' ')) {
      swallow(e);
      return;
    }
    if (isPlayerFullscreen()) {
      if (handlePlayerKey(e)) swallow(e);
      return;
    }
    var active = document.activeElement;
    var typing = isTextField(active);
    var dir = DIRECTIONS[e.key];
    if (
      typing &&
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Enter')
    ) {
      return; // 输入状态：左右移动光标，回车交给页面（如提交搜索）
    }
    if (dir) {
      if (typing) active.blur();
      move(dir);
    } else if (e.key === 'Enter') {
      activate();
    } else {
      return;
    }
    swallow(e);
  }

  window.addEventListener('keydown', onKeyDown, true);

  // ------------------------------------------------------------ 原生调用
  window.__tvBack = function () {
    if (document.fullscreenElement) {
      document.exitFullscreen();
      return true;
    }
    var webFull = document.querySelector(
      '.art-fullscreen-web .art-control-fullscreenWeb'
    );
    if (webFull) {
      webFull.click();
      return true;
    }
    var active = document.activeElement;
    if (isTextField(active)) {
      active.blur();
      return true;
    }
    return false;
  };

  window.__tvMedia = function (action) {
    if (action === 'forward') seek(MEDIA_SEEK_SECONDS);
    else if (action === 'rewind') seek(-MEDIA_SEEK_SECONDS);
    else togglePlay(action === 'toggle' ? undefined : action);
  };

  // 播放时保持屏幕常亮，暂停/结束后恢复；原生壳在每次导航后也会调用一次兜底
  function reportPlaying() {
    if (!window.TvBridge) return;
    var vids = document.querySelectorAll('video');
    var playing = false;
    for (var i = 0; i < vids.length; i++) {
      if (!vids[i].paused && !vids[i].ended) playing = true;
    }
    window.TvBridge.setPlaying(playing);
  }
  window.__tvReportPlaying = reportPlaying;
  ['play', 'playing', 'pause', 'ended', 'emptied'].forEach(function (type) {
    document.addEventListener(type, reportPlaying, true);
  });
})();
