#!/usr/bin/env node
'use strict';

/**
 * 端到端自检（headless，无需人工操作）：
 *   真实启动 Chromium → 注入录制器 → 用 Playwright 模拟用户操作
 *   → 断言捕获到的动作与顺序 → 导出 .spec.js → 断言生成的代码正确
 *
 * 运行: npm run e2e
 * 产物: .e2e-out/e2e.spec.js（脚本结束后自动清理）
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const useLocalBrowsers = require('../src/browserPath');
useLocalBrowsers();

const { chromium } = require('@playwright/test');

const Recorder = require('../src/Recorder');
const installPanel = require('../src/panel');

const OUT_DIR = path.resolve(__dirname, '../.e2e-out');
const OUT_FILE = path.join(OUT_DIR, 'e2e.spec.js');
const FIXTURE = 'file://' + path.resolve(__dirname, '../tests/fixtures/demo.html');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const recorder = new Recorder(page, { title: 'demo flow', outputFile: OUT_FILE });
  await recorder.start(FIXTURE);

  // 模拟用户操作
  await page.getByLabel('Email').fill('me@example.com');
  await page.getByLabel('Password').fill('s3cret');
  await page.locator('#plan').selectOption('pro');
  await page.locator('#remember').check();
  await page.locator('[data-testid="login-submit"]').click();
  await page.getByTestId('search').fill('hello');
  await page.getByTestId('search').press('Enter');

  // 等 fill 的 400ms 防抖落地
  await page.waitForTimeout(800);
  await recorder.stop();

  const actions = recorder.actions;
  const types = actions.map((a) => a.type);
  console.log('捕获到的动作:', types.join(', '));

  // ---- 1) 动作种类与数量：不多录、不漏录 ----------------------------------
  const count = (t) => types.filter((x) => x === t).length;
  assert.strictEqual(types[0], 'goto', '第一个动作应为 goto');
  assert.strictEqual(count('goto'), 1);
  assert.strictEqual(count('fill'), 3, '应记录 3 次 fill（email/password/search）');
  assert.strictEqual(count('select'), 1, 'select 下拉应被记录');
  assert.strictEqual(count('check'), 1, '勾选复选框应被记录');
  assert.strictEqual(count('click'), 1, '复选框点击不应重复记成 click');
  assert.strictEqual(count('press'), 1);

  // ---- 2) 顺序：防抖的 fill 必须排在它触发的 click/press 之前 ---------------
  const idx = (pred) => actions.findIndex(pred);
  const iEmail  = idx((a) => a.type === 'fill' && a.target.ariaLabel === 'Email');
  const iPass   = idx((a) => a.type === 'fill' && a.target.ariaLabel === 'Password');
  const iSelect = idx((a) => a.type === 'select');
  const iCheck  = idx((a) => a.type === 'check');
  const iSubmit = idx((a) => a.type === 'click' && a.target.testId === 'login-submit');
  const iSearch = idx((a) => a.type === 'fill' && a.target.testId === 'search');
  const iEnter  = idx((a) => a.type === 'press');

  for (const [name, i] of Object.entries({ iEmail, iPass, iSelect, iCheck, iSubmit, iSearch, iEnter })) {
    assert.ok(i > 0, `${name} 未被捕获`);
  }
  assert.ok(iEmail < iPass, 'email 的 fill 应早于 password');
  assert.ok(iPass < iSelect, 'password 的 fill 应早于 select');
  assert.ok(iSelect < iCheck && iCheck < iSubmit, 'select/check/click 顺序错误');
  assert.ok(iSearch < iEnter, 'press 之前的 fill 必须先入队，否则回放顺序会反转');

  // ---- 3) 元素描述是否正确 ------------------------------------------------
  assert.strictEqual(actions[iEmail].value, 'me@example.com');
  // <label for="email"> 关联出的可访问名也要能读到，否则只能退化成 #id / CSS 路径
  assert.strictEqual(actions[iEmail].target.ariaLabel, 'Email', '应通过 <label for> 读到 Email');
  assert.strictEqual(actions[iPass].target.ariaLabel, 'Password', '显式 aria-label 优先');
  assert.strictEqual(actions[iSelect].target.ariaLabel, 'Plan');
  assert.strictEqual(actions[iCheck].target.ariaLabel, 'Remember me');
  assert.strictEqual(actions[iSelect].value, 'pro', 'select 应记录选中值');
  assert.strictEqual(actions[iCheck].checked, true, 'check 应记录勾选状态');

  // ---- 4) 导出与代码生成 --------------------------------------------------
  const exported = await recorder.export();
  assert.ok(fs.existsSync(exported), '导出的 .spec.js 应存在');

  const spec = fs.readFileSync(exported, 'utf8');
  console.log('\n--- 生成的代码 ---\n' + spec);

  assert.ok(spec.includes("test('demo flow'"));
  assert.ok(spec.includes(`await page.goto('${FIXTURE}');`));
  assert.ok(spec.includes("await page.getByLabel('Email').fill('me@example.com');"));
  assert.ok(spec.includes("await page.getByLabel('Password').fill('s3cret');"));
  assert.ok(spec.includes("await page.getByLabel('Plan').selectOption('pro');"));
  assert.ok(spec.includes("await page.getByLabel('Remember me').check();"));
  assert.ok(spec.includes("await page.getByTestId('login-submit').click();"));
  assert.ok(spec.includes("await page.getByTestId('search').fill('hello');"));
  assert.ok(spec.includes("await page.getByTestId('search').press('Enter');"));

  // 生成的代码里不应出现多余动作
  assert.ok(!spec.includes('.click();\n  await page.getByLabel(\'Email\')'), '输入框不应额外生成 click');
  assert.strictEqual(spec.split('.click();').length - 1, 1, '整个流程只应有 1 次 click（提交按钮）');

  // 生成的代码必须是合法 JS（编译一次，不执行）
  new Function('require', spec);

  // ---- 5) 悬浮面板：挂载、状态同步、且面板自身操作不被录进去 ----------------
  await page.evaluate(installPanel);
  const mounted = await page.evaluate(() => {
    const el = document.getElementById('__pw-panel');
    return el
      ? {
          rec: el.dataset.recording,
          label: el.querySelector('[data-role="label"]').textContent,
          button: el.querySelector('[data-act="toggle"]').textContent,
        }
      : null;
  });
  console.log('面板初始状态:', JSON.stringify(mounted));
  assert.ok(mounted, '面板应已挂载到页面');
  assert.strictEqual(mounted.rec, '1');
  assert.strictEqual(mounted.label, 'REC');

  // 面板是录制器的 UI，点它不应该产生任何动作
  await recorder.resume();
  const beforePanelClick = recorder.actions.length;
  await page.click('#__pw-panel [data-act="toggle"]');
  await page.waitForTimeout(80);
  assert.strictEqual(
    recorder.actions.length,
    beforePanelClick,
    '点击面板自身不应被录制（data-pw-recorder-ui 过滤失效了）',
  );

  // 状态同步入口（终端控制 / 跳转后重建 DOM 时靠它对齐）
  const synced = await page.evaluate(() => {
    const el = document.getElementById('__pw-panel');
    const read = () => ({
      rec: el.dataset.recording,
      label: el.querySelector('[data-role="label"]').textContent,
      button: el.querySelector('[data-act="toggle"]').textContent,
    });
    window.__pwRecorderSetState(false);
    const paused = read();
    window.__pwRecorderSetCount(7);
    return { paused, count: el.querySelector('[data-role="count"]').textContent };
  });
  console.log('面板暂停态:', JSON.stringify(synced));
  assert.deepStrictEqual(synced.paused, { rec: '0', label: 'PAUSED', button: 'Resume' });
  assert.strictEqual(synced.count, '7', '面板计数应可被外部推送');
  await recorder.stop();

  // ---- 6) 回归：重复元素 / dblclick 去重 / 只有 hover 才可见的元素 -------------
  // 这三条都是真实站点（TodoMVC）上踩出来的，改动选择器或事件逻辑时必须保持
  recorder.reset();
  await recorder.resume();

  await page.getByLabel('Row action').nth(1).click();     // 同类元素 → 必须带 .nth()
  await page.locator('#dbl').dblclick();                  // 浏览器先发两次 click，只能记 dblclick
  await page.locator('#hover-box').hover();               // 真实用户也要先 hover
  await page.locator('#hover-btn').click();               // 默认 display:none，靠 :hover 显示

  await page.waitForTimeout(100);
  await recorder.stop();

  const spec2 = recorder.generate();
  console.log('\n--- 回归用例生成的代码 ---\n' + spec2);

  const types2 = recorder.actions.map((a) => a.type);
  const count2 = (t) => types2.filter((x) => x === t).length;

  assert.strictEqual(count2('click'), 2, '只应有 2 次 click（行按钮 + 隐藏按钮），dblclick 前的两次不能留');
  assert.strictEqual(count2('dblclick'), 1);
  assert.strictEqual(count2('hover'), 1, 'hover 才可见的元素必须补一步 hover');
  assert.ok(spec2.includes("getByLabel('Row action').nth(1).click();"), '同类元素缺少 .nth(1)');
  assert.ok(!spec2.includes("getByLabel('Row action').nth(0)"), '点的是第 2 个，不应生成 .nth(0)');
  assert.ok(
    spec2.indexOf("page.locator('#hover-box').hover();") < spec2.indexOf('隐藏按钮'),
    'hover 必须排在隐藏按钮的 click 之前',
  );

  // ---- 7) 回归：首跳失败不能崩，且恢复后必须还能正常录 ------------------------
  // 对应真实场景：`--url http://localhost:3000` 但服务还没起来
  const page2 = await browser.newPage();
  const rec2 = new Recorder(page2, {
    title: 'recover flow',
    outputFile: path.join(OUT_DIR, 'recover.spec.js'),
  });

  let startThrew = false;
  try {
    await rec2.start('http://127.0.0.1:3999/');   // 合法但没人监听的端口 → ECONNREFUSED
  } catch (e) {
    startThrew = true;
  }
  assert.ok(startThrew, '连不上的地址应抛出可捕获的错误，而不是让进程崩掉');
  assert.strictEqual(rec2.actions.length, 0, '失败的 goto 不该留在动作列表里');

  await rec2.navigate(FIXTURE);                 // 相当于用户在 REPL 里敲 goto <url>
  if (!rec2.recording) await rec2.resume();

  await page2.getByTestId('search').fill('recovered');
  await page2.getByTestId('search').press('Enter');
  await page2.waitForTimeout(800);
  await rec2.stop();

  const spec3 = rec2.generate();
  console.log('\n--- 导航失败恢复后生成的代码 ---\n' + spec3);
  assert.ok(
    spec3.includes("await page.getByTestId('search').fill('recovered');"),
    '恢复后应能继续正常录制',
  );
  assert.strictEqual(spec3.split('page.goto').length - 1, 1, '只应记录一次成功的 goto');
  assert.ok(!spec3.includes('127.0.0.1:3999'), '失败的首跳不应出现在生成代码里');
  await page2.close();

  await browser.close();
  fs.rmSync(OUT_DIR, { recursive: true, force: true });

  console.log('\n✅ e2e: 注入 → 捕获 → 生成 → 导出 → 失败恢复 全链路通过');
})().catch((err) => {
  console.error('\n❌ e2e 失败:', err.message);
  process.exit(1);
});
