/*! pw-recorder v2.0.0 browser agent | 由 scripts/build-agent.js 生成，请勿手改 */
(function (global) {
  'use strict';
  var __modules = {};
  var __cache = {};
  function __require(id) {
    if (__cache[id]) return __cache[id].exports;
    var module = { exports: {} };
    __cache[id] = module;
    __modules[id](module, module.exports, __require);
    return module.exports;
  }
  __modules["src/CodeGenerator.js"] = function (module, exports, __require) {
'use strict';

/**
 * 动作 → Playwright 代码（JavaScript / @playwright/test）。
 *
 * 选择器策略在这里解析成"与语言无关的 locator 描述"（resolveLocator），
 * Python / Java 生成器复用同一个描述，保证三种语言选出来的元素完全一致。
 */

const escapeStr = (s) =>
  String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    .replace(/\r/g, '\\r').replace(/\n/g, '\\n');

const cssId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);

function inferRole(t) {
  if (t.role) return t.role;
  const tag = t.tag, type = (t.type || '').toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a') return 'link';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    if (['submit','button','reset','image'].includes(type)) return 'button';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    return 'textbox';
  }
  return '';
}

/** 页面里同类元素不止一个时必须带 .nth()，否则回放会 strict mode violation */
const nthOf = (m) => (m && m.n > 1 && typeof m.i === 'number' && m.i >= 0 ? m.i : null);

/**
 * 元素描述 → 语言无关的 locator 描述
 *   { kind: 'testId' | 'label' | 'placeholder' | 'role' | 'css', value?, role?, name?, selector?, nth }
 */
function resolveLocator(t) {
  if (!t) return { kind: 'css', selector: 'body', nth: null };
  const m = t.match || {};

  if (t.testId) return { kind: 'testId', value: t.testId, nth: nthOf(m.testId) };
  if (t.ariaLabel) return { kind: 'label', value: t.ariaLabel, nth: nthOf(m.label) };
  if (t.placeholder) return { kind: 'placeholder', value: t.placeholder, nth: nthOf(m.placeholder) };

  const role = inferRole(t);
  const text = (t.text || '').trim();
  if (role && text && text.length <= 60) {
    return { kind: 'role', role, name: text, nth: nthOf(m.role) };
  }
  if (role === 'textbox' && t.name) {
    return { kind: 'role', role: 'textbox', name: t.name, nth: nthOf(m.name) };
  }

  if (t.id) return { kind: 'css', selector: '#' + cssId(t.id), nth: null };   // id 天然唯一
  if (t.name) return { kind: 'css', selector: `[name="${t.name}"]`, nth: nthOf(m.name) };
  if (t.tagPath) return { kind: 'css', selector: t.tagPath, nth: nthOf(m.tagPath) };
  return { kind: 'css', selector: t.tag || 'body', nth: null };
}

function buildLocator(t) {
  const loc = resolveLocator(t);
  let s;
  switch (loc.kind) {
    case 'testId':      s = `page.getByTestId('${escapeStr(loc.value)}')`; break;
    case 'label':       s = `page.getByLabel('${escapeStr(loc.value)}')`; break;
    case 'placeholder': s = `page.getByPlaceholder('${escapeStr(loc.value)}')`; break;
    case 'role':        s = `page.getByRole('${loc.role}', { name: '${escapeStr(loc.name)}' })`; break;
    default:            s = `page.locator('${escapeStr(loc.selector)}')`;
  }
  return loc.nth === null ? s : `${s}.nth(${loc.nth})`;
}

function actionToCode(a) {
  switch (a.type) {
    case 'goto': return `await page.goto('${escapeStr(a.url)}');`;
    case 'click': {
      const m = a.modifiers || {}, mods = [];
      if (m.ctrl)  mods.push("'Control'");
      if (m.shift) mods.push("'Shift'");
      if (m.alt)   mods.push("'Alt'");
      if (m.meta)  mods.push("'Meta'");
      const loc = buildLocator(a.target);
      return mods.length
        ? `await ${loc}.click({ modifiers: [${mods.join(', ')}] });`
        : `await ${loc}.click();`;
    }
    case 'dblclick': return `await ${buildLocator(a.target)}.dblclick();`;
    case 'hover':    return `await ${buildLocator(a.target)}.hover();`;
    case 'fill':     return `await ${buildLocator(a.target)}.fill('${escapeStr(a.value)}');`;
    case 'select':   return `await ${buildLocator(a.target)}.selectOption('${escapeStr(a.value)}');`;
    case 'check':    return `await ${buildLocator(a.target)}.${a.checked ? 'check' : 'uncheck'}();`;
    case 'press':    return `await ${buildLocator(a.target)}.press('${escapeStr(a.key)}');`;
    default: return null;
  }
}

function generateSpec(actions, options = {}) {
  const title = options.title || 'recorded flow';
  // 回放高亮：只加两行壳子，下面每一步录制出来的代码保持原样
  const withHighlight = options.highlight !== false;
  const lines = [];
  lines.push("const { test, expect } = require('@playwright/test');");
  lines.push('');
  if (withHighlight) {
    lines.push('// 回放高亮：把每一步操作框出来。支持文件缺失时自动降级，spec 照常可跑。');
    lines.push('let hl = (p) => p;');
    lines.push("try { hl = require('./_pw-highlight'); } catch (e) {}");
    lines.push('');
    lines.push(`test('${escapeStr(title)}', async ({ page: rawPage }) => {`);
    lines.push('  const page = hl(rawPage);');
  } else {
    lines.push(`test('${escapeStr(title)}', async ({ page }) => {`);
  }
  for (const a of actions) {
    const code = actionToCode(a);
    if (code) lines.push('  ' + code);
  }
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

module.exports = generateSpec;
module.exports.buildLocator = buildLocator;
module.exports.actionToCode = actionToCode;
module.exports.resolveLocator = resolveLocator;
module.exports.inferRole = inferRole;
module.exports.escapeStr = escapeStr;
module.exports.cssId = cssId;
  };
  __modules["src/agent/agent.js"] = function (module, exports, __require) {
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

const installRecorder = __require("src/injected.js");
const installHighlight = __require("src/highlight-client.js");
const installUI = __require("src/agent/ui.js");
const { LANGS, byId } = __require("src/lang/index.js");

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
  };
  __modules["src/agent/ui.js"] = function (module, exports, __require) {
'use strict';

/**
 * 浏览器端 UI：右下角录制控件 + 录制结束后的多语言导出弹窗。
 * 纯 DOM，无依赖（打包进 dist/pw-agent.js 直接跑在页面里）。
 *
 * 所有节点都带 data-pw-recorder-ui，录制器会忽略它们自己的点击。
 */

const { LANGS, byId } = __require("src/lang/index.js");

const UI_ATTR = 'data-pw-recorder-ui';
const Z = 2147483647;

const STYLE = `
.pwa-widget{position:fixed;right:16px;bottom:16px;z-index:${Z};display:flex;align-items:center;gap:8px;
  background:#18181b;color:#fafafa;font:13px/1.4 system-ui,-apple-system,"PingFang SC",sans-serif;
  padding:10px 12px;border-radius:12px;border:1px solid #27272a;box-shadow:0 8px 30px rgba(0,0,0,.5);user-select:none}
.pwa-widget button{font:inherit;border:0;border-radius:6px;padding:5px 10px;cursor:pointer;color:#fff;background:#3f3f46}
.pwa-widget button:hover{filter:brightness(1.15)}
.pwa-widget button[data-act="stop"]{background:#2563eb}
.pwa-widget .pwa-dot{width:8px;height:8px;border-radius:50%;background:#ef4444;box-shadow:0 0 8px #ef4444}
.pwa-widget .pwa-count{opacity:.65;min-width:26px;text-align:right;font-variant-numeric:tabular-nums}
.pwa-overlay{position:fixed;inset:0;z-index:${Z};background:rgba(9,9,11,.6);display:flex;align-items:center;justify-content:center;
  font:13px/1.5 system-ui,-apple-system,"PingFang SC",sans-serif}
.pwa-modal{width:min(920px,92vw);height:min(660px,88vh);display:flex;flex-direction:column;background:#18181b;color:#fafafa;
  border:1px solid #27272a;border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.6);overflow:hidden}
.pwa-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #27272a}
.pwa-head h3{margin:0;font-size:15px;font-weight:600}
.pwa-head .pwa-steps{opacity:.6;font-size:12px}
.pwa-head .pwa-x{margin-left:auto;background:transparent;border:0;color:#a1a1aa;font-size:20px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:6px}
.pwa-head .pwa-x:hover{background:#27272a;color:#fafafa}
.pwa-tabs{display:flex;gap:6px;padding:12px 16px 0}
.pwa-tab{background:#27272a;color:#d4d4d8;border:1px solid transparent;border-radius:8px 8px 0 0;padding:7px 14px;cursor:pointer;font:inherit}
.pwa-tab[aria-selected="true"]{background:#0b0b0d;color:#fff;border-color:#3f3f46;border-bottom-color:#0b0b0d}
.pwa-tab small{opacity:.55;margin-left:6px;font-size:11px}
.pwa-meta{display:flex;align-items:center;gap:10px;padding:8px 16px;background:#0b0b0d;border-top:1px solid #3f3f46;border-bottom:1px solid #27272a;font-size:12px;color:#a1a1aa}
.pwa-meta code{color:#a5f3fc;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.pwa-code{flex:1;display:flex;overflow:auto;background:#0b0b0d;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}
.pwa-gutter{padding:12px 10px 12px 16px;color:#52525b;text-align:right;user-select:none;white-space:pre;border-right:1px solid #1f1f23}
.pwa-pre{margin:0;padding:12px 16px;white-space:pre;flex:1;color:#e4e4e7}
.pwa-foot{display:flex;align-items:center;gap:10px;padding:12px 16px;border-top:1px solid #27272a;background:#18181b}
.pwa-foot button{font:inherit;border:1px solid #3f3f46;background:#27272a;color:#fafafa;border-radius:8px;padding:7px 14px;cursor:pointer}
.pwa-foot button:hover{filter:brightness(1.2)}
.pwa-foot .pwa-primary{background:#2563eb;border-color:#2563eb}
.pwa-foot .pwa-hint{margin-left:auto;opacity:.55;font-size:12px}
.pwa-toast{position:fixed;right:16px;bottom:78px;z-index:${Z};background:#16a34a;color:#fff;padding:8px 14px;border-radius:8px;
  font:13px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4)}
`;

function el(tag, props, children) {
  const node = document.createElement(tag);
  if (props) {
    Object.keys(props).forEach((k) => {
      if (k === 'style') node.style.cssText = props[k];
      else if (k === 'text') node.textContent = props[k];
      else if (k === 'html') node.innerHTML = props[k];
      else if (k === 'on') Object.keys(props.on).forEach((ev) => node.addEventListener(ev, props.on[ev]));
      else node.setAttribute(k, props[k]);
    });
  }
  (children || []).forEach((c) => node.appendChild(c));
  node.setAttribute(UI_ATTR, '1');
  return node;
}

function installUI(agent) {
  if (window.__pwAgentUI) return window.__pwAgentUI;

  const state = { langId: 'javascript', modal: null };
  let onceKey = null;
  const root = document.createElement('div');
  root.setAttribute(UI_ATTR, '1');

  const style = document.createElement('style');
  style.setAttribute(UI_ATTR, '1');
  style.textContent = STYLE;

  // ---------- 右下角控件 ----------
  const dot = el('span', { class: 'pwa-dot' });
  const label = el('span', { text: 'REC' });
  const count = el('span', { class: 'pwa-count', text: '0' });
  const toggleBtn = el('button', { 'data-act': 'toggle', text: '暂停' });
  const stopBtn = el('button', { 'data-act': 'stop', text: '结束并导出' });

  const widget = el('div', { class: 'pwa-widget' }, [
    el('span', { style: 'display:flex;align-items:center;gap:6px' }, [dot, label]),
    toggleBtn, stopBtn, count,
  ]);

  function paint() {
    const on = agent.isRecording();
    dot.style.background = on ? '#ef4444' : '#71717a';
    dot.style.boxShadow = on ? '0 0 8px #ef4444' : 'none';
    label.textContent = on ? 'REC' : 'PAUSED';
    toggleBtn.textContent = on ? '暂停' : '继续';
    count.textContent = String(agent.getActions().length);
  }

  toggleBtn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (agent.isRecording()) agent.pause(); else agent.start();
    paint();
  }, true);

  stopBtn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    agent.stop();
    paint();
    openExport();
  }, true);

  // ---------- 导出弹窗 ----------
  function codeFor(langId) {
    const lang = byId(langId);
    const title = agent.getTitle();
    return lang.generate(agent.getActions(), {
      title,
      filename: lang.filename(title),
      highlight: false,
      headless: false,
    });
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.setAttribute(UI_ATTR, '1');
    document.documentElement.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 0);
  }

  function copy(text, btn) {
    const done = () => {
      const old = btn.textContent;
      btn.textContent = '已复制 ✓';
      setTimeout(() => { btn.textContent = old; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallback());
    } else {
      fallback();
    }
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute(UI_ATTR, '1');
      ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px';
      document.documentElement.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* 忽略 */ }
      ta.remove();
    }
  }

  function openExport() {
    closeExport();
    const title = agent.getTitle();
    const actions = agent.getActions();

    const tabs = el('div', { class: 'pwa-tabs' });
    const meta = el('div', { class: 'pwa-meta' });
    const gutter = el('div', { class: 'pwa-gutter' });
    const pre = el('pre', { class: 'pwa-pre' });
    const copyBtn = el('button', { class: 'pwa-primary', text: '复制代码' });
    const dlBtn = el('button', { text: '下载文件' });
    const againBtn = el('button', { text: '重新录制' });

    const tabEls = {};
    LANGS.forEach((lang) => {
      const tab = el('button', { class: 'pwa-tab', role: 'tab' });
      tab.textContent = lang.label;
      tab.appendChild(el('small', { text: lang.hint }));
      tab.addEventListener('click', () => select(lang.id), true);
      tabEls[lang.id] = tab;
      tabs.appendChild(tab);
    });

    function select(langId) {
      state.langId = langId;
      const lang = byId(langId);
      const code = codeFor(langId);
      const lines = code.replace(/\n$/, '').split('\n');
      Object.keys(tabEls).forEach((id) => tabEls[id].setAttribute('aria-selected', String(id === langId)));
      meta.textContent = '';
      meta.appendChild(el('span', { text: '文件名' }));
      meta.appendChild(el('code', { text: lang.filename(title) }));
      meta.appendChild(el('span', { text: '共 ' + lines.length + ' 行' }));
      gutter.textContent = lines.map((_, i) => i + 1).join('\n');
      pre.textContent = code;
      copyBtn.onclick = () => copy(code, copyBtn);
      dlBtn.onclick = () => download(lang.filename(title), code);
    }

    const overlay = el('div', { class: 'pwa-overlay', role: 'dialog', 'aria-label': '导出脚本' }, [
      el('div', { class: 'pwa-modal' }, [
        el('div', { class: 'pwa-head' }, [
          el('h3', { text: '导出脚本' }),
          el('span', { class: 'pwa-steps', text: `已录制 ${actions.length} 步操作` }),
          el('button', { class: 'pwa-x', text: '×', on: { click: () => closeExport() } }),
        ]),
        tabs,
        meta,
        el('div', { class: 'pwa-code' }, [gutter, pre]),
        el('div', { class: 'pwa-foot' }, [
          copyBtn, dlBtn, againBtn,
          el('span', { class: 'pwa-hint', text: '关闭后可继续在页面上操作' }),
        ]),
      ]),
    ]);

    onceKey = (ev) => { if (ev.key === 'Escape') closeExport(); };
    againBtn.addEventListener('click', () => { closeExport(); agent.reset(); agent.start(); paint(); }, true);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeExport(); }, true);

    root.appendChild(overlay);
    state.modal = overlay;
    select(state.langId);
    document.addEventListener('keydown', onceKey, true);
  }

  function closeExport() {
    if (state.modal) state.modal.remove();
    state.modal = null;
    if (onceKey) document.removeEventListener('keydown', onceKey, true);
  }

  function mount() {
    if (!document.body) return false;
    if (!root.isConnected) {
      document.documentElement.appendChild(style);
      document.documentElement.appendChild(root);
      root.appendChild(widget);
      paint();
    }
    return true;
  }

  const api = {
    paint,
    setCount: (n) => { count.textContent = String(n); },
    openExport,
    closeExport,
    mount,
    isExportOpen: () => !!state.modal,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  window.__pwAgentUI = api;
  return api;
}

module.exports = installUI;
module.exports.UI_ATTR = UI_ATTR;
  };
  __modules["src/highlight-client.js"] = function (module, exports, __require) {
'use strict';

/**
 * 页面内操作高亮：录制时给"刚被捕获的操作"框一下，回放时给"即将执行的操作"框一下。
 *
 * 视觉参考 browser-use 的 browser_use/browser/python_highlights.py：
 *   - 按元素类型着色（button 红 / input 青 / select 蓝 / a 绿 / textarea 橙 / 其它紫）
 *   - 虚线框 + 文字标签，小元素把标签放到框上方，避免挡住图标
 * （那边是用 PIL 画在截图上，这里是页面内 DOM 覆盖层。）
 *
 * 本函数会被序列化进浏览器执行，也可能被内联进生成的 spec 支持文件，
 * 因此必须完全自包含：不能引用外部变量、不能 require。
 */
function installHighlight() {
  if (window.__pwHighlight) return;

  const COLORS = {
    button: '#FF6B6B',
    input: '#4ECDC4',
    select: '#45B7D1',
    a: '#96CEB4',
    textarea: '#FF8C42',
    default: '#DDA0DD',
  };

  const HOLD_MS = 900;
  const Z = 2147483646;

  function colorFor(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'input' && (type === 'button' || type === 'submit')) return COLORS.button;
    return COLORS[tag] || COLORS.default;
  }

  function toRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  function truncate(s, n) {
    const t = String(s == null ? '' : s).replace(/\s+/g, ' ');
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  }

  // 录制侧和回放侧共用同一套文案，避免两边显示不一致
  function labelFor(opts) {
    const action = opts.action || 'action';
    const detail = opts.detail;
    if (detail === undefined || detail === null || detail === '') return action;
    return action + ' "' + truncate(detail, 24) + '"';
  }

  function show(rect, opts) {
    if (!document.documentElement) return;

    const color = opts.color || COLORS.default;
    const label = labelFor(opts);
    const hold = opts.hold || api.holdMs || HOLD_MS;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // 夹到视口内而不是直接放弃：整页元素、跨越边界的元素也要有反馈
    const left = Math.max(0, Math.min(rect.left, vw - 4));
    const top = Math.max(0, Math.min(rect.top, vh - 4));
    const width = Math.max(4, Math.min(rect.width, vw - left));
    const height = Math.max(4, Math.min(rect.height, vh - top));

    const pad = 2;
    const box = document.createElement('div');
    box.setAttribute('data-pw-recorder-ui', '1');
    box.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'z-index:' + Z,
      'box-sizing:border-box',
      'left:' + (left - pad) + 'px',
      'top:' + (top - pad) + 'px',
      'width:' + (width + pad * 2) + 'px',
      'height:' + (height + pad * 2) + 'px',
      'border:2px dashed ' + color,
      'border-radius:4px',
      'background:' + toRgba(color, 0.12),
      'box-shadow:0 0 0 2px rgba(255,255,255,.35), 0 0 12px ' + color,
      'font:600 12px/1.2 system-ui,-apple-system,sans-serif',
      'will-change:opacity',
    ].join(';');

    if (label) {
      const chip = document.createElement('span');
      chip.textContent = label;
      // 标签位置参考 python_highlights.py：小元素放框上方，普通元素放框内。
      // 但普通元素放"框内顶部"会压住内容时（输入框、按钮文字），优先放上方。
      const small = width < 120 || height < 32;
      const roomAbove = top > 22;
      const above = roomAbove && (small || height < 44);
      chip.style.cssText = [
        'position:absolute',
        'left:0',
        above ? 'top:-19px' : 'top:2px',
        'max-width:280px',
        'white-space:nowrap',
        'overflow:hidden',
        'text-overflow:ellipsis',
        'font-size:11px',
        'background:' + color,
        'color:#18181b',
        'padding:2px 6px',
        'border:1px solid rgba(0,0,0,.22)',
        'border-radius:4px',
        'box-shadow:0 1px 4px rgba(0,0,0,.35)',
      ].join(';');
      box.appendChild(chip);
    }

    document.documentElement.appendChild(box);

    // 点击类操作再补一圈扩散涟漪，位置感更明确
    const rippleKinds = ['click', 'dblclick', 'check', 'uncheck', 'tap'];
    if (rippleKinds.indexOf(opts.action) >= 0) {
      const r = document.createElement('div');
      r.setAttribute('data-pw-recorder-ui', '1');
      const cx = left + width / 2;
      const cy = top + height / 2;
      const d = Math.max(24, Math.min(Math.max(width, height), 120));
      r.style.cssText = [
        'position:fixed',
        'pointer-events:none',
        'z-index:' + Z,
        'left:' + (cx - d / 2) + 'px',
        'top:' + (cy - d / 2) + 'px',
        'width:' + d + 'px',
        'height:' + d + 'px',
        'border-radius:50%',
        'border:2px solid ' + color,
        'background:' + toRgba(color, 0.25),
        'will-change:transform,opacity',
      ].join(';');
      document.documentElement.appendChild(r);
      if (r.animate) {
        const anim = r.animate(
          [{ transform: 'scale(.4)', opacity: 0.9 }, { transform: 'scale(1.6)', opacity: 0 }],
          { duration: 520, easing: 'ease-out' },   // 涟漪是"点击"的瞬时效果，不跟着 hold 拉长
        );
        anim.onfinish = () => r.remove();
      } else {
        setTimeout(() => r.remove(), 520);
      }
    }

    const cleanup = () => box.remove();
    if (box.animate) {
      // 淡入/淡出固定时长，只延长"完全可见"的停留时间。
      // 否则把 hold 调大做演示时淡入也会跟着变慢，截图和肉眼都看不清。
      const fadeIn = 90;
      const fadeOut = 220;
      const oIn = Math.min(fadeIn / hold, 0.4);
      const oOut = Math.max(oIn, 1 - fadeOut / hold);
      const anim = box.animate(
        [
          { opacity: 0, offset: 0 },
          { opacity: 1, offset: oIn },
          { opacity: 1, offset: oOut },
          { opacity: 0, offset: 1 },
        ],
        { duration: hold, easing: 'linear' },
      );
      anim.onfinish = cleanup;
      setTimeout(cleanup, hold + 400);   // 动画被打断时的兜底
    } else {
      setTimeout(cleanup, hold);
    }
  }

  function visibleInViewport(r) {
    return r.width > 0 && r.height > 0
      && r.bottom > 0 && r.right > 0
      && r.top < window.innerHeight && r.left < window.innerWidth;
  }

  function flash(el, opts) {
    if (!el || el.nodeType !== 1) return;
    const o = opts || {};
    let rect;
    try { rect = el.getBoundingClientRect(); } catch (e) { return; }
    if (!rect || (!rect.width && !rect.height)) return;

    // 回放时目标常常在首屏之外，而 Playwright 要等动作执行时才滚动。
    // 这里先滚进来，否则框会画在视口外=看不见。
    if (!visibleInViewport(rect)) {
      try {
        el.scrollIntoView({ block: 'center', inline: 'center' });
        rect = el.getBoundingClientRect();
      } catch (e) { /* 滚不动就算了，下面会夹到视口边缘 */ }
    }

    try {
      show(rect, { action: o.action, detail: o.detail, color: o.color || colorFor(el) });
    } catch (e) { /* 高亮绝不能影响操作本身 */ }
  }

  // holdMs 可调：回放演示想看清高亮时调大（支持文件里读 PW_HL_HOLD 环境变量）
  const api = { flash: flash, show: show, colorFor: colorFor, COLORS: COLORS, holdMs: HOLD_MS };
  window.__pwHighlight = api;
}

module.exports = installHighlight;
  };
  __modules["src/injected.js"] = function (module, exports, __require) {
'use strict';

function installRecorder() {
  if (window.__PW_RECORDER_INSTALLED__) return;
  window.__PW_RECORDER_INSTALLED__ = true;

  const state = {
    enabled: false,
    pendingInput: null,
    inputTimer: null,
    lastHoverPath: null,
  };

  const cssEscape = (s) =>
    window.CSS && CSS.escape ? CSS.escape(String(s))
      : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');

  const cssAttrVal = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const queryAll = (sel) => {
    try { return Array.from(document.querySelectorAll(sel)); } catch (e) { return []; }
  };

  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  function tagPath(el) {
    const parts = [];
    let cur = el, depth = 0;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement && depth++ < 10) {
      if (cur.id) { parts.unshift('#' + cssEscape(cur.id)); break; }
      let seg = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (sibs.length > 1) seg += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
      }
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  // 可访问名：优先显式 aria-label，其次是 <label for> / 外层 <label> 的文本。
  // 少了这一步，<label for="email">Email</label> 这类表单只能退化成 #id 或 CSS 路径。
  function labelText(el) {
    const explicit = el.getAttribute('aria-label');
    if (explicit) return explicit.trim().slice(0, 100);

    if (el.labels && el.labels.length) {
      const t = Array.from(el.labels)
        .map((l) => (l.innerText || l.textContent || '').trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (t) return t.slice(0, 100);
    }

    const wrap = el.closest && el.closest('label');
    if (wrap) {
      const t = (wrap.innerText || wrap.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) return t.slice(0, 100);
    }
    return '';
  }

  // 与 CodeGenerator.inferRole 保持一致（选择器由 Node 侧决定，这里只用于统计同类数量）
  function inferRole(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a') return 'link';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      return 'textbox';
    }
    return '';
  }

  function testIdOf(el) {
    for (const attr of ['data-testid', 'data-test-id', 'data-cy']) {
      const v = el.getAttribute(attr);
      if (v) return { attr, value: v };
    }
    return null;
  }

  // 统计"同一个选择器命中多少个元素、当前是第几个"。
  // 页面里重复出现的元素（列表项、多个同名按钮）必须带 .nth()，
  // 否则回放时 Playwright 会直接以 strict mode violation 报错。
  function stat(sel, el) {
    if (!sel) return null;
    const list = queryAll(sel);
    const i = list.indexOf(el);
    return i < 0 ? null : { n: list.length, i };
  }

  const MAX_SCAN = 1000;

  function labelStat(el) {
    const explicit = el.getAttribute('aria-label');
    if (explicit) return stat(`[aria-label="${cssAttrVal(explicit)}"]`, el);
    if (el.labels && el.labels.length && el.labels[0]) {
      const pool = queryAll('input,select,textarea,[aria-label]');
      if (pool.length > MAX_SCAN) return null;
      const mine = labelText(el);
      const same = pool.filter((e) => labelText(e) === mine);
      const i = same.indexOf(el);
      return i < 0 ? null : { n: same.length, i };
    }
    return null;
  }

  function rolePool(role, el) {
    const byAttr = queryAll(`[role="${cssAttrVal(role)}"]`);
    let pool = [];
    if (role === 'button') pool = queryAll('button,input[type=submit],input[type=button],input[type=reset],input[type=image]');
    else if (role === 'link') pool = queryAll('a[href]');
    else if (role === 'combobox') pool = queryAll('select');
    else if (role === 'textbox') pool = queryAll('textarea,input:not([type]),input[type=text],input[type=email],input[type=password],input[type=search],input[type=tel],input[type=url]');
    else if (role === 'checkbox') pool = queryAll('input[type=checkbox]');
    else if (role === 'radio') pool = queryAll('input[type=radio]');
    else pool = el ? [el] : [];
    return Array.from(new Set(byAttr.concat(pool)));
  }

  function roleStat(el, role, text) {
    if (!role) return null;
    const pool = rolePool(role, el);
    if (pool.length > MAX_SCAN) return null;
    const same = pool.filter((e) => norm(e.innerText || e.textContent) === text);
    const i = same.indexOf(el);
    return i < 0 ? null : { n: same.length, i };
  }

  function buildMatch(el) {
    const tid = testIdOf(el);
    const ph = el.getAttribute('placeholder');
    const name = el.getAttribute('name');
    const id = el.id;
    const role = inferRole(el);
    const text = norm(el.innerText || el.textContent);
    return {
      testId: tid ? stat(`[${tid.attr}="${cssAttrVal(tid.value)}"]`, el) : null,
      label: labelStat(el),
      placeholder: ph ? stat(`[placeholder="${cssAttrVal(ph)}"]`, el) : null,
      role: role && text && text.length <= 60 ? roleStat(el, role, text) : null,
      name: name ? stat(`[name="${cssAttrVal(name)}"]`, el) : null,
      id: id ? { n: 1, i: 0 } : null,
      tagPath: stat(tagPath(el), el),
    };
  }

  function describe(el) {
    if (!el || el.nodeType !== 1) return null;
    const text = (el.innerText || el.textContent || '').trim();
    const tid = testIdOf(el);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      testId: tid ? tid.value : '',
      testIdAttr: tid ? tid.attr : '',
      role: el.getAttribute('role') || '',
      ariaLabel: labelText(el),
      placeholder: el.getAttribute('placeholder') || '',
      name: el.getAttribute('name') || '',
      type: el.getAttribute('type') || '',
      text: text.replace(/\s+/g, ' ').slice(0, 100),
      href: el.getAttribute('href') || '',
      value: 'value' in el ? String(el.value) : '',
      checked: !!el.checked,
      tagPath: tagPath(el),
      match: buildMatch(el),
    };
  }

  // 点到的往往是按钮/链接内部的 span、svg、icon：向上找到语义化的祖先，
  // 否则会生成一个脆弱且不可点击的深层选择器。
  const SELF_SELECTOR = 'input,select,textarea,button,a,label,summary,[role],[data-testid],[data-test-id],[data-cy],[aria-label]';
  const ANCESTOR_SELECTOR = 'button,a,label,summary,[role],[data-testid],[data-test-id],[data-cy],[aria-label]';

  function meaningful(el) {
    if (!el || el.nodeType !== 1) return el;
    if (el.matches && el.matches(SELF_SELECTOR)) return el;
    const anc = el.closest ? el.closest(ANCESTOR_SELECTOR) : null;
    return anc || el;
  }

  function emit(type, data) {
    if (!state.enabled) return;
    if (typeof window.__pwRecorderEmit !== 'function') return;
    try { window.__pwRecorderEmit(Object.assign({ type, ts: Date.now() }, data)); } catch (e) {}
  }

  // 录制时给刚被捕获的元素框一下，用户能立刻确认"这一步录到了"。
  // 高亮层带 data-pw-recorder-ui 且 pointer-events:none，不会反过来被录进去。
  function mark(el, action, detail) {
    if (!state.enabled) return;
    try { window.__pwHighlight && window.__pwHighlight.flash(el, { action, detail }); } catch (e) {}
  }

  const isUI = (el) => !!(el && el.closest && el.closest('[data-pw-recorder-ui]'));

  function flushInput() {
    if (!state.pendingInput) return;
    const p = state.pendingInput;
    state.pendingInput = null;
    clearTimeout(state.inputTimer);
    state.inputTimer = null;
    mark(p.el, 'fill', p.value);
    emit('fill', { target: p.target, value: p.value });
  }

  // 输入是防抖的：如果用户在 400ms 内又点了别的东西，必须先把刚才的输入落盘，
  // 否则 click/press 会排在 fill 前面，回放顺序就反了。
  const flushBeforeAction = () => { if (state.pendingInput) flushInput(); };

  // ---- 只在 :hover 时才可见的元素（例如列表行上的删除按钮）-------------------
  // 这类元素回放时 .click() 会一直等可见性直到超时，必须在点击前补一步 hover
  // 去 hover 真正触发规则的那个祖先（CSS 里 :hover 写在哪个选择器上）。
  function hoverGateFor(el) {
    const sheets = document.styleSheets;
    for (let i = 0; i < sheets.length; i++) {
      let rules;
      try { rules = sheets[i].cssRules; } catch (e) { continue; }   // 跨域样式表读不到，跳过
      const found = scanRules(rules, el);
      if (found) return found;
    }
    return null;
  }

  function scanRules(rules, el) {
    for (let j = 0; j < rules.length; j++) {
      const r = rules[j];
      if (!r) continue;

      const sel = r.selectorText;
      if (!sel) {
        // @media / @supports / @layer 这类分组规则本身没有选择器，继续往里找。
        // 注意：不能反过来用 `if (r.cssRules)` 判断分组——Chrome 112+ 支持 CSS 嵌套后，
        // 普通样式规则也有 cssRules（空 CSSRuleList，truthy），那样会把所有规则都跳过。
        if (r.cssRules && r.cssRules.length) {
          const nested = scanRules(r.cssRules, el);
          if (nested) return nested;
        }
        continue;
      }

      if (sel.indexOf(':hover') < 0) continue;
      const st = r.style;
      if (!st) continue;
      const reveals = (st.display && st.display !== 'none')
        || (st.visibility && st.visibility !== 'hidden')
        || (st.opacity !== undefined && st.opacity !== '');
      if (!reveals) continue;

      const parts = sel.split(',');
      for (let k = 0; k < parts.length; k++) {
        const one = parts[k].trim();
        const at = one.indexOf(':hover');
        if (at < 0) continue;
        const before = one.slice(0, at).trim();                 // ".todo-list li"
        const after = one.slice(at + 6).trim();                 // ".destroy"
        if (!before) continue;
        let hit = false;
        try { hit = after ? (el.matches(after) || !!el.closest(after)) : el.matches(before); }
        catch (e) { continue; }
        if (!hit) continue;
        try {
          if (after) {
            const gate = el.closest(before);
            if (gate && gate.contains(el)) return gate;
          } else {
            return el;
          }
        } catch (e) { /* 选择器不合法，忽略 */ }
      }
    }
    return null;
  }

  function emitHoverOnce(gate) {
    const d = describe(gate);
    if (!d) return;
    if (d.tagPath === state.lastHoverPath) return;   // 同一目标只补一次，避免刷屏
    state.lastHoverPath = d.tagPath;
    mark(gate, 'hover');
    emit('hover', { target: d });
  }

  // 复选框/单选框的最终状态由 change 事件统一记录成 check/uncheck，
  // 这里不再单独记一次 click，避免回放时多出一次点击。
  const isToggleInput = (el) => {
    const t = el && el.tagName;
    return t === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio');
  };

  // 文本输入框/下拉框的交互由 input/change 记录成 fill/select，
  // 这里不再额外记 click，否则每次聚焦、下拉都会多生成一个 .click()。
  function isFormFieldClick(el) {
    const tag = el.tagName;
    if (tag === 'SELECT' || tag === 'TEXTAREA') return true;
    if (tag !== 'INPUT') return false;
    const t = (el.type || 'text').toLowerCase();
    return !['submit', 'button', 'reset', 'image', 'checkbox', 'radio'].includes(t);
  }

  document.addEventListener('click', (e) => {
    if (isUI(e.target)) return;
    flushBeforeAction();                      // 先落盘未完成的输入，保证顺序
    const target = meaningful(e.target);
    const gate = hoverGateFor(target);        // 需要 hover 才可见的元素，先补一步 hover
    if (gate) emitHoverOnce(gate);
    if (isToggleInput(e.target)) return;      // 勾选由 change → check 记录
    if (isFormFieldClick(e.target)) return;   // 输入/下拉由 fill/select 记录
    mark(target, 'click');
    emit('click', {
      target: describe(target),
      modifiers: { alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey },
    });
  }, true);

  document.addEventListener('dblclick', (e) => {
    if (isUI(e.target)) return;
    flushBeforeAction();
    const target = meaningful(e.target);
    mark(target, 'dblclick');
    emit('dblclick', { target: describe(target) });
  }, true);

  document.addEventListener('input', (e) => {
    if (isUI(e.target)) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    if (el.tagName === 'SELECT') return;
    if (el.type === 'checkbox' || el.type === 'radio') return;
    // 防抖：停顿 400ms 后合并成一次 fill
    state.pendingInput = { el, target: describe(el), value: el.value };
    clearTimeout(state.inputTimer);
    state.inputTimer = setTimeout(flushInput, 400);
  }, true);

  document.addEventListener('change', (e) => {
    if (isUI(e.target)) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    // 下拉/勾选往往不触发 blur（例如程序化 selectOption），
    // 这里同样先落盘未完成的输入，保证动作顺序与用户操作一致。
    flushBeforeAction();
    if (el.tagName === 'SELECT') {
      mark(el, 'select', el.value);
      emit('select', { target: describe(el), value: el.value });
    } else if (el.type === 'checkbox' || el.type === 'radio') {
      mark(el, el.checked ? 'check' : 'uncheck');
      emit('check', { target: describe(el), checked: !!el.checked });
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    if (isUI(e.target)) return;
    if (['Enter', 'Escape', 'Tab'].includes(e.key)) {
      flushBeforeAction();
      const target = meaningful(e.target);
      mark(target, 'press', e.key);
      emit('press', { target: describe(target), key: e.key });
    }
  }, true);

  window.addEventListener('blur', () => { flushInput(); }, true);

  // 页面卸载前把未落盘的输入补发出去（例如输入完直接点链接跳转）
  window.addEventListener('pagehide', () => { flushInput(); }, true);

  window.__pwRecorderSetEnabled = (v) => {
    state.enabled = !!v;
    if (!state.enabled) { clearTimeout(state.inputTimer); state.inputTimer = null; state.pendingInput = null; }
  };
}

module.exports = installRecorder;
  };
  __modules["src/lang/index.js"] = function (module, exports, __require) {
'use strict';

/**
 * 导出语言注册表：UI 的标签页、文件名、生成函数都由这里统一提供。
 */

const generateJs = __require("src/CodeGenerator.js");
const generatePython = __require("src/lang/python.js");
const generateJava = __require("src/lang/java.js");
const { className } = __require("src/lang/java.js");
const { funcName } = __require("src/lang/python.js");

/** 标题 → 文件名用的 slug */
function slug(title) {
  const s = String(title || 'recorded flow')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'recorded-flow';
}

const LANGS = [
  {
    id: 'javascript',
    label: 'JavaScript',
    hint: 'Playwright Test',
    extension: 'js',
    comment: '//',
    filename: (title) => `${slug(title)}.spec.js`,
    generate: (actions, options) => generateJs(actions, Object.assign({}, options, {
      filename: `${slug(options && options.title)}.spec.js`,
    })),
  },
  {
    id: 'python',
    label: 'Python',
    hint: 'pytest + Playwright',
    extension: 'py',
    comment: '#',
    filename: (title) => `${funcName(title)}.py`,
    generate: (actions, options) => generatePython(actions, Object.assign({}, options, {
      filename: `${funcName(options && options.title)}.py`,
    })),
  },
  {
    id: 'java',
    label: 'Java',
    hint: 'JUnit 5 + Playwright',
    extension: 'java',
    comment: '//',
    filename: (title) => `${className(title)}.java`,
    generate: (actions, options) => generateJava(actions, options),
  },
];

function byId(id) {
  return LANGS.filter((l) => l.id === id)[0] || null;
}

module.exports = { LANGS, byId, slug };
  };
  __modules["src/lang/java.js"] = function (module, exports, __require) {
'use strict';

/**
 * 动作 → Playwright Java 代码（JUnit 5）。
 * 选择器来自 CodeGenerator.resolveLocator，与 JS/Python 完全一致。
 *
 * AriaRole 是枚举：角色名先按"大写去符号"映射（menuitemcheckbox → MENUITEMCHECKBOX），
 * 不在枚举里就退化成 CSS 选择器，保证生成的代码一定能编译。
 */

const { resolveLocator } = __require("src/CodeGenerator.js");

/** com.microsoft.playwright.options.AriaRole 的全部常量（javap 导出核对过） */
const ARIA_ROLES = new Set([
  'ALERT', 'ALERTDIALOG', 'APPLICATION', 'ARTICLE', 'BANNER', 'BLOCKQUOTE', 'BUTTON', 'CAPTION',
  'CELL', 'CHECKBOX', 'CODE', 'COLUMNHEADER', 'COMBOBOX', 'COMPLEMENTARY', 'CONTENTINFO',
  'DEFINITION', 'DELETION', 'DIALOG', 'DIRECTORY', 'DOCUMENT', 'EMPHASIS', 'FEED', 'FIGURE',
  'FORM', 'GENERIC', 'GRID', 'GRIDCELL', 'GROUP', 'HEADING', 'IMG', 'INSERTION', 'LINK', 'LIST',
  'LISTBOX', 'LISTITEM', 'LOG', 'MAIN', 'MARQUEE', 'MATH', 'METER', 'MENU', 'MENUBAR', 'MENUITEM',
  'MENUITEMCHECKBOX', 'MENUITEMRADIO', 'NAVIGATION', 'NONE', 'NOTE', 'OPTION', 'PARAGRAPH',
  'PRESENTATION', 'PROGRESSBAR', 'RADIO', 'RADIOGROUP', 'REGION', 'ROW', 'ROWGROUP', 'ROWHEADER',
  'SCROLLBAR', 'SEARCH', 'SEARCHBOX', 'SEPARATOR', 'SLIDER', 'SPINBUTTON', 'STATUS', 'STRONG',
  'SUBSCRIPT', 'SUPERSCRIPT', 'SWITCH', 'TAB', 'TABLE', 'TABLIST', 'TABPANEL', 'TERM', 'TEXTBOX',
  'TIME', 'TIMER', 'TOOLBAR', 'TOOLTIP', 'TREE', 'TREEGRID', 'TREEITEM',
]);

const ariaRole = (role) => {
  const key = String(role || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return ARIA_ROLES.has(key) ? key : null;
};

const jstr = (s) =>
  '"' + String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n') + '"';

const KEY_MODIFIERS = { ctrl: 'CONTROL', shift: 'SHIFT', alt: 'ALT', meta: 'META' };

function renderLocator(target) {
  const loc = resolveLocator(target);
  let s;
  switch (loc.kind) {
    case 'testId':      s = `page.getByTestId(${jstr(loc.value)})`; break;
    case 'label':       s = `page.getByLabel(${jstr(loc.value)})`; break;
    case 'placeholder': s = `page.getByPlaceholder(${jstr(loc.value)})`; break;
    case 'role': {
      const role = ariaRole(loc.role);
      if (role) {
        s = `page.getByRole(AriaRole.${role}, new Page.GetByRoleOptions().setName(${jstr(loc.name)}))`;
      } else if (target && target.tagPath) {
        // AriaRole 里没有这个角色（页面自定义 role），退化成 CSS 路径
        s = `page.locator(${jstr(target.tagPath)})`;
      } else {
        s = `page.locator(${jstr(loc.selector || 'body')})`;
      }
      break;
    }
    default: s = `page.locator(${jstr(loc.selector)})`;
  }
  return loc.nth === null ? s : `${s}.nth(${loc.nth})`;
}

function actionToJava(a) {
  switch (a.type) {
    case 'goto':
      return `page.navigate(${jstr(a.url)});`;
    case 'click': {
      const m = a.modifiers || {};
      const mods = Object.keys(KEY_MODIFIERS).filter((k) => m[k]).map((k) => `KeyboardModifier.${KEY_MODIFIERS[k]}`);
      const loc = renderLocator(a.target);
      return mods.length
        ? `${loc}.click(new Locator.ClickOptions().setModifiers(Arrays.asList(${mods.join(', ')})));`
        : `${loc}.click();`;
    }
    case 'dblclick': return `${renderLocator(a.target)}.dblclick();`;
    case 'hover':    return `${renderLocator(a.target)}.hover();`;
    case 'fill':     return `${renderLocator(a.target)}.fill(${jstr(a.value)});`;
    case 'select':   return `${renderLocator(a.target)}.selectOption(${jstr(a.value)});`;
    case 'check':    return `${renderLocator(a.target)}.${a.checked ? 'check' : 'uncheck'}();`;
    case 'press':    return `${renderLocator(a.target)}.press(${jstr(a.key)});`;
    default: return null;
  }
}

const words = (title) => String(title || 'recorded flow').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);

/** 标题 → 类名（PascalCase，补 Test 后缀） */
function className(title) {
  const parts = words(title);
  const base = parts.length ? parts.map((w) => w[0].toUpperCase() + w.slice(1)).join('') : 'RecordedFlow';
  return /Test$/.test(base) ? base : base + 'Test';
}

/** 标题 → 方法名（camelCase） */
function methodName(title) {
  const parts = words(title);
  if (!parts.length) return 'recordedFlow';
  const head = parts[0][0].toLowerCase() + parts[0].slice(1);
  return [head].concat(parts.slice(1).map((w) => w[0].toUpperCase() + w.slice(1))).join('');
}

function generateJava(actions, options = {}) {
  const cls = className(options.title);
  const method = methodName(options.title);
  const headless = options.headless === true;
  const lines = [];
  lines.push('// 由 pw-recorder v2 浏览器录制器生成。');
  lines.push('//');
  lines.push('// 依赖（Maven）:');
  lines.push('//   com.microsoft.playwright:playwright:1.48.0');
  lines.push('//   org.junit.jupiter:junit-jupiter:5.11.0');
  lines.push('// 运行: mvn test -Dtest=' + cls);
  lines.push('');
  lines.push('import com.microsoft.playwright.*;');
  lines.push('import com.microsoft.playwright.options.AriaRole;');
  lines.push('import com.microsoft.playwright.options.KeyboardModifier;');
  lines.push('import java.util.Arrays;');
  lines.push('import org.junit.jupiter.api.Test;');
  lines.push('');
  lines.push('class ' + cls + ' {');
  lines.push('');
  lines.push('  @Test');
  lines.push('  void ' + method + '() {');
  lines.push('    try (Playwright playwright = Playwright.create()) {');
  lines.push(`      Browser browser = playwright.chromium().launch(new BrowserType.LaunchOptions().setHeadless(${headless}));`);
  lines.push('      Page page = browser.newPage();');
  for (const a of actions) {
    const code = actionToJava(a);
    if (code) lines.push('      ' + code);
  }
  lines.push('      browser.close();');
  lines.push('    }');
  lines.push('  }');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

module.exports = generateJava;
module.exports.renderLocator = renderLocator;
module.exports.actionToJava = actionToJava;
module.exports.className = className;
module.exports.methodName = methodName;
module.exports.ARIA_ROLES = ARIA_ROLES;
  };
  __modules["src/lang/python.js"] = function (module, exports, __require) {
'use strict';

/**
 * 动作 → Playwright Python 代码（pytest + sync API）。
 * 选择器来自 CodeGenerator.resolveLocator，与 JS/Java 完全一致。
 */

const { resolveLocator } = __require("src/CodeGenerator.js");

const pystr = (s) =>
  '"' + String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n') + '"';

const MODIFIERS = { ctrl: 'Control', shift: 'Shift', alt: 'Alt', meta: 'Meta' };

function renderLocator(target) {
  const loc = resolveLocator(target);
  let s;
  switch (loc.kind) {
    case 'testId':      s = `page.get_by_test_id(${pystr(loc.value)})`; break;
    case 'label':       s = `page.get_by_label(${pystr(loc.value)})`; break;
    case 'placeholder': s = `page.get_by_placeholder(${pystr(loc.value)})`; break;
    case 'role':        s = `page.get_by_role(${pystr(loc.role)}, name=${pystr(loc.name)})`; break;
    default:            s = `page.locator(${pystr(loc.selector)})`;
  }
  return loc.nth === null ? s : `${s}.nth(${loc.nth})`;
}

function actionToPython(a) {
  switch (a.type) {
    case 'goto':
      return `page.goto(${pystr(a.url)})`;
    case 'click': {
      const m = a.modifiers || {};
      const mods = Object.keys(MODIFIERS).filter((k) => m[k]).map((k) => pystr(MODIFIERS[k]));
      const loc = renderLocator(a.target);
      return mods.length ? `${loc}.click(modifiers=[${mods.join(', ')}])` : `${loc}.click()`;
    }
    case 'dblclick': return `${renderLocator(a.target)}.dblclick()`;
    case 'hover':    return `${renderLocator(a.target)}.hover()`;
    case 'fill':     return `${renderLocator(a.target)}.fill(${pystr(a.value)})`;
    case 'select':   return `${renderLocator(a.target)}.select_option(${pystr(a.value)})`;
    case 'check':    return `${renderLocator(a.target)}.${a.checked ? 'check' : 'uncheck'}()`;
    case 'press':    return `${renderLocator(a.target)}.press(${pystr(a.key)})`;
    default: return null;
  }
}

/** 标题 → 合法的 pytest 函数名（test_ 前缀，snake_case） */
function funcName(title) {
  const slug = String(title || 'recorded flow')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return 'test_' + (slug || 'recorded_flow');
}

function generatePython(actions, options = {}) {
  const name = funcName(options.title);
  const file = options.filename || name + '.py';
  const lines = [];
  lines.push('"""由 pw-recorder v2 浏览器录制器生成。');
  lines.push('');
  lines.push('安装:  pip install playwright pytest-playwright && playwright install chromium');
  lines.push(`运行:  pytest ${file}`);
  lines.push('"""');
  lines.push('from playwright.sync_api import Page');
  lines.push('');
  lines.push('');
  lines.push(`def ${name}(page: Page) -> None:`);
  const body = [];
  for (const a of actions) {
    const code = actionToPython(a);
    if (code) body.push('    ' + code);
  }
  if (!body.length) body.push('    pass');
  return lines.concat(body).join('\n') + '\n';
}

module.exports = generatePython;
module.exports.renderLocator = renderLocator;
module.exports.actionToPython = actionToPython;
module.exports.funcName = funcName;
  };
  var agent = __require("src/agent/agent.js");
  global.PWAgent = agent;
  if (typeof document !== 'undefined') agent.autoInit();
})(typeof globalThis !== 'undefined' ? globalThis : this);
