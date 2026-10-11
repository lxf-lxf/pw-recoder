'use strict';

function installPanel() {
  if (window.__PW_PANEL_INSTALLED__) return;
  window.__PW_PANEL_INSTALLED__ = true;

  function mount() {
    if (!document.body || document.getElementById('__pw-panel')) return;

    const el = document.createElement('div');
    el.id = '__pw-panel';
    el.setAttribute('data-pw-recorder-ui', '1');
    el.style.cssText = [
      'position:fixed','right:16px','bottom:16px','z-index:2147483647',
      'background:#18181b','color:#fafafa','font:13px/1.4 system-ui,-apple-system,sans-serif',
      'padding:10px 12px','border-radius:12px','box-shadow:0 8px 30px rgba(0,0,0,.5)',
      'display:flex','gap:8px','align-items:center','user-select:none','border:1px solid #27272a',
    ].join(';');

    el.innerHTML = `
      <span style="display:flex;align-items:center;gap:6px">
        <span data-role="dot" style="width:8px;height:8px;border-radius:50%;background:#ef4444;box-shadow:0 0 8px #ef4444"></span>
        <span data-role="label">REC</span>
      </span>
      <button data-act="toggle" style="background:#3f3f46;color:#fff;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;font:inherit">Pause</button>
      <button data-act="save"   style="background:#2563eb;color:#fff;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;font:inherit">Save</button>
      <button data-act="reset"  style="background:#3f3f46;color:#fff;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;font:inherit">Reset</button>
      <span data-role="count" style="opacity:.6;min-width:22px;text-align:right">0</span>
    `;
    document.body.appendChild(el);

    const dot = el.querySelector('[data-role="dot"]');
    const label = el.querySelector('[data-role="label"]');
    const count = el.querySelector('[data-role="count"]');
    const toggle = el.querySelector('[data-act="toggle"]');

    // 录制状态同步：面板自身与终端命令共用这一个入口
    let recording = true;
    function setState(on) {
      recording = !!on;
      el.dataset.recording = recording ? '1' : '0';
      toggle.textContent = recording ? 'Pause' : 'Resume';
      label.textContent = recording ? 'REC' : 'PAUSED';
      dot.style.background = recording ? '#ef4444' : '#71717a';
      dot.style.boxShadow  = recording ? '0 0 8px #ef4444' : 'none';
    }
    setState(true);

    window.__pwRecorderSetState = setState;
    window.__pwRecorderSetCount = (n) => { count.textContent = String(n); };

    el.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      e.preventDefault(); e.stopPropagation();
      const act = btn.getAttribute('data-act');

      if (act === 'toggle') {
        const next = !recording;
        setState(next);
        await window.__pwRecorderToggle?.(next);
      } else if (act === 'save') {
        btn.textContent = '...';
        try { await window.__pwRecorderSave?.(); btn.textContent = 'Saved ✓'; }
        catch { btn.textContent = 'Error'; }
        setTimeout(() => { btn.textContent = 'Save'; }, 1200);
      } else if (act === 'reset') {
        await window.__pwRecorderReset?.();
        count.textContent = '0';
      }
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
}

module.exports = installPanel;
