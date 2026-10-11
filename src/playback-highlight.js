'use strict';

/**
 * 生成回放高亮的支持文件 `_pw-highlight.js`。
 *
 * 生成的 spec 只用一行接入：
 *   const page = hl(rawPage);
 * 之后每一行录制出来的操作**原样不动**（不需要给每个动作插一句高亮调用），
 * 由这个 Proxy 在动作方法被调用前先框出目标元素。
 *
 * 支持文件是自包含的（页面内绘制代码在生成时内联进去），
 * 只依赖 @playwright/test，跟着 spec 一起拷走也能用。
 */

const installHighlight = require('./highlight-client');

const SUPPORT_FILENAME = '_pw-highlight.js';

const HEADER = `'use strict';

// 由 pw-recorder 生成：回放时高亮每一步操作（可删，spec 会退化成不高亮）。
// 接入方式：const page = require('./_pw-highlight')(rawPage);
//
// 视觉与录制时一致：按元素类型着色的虚线框 + 操作名标签 + 点击涟漪。
// 想看清回放过程（例如录屏演示）：PW_HL_HOLD=2500 npx playwright test --headed

`;

const CLIENT_LINE = 'const installHighlight = ' + installHighlight.toString() + ';\n';

const BODY = `
const ACTION_METHODS = [
  'click', 'dblclick', 'check', 'uncheck', 'fill', 'press', 'selectOption', 'hover',
  'tap', 'type', 'clear', 'focus', 'blur', 'setInputFiles', 'dragTo', 'selectText',
  'pressSequentially',
];

// 会返回新 Locator 的链式方法：包一层，保证 .nth(2).fill() 这种长链也能高亮
const CHAIN_METHODS = ['first', 'last', 'nth', 'filter', 'and', 'or', 'locator'];

const installed = new WeakSet();

// 高亮停留时长（毫秒）；默认 900，演示时可调大
const HOLD_MS = parseInt(process.env.PW_HL_HOLD || '', 10);

async function ensureInstalled(page) {
  if (installed.has(page)) return;
  installed.add(page);
  try {
    await page.addInitScript(installHighlight);   // 后续导航自动注入
    await page.evaluate(installHighlight);        // 当前文档立刻生效
    if (HOLD_MS > 0) {
      await page.evaluate((h) => { window.__pwHighlight.holdMs = h; }, HOLD_MS);
    }
  } catch (e) { /* 高亮失败绝不拖累测试 */ }
}

async function flash(page, locator, action, args) {
  const detail = (action === 'fill' || action === 'press' || action === 'selectOption'
    || action === 'type' || action === 'pressSequentially') ? args[0] : undefined;
  try {
    await locator.evaluate(
      (el, opts) => { if (window.__pwHighlight) window.__pwHighlight.flash(el, opts); },
      { action: action, detail: detail },
      { timeout: 1500 },
    );
  } catch (e) { /* 元素还没出现/匹配多个：交给后面的真实动作去等和报错 */ }
}

function wrapLocator(page, locator) {
  return new Proxy(locator, {
    get(target, prop) {
      if (typeof prop !== 'string') return target[prop];
      const value = target[prop];
      if (typeof value !== 'function') return value;

      if (ACTION_METHODS.indexOf(prop) >= 0) {
        return async function (...args) {
          await ensureInstalled(page);
          await flash(page, target, prop, args);
          return value.apply(target, args);
        };
      }

      if (CHAIN_METHODS.indexOf(prop) >= 0 || prop.indexOf('getBy') === 0) {
        return function (...args) {
          return wrapLocator(page, value.apply(target, args));
        };
      }

      return value.bind(target);
    },
  });
}

function wrapPage(page) {
  return new Proxy(page, {
    get(target, prop) {
      if (typeof prop !== 'string') return target[prop];
      const value = target[prop];
      if (typeof value !== 'function') return value;

      if (prop === 'locator' || prop.indexOf('getBy') === 0) {
        return function (...args) {
          return wrapLocator(target, value.apply(target, args));
        };
      }

      return value.bind(target);
    },
  });
}

module.exports = function highlight(page) {
  return wrapPage(page);
};
`;

/**
 * 生成支持文件内容：把页面内绘制函数内联进去，保证文件自包含。
 * 注意不要把模板写成嵌套模板字符串，否则 ${} 转义会很容易出错。
 */
function renderSupportFile() {
  return HEADER + CLIENT_LINE + BODY;
}

module.exports = renderSupportFile;
module.exports.SUPPORT_FILENAME = SUPPORT_FILENAME;
module.exports.renderSupportFile = renderSupportFile;
