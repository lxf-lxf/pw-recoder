'use strict';

/**
 * 动作 → Playwright Java 代码（JUnit 5）。
 * 选择器来自 CodeGenerator.resolveLocator，与 JS/Python 完全一致。
 *
 * AriaRole 是枚举：角色名先按"大写去符号"映射（menuitemcheckbox → MENUITEMCHECKBOX），
 * 不在枚举里就退化成 CSS 选择器，保证生成的代码一定能编译。
 */

const { resolveLocator } = require('../CodeGenerator');

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
