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
