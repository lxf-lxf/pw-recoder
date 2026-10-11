#!/usr/bin/env node
'use strict';

/**
 * v2 浏览器 Agent 端到端验证：
 *
 *   1) dist/pw-agent.js 与源码一致（防止提交了过期的 bundle）
 *   2) 起一个静态服务，用 <script src> 的方式把 agent 引入页面 → 应自动开始录制
 *   3) 模拟用户操作（含跨页跳转，验证 sessionStorage 续录）
 *   4) 点"结束并导出" → 弹出多语言窗口，逐个标签页校验生成的代码
 *   5) 落地三个文件，并对它们做真实验证：
 *        - JavaScript：用 Playwright 重新回放（真正的 UI auto test 重跑）
 *        - Python：python -m py_compile
 *        - Java：javac 编译（需要 .jars/ 里的 playwright + junit，缺失则 SKIP）
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const useLocalBrowsers = require('../src/browserPath');
useLocalBrowsers();

const { chromium } = require('@playwright/test');
const { bundle } = require('./build-agent');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'tests', 'generated');
const JARS_DIR = path.join(ROOT, '.jars');
const DOCS_DIR = path.join(ROOT, 'docs');

// ------------------------------------------------------------------ 静态服务

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, path.normalize(url).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ------------------------------------------------------------------ 工具

const step = (msg) => console.log('  • ' + msg);

/**
 * 异步执行外部命令。
 * 这里绝对不能用 spawnSync：它会阻塞父进程的事件循环，
 * 而回放用的静态服务就跑在这个进程里，一阻塞子进程就请求不到页面（ERR_ABORTED）。
 */
function run(cmd, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, Object.assign({ cwd: ROOT }, opts));
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (e) => resolve({ status: -1, out: out + String(e.message) }));
    child.on('close', (status) => resolve({ status, out }));
  });
}

function downloadJars() {
  fs.mkdirSync(JARS_DIR, { recursive: true });
  const jars = [
    ['playwright-1.48.0.jar', 'https://repo1.maven.org/maven2/com/microsoft/playwright/playwright/1.48.0/playwright-1.48.0.jar'],
    ['junit-jupiter-api-5.11.0.jar', 'https://repo1.maven.org/maven2/org/junit/jupiter/junit-jupiter-api/5.11.0/junit-jupiter-api-5.11.0.jar'],
    ['opentest4j-1.3.0.jar', 'https://repo1.maven.org/maven2/org/opentest4j/opentest4j/1.3.0/opentest4j-1.3.0.jar'],
    ['apiguardian-api-1.1.2.jar', 'https://repo1.maven.org/maven2/org/apiguardian/apiguardian-api/1.1.2/apiguardian-api-1.1.2.jar'],
  ];
  for (const [name, url] of jars) {
    const dest = path.join(JARS_DIR, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) continue;
    const r = spawnSync('curl', ['-sSL', '--max-time', '60', '-o', dest, url], { encoding: 'utf8' });
    if (r.status !== 0 || !fs.existsSync(dest) || fs.statSync(dest).size < 1000) {
      fs.rmSync(dest, { force: true });
      return null;
    }
  }
  return JARS_DIR;
}

// ------------------------------------------------------------------ 主流程

(async () => {
  // ---- 1) bundle 是否最新
  const { code } = bundle();
  const committed = fs.readFileSync(path.join(ROOT, 'dist', 'pw-agent.js'), 'utf8');
  assert.strictEqual(committed, code, 'dist/pw-agent.js 过期，请运行 npm run build:agent');
  step(`bundle 最新（${(Buffer.byteLength(code, 'utf8') / 1024).toFixed(1)} KB）`);

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const { server, port } = await serve();
  const base = `http://127.0.0.1:${port}`;
  step(`静态服务 ${base}`);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));

  await page.goto(`${base}/tests/fixtures/agent-demo.html`, { waitUntil: 'domcontentloaded' });

  // ---- 2) 引入即自动初始化 + 自动开始录制
  await page.waitForFunction(() => window.PWAgent && window.__pwAgentUI, null, { timeout: 5000 });
  const boot = await page.evaluate(() => ({
    version: window.PWAgent.version,
    recording: window.PWAgent.isRecording(),
    count: window.PWAgent.actionCount(),
    langs: window.PWAgent.languages().map((l) => l.id),
    widget: !!document.querySelector('.pwa-widget'),
  }));
  console.log('  Agent 启动状态:', JSON.stringify(boot));
  assert.strictEqual(boot.recording, true, '<script> 引入后应自动开始录制');
  assert.deepStrictEqual(boot.langs, ['javascript', 'python', 'java']);
  assert.ok(boot.widget, '右下角应出现录制控件');

  // ---- 3) 模拟用户操作
  await page.getByLabel('Email').fill('me@example.com');
  await page.getByLabel('Password').fill('s3cret');
  await page.locator('#plan').selectOption('pro');
  await page.locator('#remember').check();
  await page.locator('[data-testid="login-submit"]').click();
  await page.getByLabel('Row action').nth(1).click();
  await page.locator('#hover-box').hover();
  await page.locator('#hover-btn').click();
  await page.locator('#dbl').dblclick();
  await page.waitForTimeout(500);

  const beforeNav = await page.evaluate(() => window.PWAgent.actionCount());
  step(`第 1 页录到 ${beforeNav} 步`);

  // 跨页：点链接跳走，录制应通过 sessionStorage 续上
  await page.locator('#next').click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.PWAgent && window.PWAgent.actionCount() > 0, null, { timeout: 5000 });

  const afterNav = await page.evaluate(() => ({
    count: window.PWAgent.actionCount(),
    recording: window.PWAgent.isRecording(),
    actions: window.PWAgent.getActions().map((a) => a.type),
  }));
  console.log('  跳转后:', JSON.stringify({ count: afterNav.count, recording: afterNav.recording }));
  assert.ok(afterNav.count >= beforeNav, '跨页后录制应继续（sessionStorage 续录）');
  assert.strictEqual(afterNav.recording, true, '跨页后应仍在录制');
  assert.strictEqual(afterNav.actions.filter((t) => t === 'goto').length, 1, '只应有开头那一条 goto');

  await page.getByTestId('note-input').fill('第二页补充');
  await page.getByTestId('finish-btn').click();
  await page.waitForTimeout(500);

  // ---- 4) 结束并导出 → 弹窗
  await page.click('.pwa-widget [data-act="stop"]');
  await page.waitForSelector('.pwa-modal', { timeout: 5000 });
  step('导出弹窗已弹出');

  const modalInfo = await page.evaluate(() => ({
    tabs: Array.from(document.querySelectorAll('.pwa-tab')).map((t) => t.textContent.replace(/\s+/g, ' ').trim()),
    selected: document.querySelector('.pwa-tab[aria-selected="true"]').textContent.trim(),
    filename: document.querySelector('.pwa-meta code').textContent,
    steps: document.querySelector('.pwa-steps').textContent,
    lines: document.querySelectorAll('.pwa-gutter').length
      ? document.querySelector('.pwa-gutter').textContent.split('\n').length : 0,
  }));
  console.log('  弹窗:', JSON.stringify(modalInfo));
  assert.strictEqual(modalInfo.tabs.length, 3, '应有 3 个语言标签页');
  assert.strictEqual(modalInfo.filename, 'agent-demo-flow.spec.js');
  assert.ok(modalInfo.lines > 5, '预览区应显示代码行号');

  // ---- 5) 逐个语言取代码并校验
  const generated = {};
  const langIds = ['javascript', 'python', 'java'];
  for (const langId of langIds) {
    await page.locator('.pwa-tab').nth(langIds.indexOf(langId)).click();
    const view = await page.evaluate(() => ({
      filename: document.querySelector('.pwa-meta code').textContent,
      code: document.querySelector('.pwa-pre').textContent,
    }));
    // 同时用公开 API 取一份，两条路径必须一致
    const viaApi = await page.evaluate((id) => window.PWAgent.export(id), langId);
    assert.strictEqual(view.code, viaApi, `${langId}: 预览内容与 API 输出应一致`);
    // 弹窗截图作为文档证据
    fs.mkdirSync(DOCS_DIR, { recursive: true });
    await page.screenshot({ path: path.join(DOCS_DIR, `agent-export-${langId}.png`) });
    generated[langId] = { filename: view.filename, code: view.code };
    const file = path.join(OUT_DIR, view.filename);
    fs.writeFileSync(file, view.code, 'utf8');
    step(`${langId.padEnd(10)} → ${view.filename}（${view.code.split('\n').length} 行）`);
  }

  assert.ok(generated.javascript.code.includes("await page.getByLabel('Email').fill('me@example.com');"));
  assert.ok(generated.javascript.code.includes("await page.getByLabel('Row action').nth(1).click();"));
  assert.ok(generated.javascript.code.includes("await page.locator('#hover-box').hover();"));
  assert.ok(generated.javascript.code.includes("await page.getByTestId('note-input').fill('第二页补充');"),
    '跨页后的操作也要在导出的脚本里');
  assert.ok(generated.python.code.includes('page.get_by_label("Email").fill("me@example.com")'));
  assert.ok(generated.python.code.includes('def test_agent_demo_flow(page: Page) -> None:'));
  assert.ok(generated.java.code.includes('page.getByLabel("Email").fill("me@example.com");'));
  assert.ok(generated.java.code.includes('class AgentDemoFlowTest'));
  assert.ok(generated.java.code.includes('page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("隐藏按钮")).click();'));

  assert.deepStrictEqual(pageErrors, [], '页面不应有 JS 报错：' + pageErrors.join(' | '));

  // ---- 5b) ?autoInit=false：只挂 API，不显示控件；手动 init 后才出现
  const manual = await context.newPage();
  await manual.setContent(
    `<script src="${base}/dist/pw-agent.js?autoInit=false" data-title="manual flow"></script>`,
    { waitUntil: 'load' },
  );
  await manual.waitForFunction(() => !!window.PWAgent, null, { timeout: 5000 });
  const passive = await manual.evaluate(() => ({
    widget: !!document.querySelector('.pwa-widget'),
    recording: window.PWAgent.isRecording(),
    count: window.PWAgent.actionCount(),
  }));
  console.log('  autoInit=false 状态:', JSON.stringify(passive));
  assert.strictEqual(passive.widget, false, 'autoInit=false 时不应出现任何 UI');
  assert.strictEqual(passive.recording, false);
  assert.strictEqual(passive.count, 0);

  await manual.evaluate(() => window.PWAgent.init({ autoStart: false, title: 'manual flow' }));
  await manual.waitForSelector('.pwa-widget', { timeout: 3000 });
  const afterInit = await manual.evaluate(() => ({
    widget: !!document.querySelector('.pwa-widget'),
    recording: window.PWAgent.isRecording(),
  }));
  console.log('  手动 init 后:', JSON.stringify(afterInit));
  assert.ok(afterInit.widget, 'init() 后应出现控件');
  assert.strictEqual(afterInit.recording, false, 'autoStart:false 时不应自动开录');

  await manual.evaluate(() => window.PWAgent.start());
  await manual.locator('#x').count().catch(() => {});
  assert.strictEqual(await manual.evaluate(() => window.PWAgent.isRecording()), true, '手动 start() 后应开始录制');
  await manual.close();

  await browser.close();

  // ---- 6a) JavaScript：用 Playwright 真回放（UI auto test 重跑）
  // 服务保持运行，因为导出的脚本里写的正是这个地址
  const pwCli = path.join(ROOT, 'node_modules', '.bin', 'playwright');
  const jsRun = await run(pwCli, [
    'test',
    '--config', 'playwright.generated.config.js',
    '--reporter=list',
    generated.javascript.filename,
  ], { encoding: 'utf8', env: process.env });
  console.log(jsRun.out.split('\n').filter((l) => /passed|failed|✓|✘|Error/.test(l)).slice(-5).map((l) => '    ' + l).join('\n'));
  assert.strictEqual(jsRun.status, 0, '导出的 JavaScript 脚本回放失败');
  step('JavaScript: Playwright 回放通过（导出的脚本就是可重跑的 UI auto test）');

  server.close();

  // ---- 6b) Python：语法 + 编译
  const py = spawnSync('/Users/linxifan/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3',
    ['-m', 'py_compile', path.join(OUT_DIR, generated.python.filename)], { encoding: 'utf8' });
  assert.strictEqual(py.status, 0, 'Python 脚本编译失败: ' + (py.stderr || ''));
  step('Python: py_compile 通过');

  // ---- 6c) Java：javac 编译
  const jars = downloadJars();
  if (!jars) {
    step('Java: SKIP（无法下载 playwright/junit jar）');
  } else {
    const cp = fs.readdirSync(jars).map((f) => path.join(jars, f)).join(path.delimiter);
    const classes = path.join(OUT_DIR, 'classes');
    fs.mkdirSync(classes, { recursive: true });
    const jc = spawnSync('javac', ['-cp', cp, '-d', classes, path.join(OUT_DIR, generated.java.filename)], { encoding: 'utf8' });
    assert.strictEqual(jc.status, 0, 'Java 脚本编译失败:\n' + (jc.stderr || ''));
    step('Java: javac 编译通过');
  }

  console.log('\n✅ agent-e2e: 引入即录制 → 跨页续录 → 弹窗导出三语言 → 落地并验证 全链路通过');
})().catch((err) => {
  console.error('\n❌ agent-e2e 失败:', err.message);
  process.exit(1);
});
