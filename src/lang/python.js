'use strict';

/**
 * 动作 → Playwright Python 代码（pytest + sync API）。
 * 选择器来自 CodeGenerator.resolveLocator，与 JS/Java 完全一致。
 */

const { resolveLocator } = require('../CodeGenerator');

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
