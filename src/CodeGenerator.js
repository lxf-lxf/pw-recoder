'use strict';

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

// 页面里同类元素不止一个时（列表项、多个同名按钮）必须带 .nth()，
// 否则回放时 Playwright 会直接以 strict mode violation 报错。
const withNth = (locator, m) =>
  m && m.n > 1 && typeof m.i === 'number' && m.i >= 0
    ? `${locator}.nth(${m.i})`
    : locator;

function buildLocator(t) {
  if (!t) return 'page.locator("body")';
  const m = t.match || {};

  if (t.testId)    return withNth(`page.getByTestId('${escapeStr(t.testId)}')`, m.testId);
  if (t.ariaLabel) return withNth(`page.getByLabel('${escapeStr(t.ariaLabel)}')`, m.label);
  if (t.placeholder) return withNth(`page.getByPlaceholder('${escapeStr(t.placeholder)}')`, m.placeholder);

  const role = inferRole(t);
  const text = (t.text || '').trim();
  if (role && text && text.length <= 60)
    return withNth(`page.getByRole('${role}', { name: '${escapeStr(text)}' })`, m.role);
  if (role === 'textbox' && t.name)
    return withNth(`page.getByRole('textbox', { name: '${escapeStr(t.name)}' })`, m.name);

  if (t.id)   return `page.locator('#${cssId(t.id)}')`;   // id 天然唯一
  if (t.name) return withNth(`page.locator('[name="${escapeStr(t.name)}"]')`, m.name);
  if (t.tagPath) return withNth(`page.locator('${escapeStr(t.tagPath)}')`, m.tagPath);
  return `page.locator('${escapeStr(t.tag)}')`;
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
