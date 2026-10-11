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
