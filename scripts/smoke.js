#!/usr/bin/env node
'use strict';

/**
 * 不启动浏览器的自检脚本：验证「动作 → Playwright 代码」这一段是通的。
 * 运行: npm run smoke
 */

const assert = require('assert');
const generateSpec = require('../src/CodeGenerator');
const { buildLocator } = require('../src/CodeGenerator');

const actions = [
  { type: 'goto', url: 'https://example.com/' },
  { type: 'click', target: { tag: 'a', text: 'Sign in', tagPath: 'a' } },
  { type: 'fill', target: { tag: 'input', ariaLabel: 'Email', type: 'email' }, value: 'me@example.com' },
  { type: 'fill', target: { tag: 'input', ariaLabel: 'Password', type: 'password' }, value: "s3c'ret" },
  { type: 'click', target: { tag: 'button', text: 'Log in', type: 'submit' }, modifiers: { ctrl: true } },
  { type: 'select', target: { tag: 'select', name: 'plan' }, value: 'pro' },
  { type: 'check', target: { tag: 'input', type: 'checkbox', name: 'remember' }, checked: true },
  { type: 'press', target: { tag: 'input', testId: 'search' }, key: 'Enter' },
];

const spec = generateSpec(actions, { title: '登录流程' });
console.log(spec);

// 选择器优先级
assert.strictEqual(buildLocator({ tag: 'input', testId: 'search' }), "page.getByTestId('search')");
assert.strictEqual(buildLocator({ tag: 'input', ariaLabel: 'Email' }), "page.getByLabel('Email')");
assert.strictEqual(buildLocator({ tag: 'input', placeholder: 'Search' }), "page.getByPlaceholder('Search')");
assert.strictEqual(buildLocator({ tag: 'a', text: 'Sign in' }), "page.getByRole('link', { name: 'Sign in' })");
assert.strictEqual(buildLocator({ tag: 'div', id: 'app' }), "page.locator('#app')");
assert.strictEqual(buildLocator({ tag: 'div', name: 'q' }), 'page.locator(\'[name="q"]\')');

// 代码内容
assert.ok(spec.includes("test('登录流程'"));
assert.ok(spec.includes("await page.goto('https://example.com/');"));
assert.ok(spec.includes(".click({ modifiers: ['Control'] });"));
assert.ok(spec.includes(".selectOption('pro');"));
assert.ok(spec.includes(".check();"));
assert.ok(spec.includes(".press('Enter');"));
// 单引号被正确转义，不会破坏生成的字符串字面量
assert.ok(spec.includes("fill('s3c\\'ret');"));

// 同类元素不止一个时必须带 .nth()，否则回放会 strict mode violation
assert.strictEqual(
  buildLocator({ tag: 'a', text: 'x', ariaLabel: 'Delete', match: { label: { n: 3, i: 2 } } }),
  "page.getByLabel('Delete').nth(2)",
);
assert.strictEqual(
  buildLocator({ tag: 'a', text: 'x', ariaLabel: 'Delete', match: { label: { n: 1, i: 0 } } }),
  "page.getByLabel('Delete')",
);
assert.strictEqual(
  buildLocator({ tag: 'label', testId: 'todo-title', match: { testId: { n: 3, i: 0 } } }),
  "page.getByTestId('todo-title').nth(0)",
);
assert.strictEqual(
  buildLocator({ tag: 'a', text: 'Completed', match: { role: { n: 1, i: 0 } } }),
  "page.getByRole('link', { name: 'Completed' })",
);
assert.strictEqual(
  buildLocator({ tag: 'a', text: 'Completed', match: { role: { n: 2, i: 1 } } }),
  "page.getByRole('link', { name: 'Completed' }).nth(1)",
);
// id 天然唯一，不该加 .nth()
assert.strictEqual(buildLocator({ tag: 'div', id: 'app', match: { id: { n: 1, i: 0 } } }), "page.locator('#app')");
// 没有 match 信息时保持原样（兼容手工构造的动作）
assert.strictEqual(buildLocator({ tag: 'a', text: 'Go' }), "page.getByRole('link', { name: 'Go' })");

// hover 动作（只有 :hover 才可见的元素需要它）
assert.ok(
  generateSpec([{ type: 'hover', target: { tag: 'li', testId: 'todo-item', match: { testId: { n: 3, i: 2 } } } }])
    .includes("await page.getByTestId('todo-item').nth(2).hover();"),
);

// 地址补全：命令行不接受"没写协议头"这种报错
const normalizeUrl = require('../src/url');
assert.strictEqual(normalizeUrl('www.baidu.com'), 'https://www.baidu.com');
assert.strictEqual(normalizeUrl('baidu.com/s?wd=hi'), 'https://baidu.com/s?wd=hi');
assert.strictEqual(normalizeUrl('  example.com  '), 'https://example.com');
assert.strictEqual(normalizeUrl('https://example.com'), 'https://example.com');
assert.strictEqual(normalizeUrl('http://example.com'), 'http://example.com');
assert.strictEqual(normalizeUrl('//example.com'), 'https://example.com');
// 本机 / 内网走 http（开发服务器通常没有证书）
assert.strictEqual(normalizeUrl('localhost:3000'), 'http://localhost:3000');
assert.strictEqual(normalizeUrl('localhost:3000/demo.html'), 'http://localhost:3000/demo.html');
assert.strictEqual(normalizeUrl('127.0.0.1:8080'), 'http://127.0.0.1:8080');
assert.strictEqual(normalizeUrl('192.168.1.5:5173'), 'http://192.168.1.5:5173');
assert.strictEqual(normalizeUrl('10.0.0.7'), 'http://10.0.0.7');
assert.strictEqual(normalizeUrl('myapp:8080'), 'http://myapp:8080');
assert.strictEqual(normalizeUrl('dev.local:3000'), 'http://dev.local:3000');
// 带端口的公网域名仍是 https
assert.strictEqual(normalizeUrl('example.com:8443'), 'https://example.com:8443');
// 特殊协议原样保留
assert.strictEqual(normalizeUrl('about:blank'), 'about:blank');
assert.strictEqual(normalizeUrl('file:///tmp/a.html'), 'file:///tmp/a.html');

// 回放高亮：默认带高亮壳子，--no-highlight 时是干净的纯 codegen 风格
const withHl = generateSpec(actions, { title: 't' });
assert.ok(withHl.includes("try { hl = require('./_pw-highlight'); } catch (e) {}"), '应接入高亮支持文件');
assert.ok(withHl.includes('const page = hl(rawPage);'));
assert.ok(withHl.includes('async ({ page: rawPage }) =>'));
assert.ok(withHl.includes('支持文件缺失时自动降级'), '缺少支持文件时应能降级');

const plain = generateSpec(actions, { title: 't', highlight: false });
assert.ok(!plain.includes('hl('), '关掉高亮后不该留壳子');
assert.ok(plain.includes('async ({ page }) =>'));

// 关键不变量：开/关高亮，录制出来的每一步代码必须一字不差
const stepsOf = (s) => s.split('\n').filter((l) => l.trim().startsWith('await '));
assert.deepStrictEqual(stepsOf(withHl), stepsOf(plain), '高亮不得改动任何一步动作代码');

// 生成的支持文件必须自包含且语法合法（页面内绘制代码会被内联进去）
const renderSupportFile = require('../src/playback-highlight');
const supportSrc = renderSupportFile();
new (require('vm').Script)(supportSrc, { filename: '_pw-highlight.js' });
assert.ok(supportSrc.includes('function installHighlight'), '页面内绘制代码应内联进支持文件');
assert.ok(!supportSrc.includes("require('../src"), '支持文件不得依赖录制器源码目录');
assert.ok(supportSrc.includes('wrapLocator') && supportSrc.includes('ACTION_METHODS'));

// 生成的代码必须是合法 JS（用 Function 编译一次，不执行）
new Function('require', spec);

console.log('✅ smoke: 全部断言通过，生成代码可被 JS 解析');

// ---- v2：多语言导出 ---------------------------------------------------------
const { LANGS, byId } = require('../src/lang');
const { resolveLocator } = require('../src/CodeGenerator');

// 语言无关的 locator 描述
assert.deepStrictEqual(
  resolveLocator({ tag: 'input', testId: 'x', match: { testId: { n: 3, i: 1 } } }),
  { kind: 'testId', value: 'x', nth: 1 },
);
assert.deepStrictEqual(
  resolveLocator({ tag: 'a', text: 'Go', match: { role: { n: 1, i: 0 } } }),
  { kind: 'role', role: 'link', name: 'Go', nth: null },
);

// 文件名 / 函数名 / 类名
assert.strictEqual(byId('javascript').filename('Demo Flow'), 'demo-flow.spec.js');
assert.strictEqual(byId('python').filename('Demo Flow'), 'test_demo_flow.py');
assert.strictEqual(byId('java').filename('Demo Flow'), 'DemoFlowTest.java');
assert.deepStrictEqual(LANGS.map((l) => l.id), ['javascript', 'python', 'java']);

const v2actions = [
  { type: 'goto', url: 'https://example.com/' },
  { type: 'fill', target: { tag: 'input', testId: 'x', match: { testId: { n: 3, i: 1 } } }, value: 'hi "there"' },
  { type: 'click', target: { tag: 'button', text: '隐藏按钮' }, modifiers: { ctrl: true, shift: true } },
  { type: 'check', target: { tag: 'input', type: 'checkbox', ariaLabel: 'Remember me' }, checked: false },
  { type: 'hover', target: { tag: 'div', id: 'hover-box' } },
  { type: 'click', target: { tag: 'div', role: 'mycustomrole', text: 'X', tagPath: 'div > span' } },
];
const js2 = byId('javascript').generate(v2actions, { title: 'Demo Flow', highlight: false });
const py2 = byId('python').generate(v2actions, { title: 'Demo Flow' });
const jv2 = byId('java').generate(v2actions, { title: 'Demo Flow' });

// 同一元素在三种语言里必须用同一套选择器策略
assert.ok(js2.includes("page.getByTestId('x').nth(1).fill('hi \"there\"')"));
assert.ok(py2.includes('page.get_by_test_id("x").nth(1).fill("hi \\"there\\"")'));
assert.ok(jv2.includes('page.getByTestId("x").nth(1).fill("hi \\"there\\"");'));

// 修饰键
assert.ok(js2.includes("click({ modifiers: ['Control', 'Shift'] })"));
assert.ok(py2.includes('click(modifiers=["Control", "Shift"])'));
assert.ok(jv2.includes('setModifiers(Arrays.asList(KeyboardModifier.CONTROL, KeyboardModifier.SHIFT))'));

// uncheck / hover / 自定义 role
assert.ok(js2.includes(".uncheck();") && py2.includes('.uncheck()') && jv2.includes('.uncheck();'));
assert.ok(js2.includes("page.locator('#hover-box').hover();"));
assert.ok(py2.includes('page.locator("#hover-box").hover()'));
assert.ok(jv2.includes('page.locator("#hover-box").hover();'));
// Java 的 AriaRole 是枚举：未知角色必须退化成 CSS，不能生成编译不过的枚举值
assert.ok(jv2.includes('page.locator("div > span").click();'), 'Java 未知 role 应退化成 CSS 选择器');
assert.ok(!jv2.includes('AriaRole.MYCUSTOMROLE'));
assert.ok(js2.includes("page.getByRole('mycustomrole', { name: 'X' })"), 'JS/Python 可以用字符串角色');

// 三种语言都要覆盖到每一个动作
for (const code of [js2, py2, jv2]) {
  assert.ok(code.includes('goto') || code.includes('navigate'));
  assert.ok(code.includes('hover'));
  assert.ok(code.includes('uncheck'));
}
assert.ok(!py2.includes('\n    \n'), 'Python 生成结果不应有空行残留');
