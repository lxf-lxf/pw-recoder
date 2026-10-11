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
