'use strict';

/**
 * pw-recorder v2 —— 浏览器内的录制 Agent。
 *
 * 和 v1 的区别：不需要 Node / Playwright 启动浏览器，页面里引一个 <script> 就能录。
 *   <script src="dist/pw-agent.js"></script>          // 引入即自动开始录制
 *   <script src="dist/pw-agent.js?autoInit=false"></script>
 *   <script>PWAgent.init({ autoStart: false });</script>
 *
 * 录制跨页可续：状态存在 sessionStorage（同一标签页内），刷新/跳转后自动接上。
 */

const installRecorder = require('../injected');
const installHighlight = require('../highlight-client');
const installUI = require('./ui');
const { LANGS, byId } = require('../lang');

const VERSION = '2.0.0';
const STATE_KEY = '__pw_agent_v2_state__';

/** 会自己触发导航的动作：这之后换页不需要补 goto */
const NAVIGATING = { click: true, dblclick: true, press: true };

const state = {
  installed: false,
  recording: false,
  actions: [],
  ui: null,
  options: {
    title: 'recorded flow',
    highlight: true,
    autoStart: true,
    autoInit: true,
    persist: true,
  },
};

// ---------------------------------------------------------------- 持久化

function save() {
  if (!state.options.persist) return;
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify({
      actions: state.actions,
      recording: state.recording,
      title: state.options.title,
      url: location.href,
    }));
  } catch (e) { /* 隐私模式/被禁用：不影响录制本身 */ }
}

function load() {
  if (!state.options.persist) return null;
  try {
    const raw = sessionStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function clearSaved() {
  try { sessionStorage.removeItem(STATE_KEY); } catch (e) { /* 忽略 */ }
}

// ---------------------------------------------------------------- 动作收集

const sameTarget = (a, b) => !!a && !!b
  && a.tagPath === b.tagPath && a.testId === b.testId
  && a.ariaLabel === b.ariaLabel && a.id === b.id;

/**
 * 与 v1 的 Recorder 保持同一套去重规则：
 *   - 浏览器在 dblclick 前必发两次 click，丢掉它们
 *   - 连续重复的 hover 只留一次
 */
function collect(evt) {
  if (!state.recording) return;

  if (evt.type === 'dblclick') {
    let dropped = 0;
    while (dropped < 2 && state.actions.length) {
      const last = state.actions[state.actions.length - 1];
      if (last.type !== 'click' || !sameTarget(last.target, evt.target)) break;
      state.actions.pop();
      dropped++;
    }
  }

  const last = state.actions[state.actions.length - 1];
  if (evt.type === 'hover' && last && last.type === 'hover' && sameTarget(last.target, evt.target)) return;

  state.actions.push(evt);
  save();
  paint();
}

function paint() {
  if (state.ui) state.ui.paint();
}

// ---------------------------------------------------------------- 录制控制

function start() {
  if (!state.installed) init();
  if (!state.recording) {
    // 全新录制时先记一条 goto 作为起点；恢复了会话或从暂停继续时不重复记
    if (!state.actions.length) {
      state.actions.push({ type: 'goto', url: location.href });
    }
    state.recording = true;
  }
  try { window.__pwRecorderSetEnabled && window.__pwRecorderSetEnabled(true); } catch (e) { /* 忽略 */ }
  save();
  paint();
  return state.actions.length;
}

function pause() {
  state.recording = false;
  try { window.__pwRecorderSetEnabled && window.__pwRecorderSetEnabled(false); } catch (e) { /* 忽略 */ }
  save();
  paint();
}

const stop = pause;

function reset() {
  state.actions = [];
  clearSaved();
  paint();
}

// ---------------------------------------------------------------- 初始化

function scriptOptions() {
  const scripts = Array.prototype.slice.call(document.scripts || []);
  const me = scripts.filter((s) => s.src && /pw-agent(\.min)?\.js(\?|$)/.test(s.src))[0];
  if (!me) return {};
  const out = {};

  // 'false'/'true' 必须转成布尔：否则 ?autoInit=false 得到字符串 'false'，
  // 与 false 的严格比较永远不成立，参数就静默失效了。
  const coerce = (v) => (v === 'false' ? false : v === 'true' ? true : v);

  const q = me.src.split('?')[1];
  if (q) {
    q.split('&').forEach((kv) => {
      if (!kv) return;
      const pair = kv.split('=');
      out[decodeURIComponent(pair[0])] = pair.length > 1 ? coerce(decodeURIComponent(pair[1])) : true;
    });
  }

  Array.prototype.forEach.call(me.attributes || [], (a) => {
    if (a.name.indexOf('data-') !== 0) return;
    const key = a.name.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase());
    out[key] = coerce(a.value);
  });

  return out;
}

function init(options) {
  const opts = Object.assign({}, state.options, scriptOptions(), options || {});
  state.options = opts;

  if (!state.installed) {
    state.installed = true;

    // 页面 → Agent 的事件桥（v1 里由 Playwright 的 exposeFunction 提供，这里直接挂全局）
    window.__pwRecorderEmit = collect;

    if (opts.highlight) {
      try { installHighlight(); } catch (e) { /* 高亮坏了不影响录制 */ }
    }
    installRecorder();   // 自带幂等保护

    // 恢复上一次会话（刷新/跳转后继续）
    const saved = load();
    if (saved && saved.actions && saved.actions.length) {
      state.actions = saved.actions;
      state.recording = !!saved.recording;
      if (saved.title) state.options.title = saved.title;

      const last = state.actions[state.actions.length - 1];
      const navigated = saved.url && saved.url !== location.href;
      if (state.recording && navigated && !(last && NAVIGATING[last.type])) {
        // 不是被点击带过去的（比如用户手输了地址），补一条 goto
        state.actions.push({ type: 'goto', url: location.href });
      }
    }
  }

  state.ui = installUI(api);

  if (state.recording) {
    try { window.__pwRecorderSetEnabled && window.__pwRecorderSetEnabled(true); } catch (e) { /* 忽略 */ }
  } else if (state.options.autoStart && !state.actions.length) {
    start();
  }

  if (state.options.title && state.options.title !== 'recorded flow') save();
  paint();
  return api;
}

/**
 * 自动初始化：读 <script> 上的 data-* / 查询参数决定行为。
 *   ?autoInit=false / data-auto-init="false"  → 只挂 API，什么都不显示
 *   扩展注入（没有 script 标签）              → 显示控件但不自动开录，等用户点开始
 */
function autoInit() {
  const opts = scriptOptions();
  if (opts.autoInit === false) return api;

  const inExtension = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
  const override = inExtension && opts.autoStart === undefined ? { autoStart: false } : undefined;
  return init(override);
}

// ---------------------------------------------------------------- 对外 API

const api = {
  version: VERSION,
  init,
  autoInit,
  start,
  pause,
  stop,
  reset,
  getActions: () => state.actions.slice(),
  actionCount: () => state.actions.length,
  isRecording: () => state.recording,
  getTitle: () => state.options.title,
  setTitle: (t) => { state.options.title = String(t || 'recorded flow'); save(); return api; },
  getOptions: () => Object.assign({}, state.options),
  languages: () => LANGS.map((l) => ({ id: l.id, label: l.label, hint: l.hint })),
  filename: (langId) => {
    const lang = byId(langId);
    return lang ? lang.filename(state.options.title) : null;
  },
  /** 生成指定语言的脚本（CI/测试直接用这个拿字符串） */
  export: (langId) => {
    const lang = byId(langId || 'javascript');
    if (!lang) throw new Error('未知语言: ' + langId);
    return lang.generate(state.actions, {
      title: state.options.title,
      filename: lang.filename(state.options.title),
      highlight: false,
      headless: false,
    });
  },
  openExport: () => { state.ui && state.ui.openExport(); },
  closeExport: () => { state.ui && state.ui.closeExport(); },
  clearSaved,
};

if (typeof window !== 'undefined') window.PWAgent = api;

module.exports = api;
