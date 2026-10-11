'use strict';

/**
 * 浏览器端 UI：右下角录制控件 + 录制结束后的多语言导出弹窗。
 * 纯 DOM，无依赖（打包进 dist/pw-agent.js 直接跑在页面里）。
 *
 * 所有节点都带 data-pw-recorder-ui，录制器会忽略它们自己的点击。
 */

const { LANGS, byId } = require('../lang');

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
