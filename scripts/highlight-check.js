#!/usr/bin/env node
'use strict';

/**
 * 高亮功能自检 + 视觉证据生成。
 *
 * 断言：
 *   1) 录制时：每个被捕获的操作都会在页面上画出虚线高亮框，且按元素类型着色
 *      （button #FF6B6B / input #4ECDC4 / select #45B7D1 / a #96CEB4，取自 browser-use）
 *   2) 高亮层不会被录制器自己录进去（pointer-events:none + data-pw-recorder-ui）
 *   3) 回放时：生成的 _pw-highlight.js 能在动作前框出目标，且不改变测试行为
 *
 * 产物：.e2e-out/highlight-recording.png、.e2e-out/highlight-playback.png
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const useLocalBrowsers = require('../src/browserPath');
useLocalBrowsers();

const { chromium } = require('@playwright/test');
const Recorder = require('../src/Recorder');

const OUT_DIR = path.resolve(__dirname, '../.e2e-out');   // 中间产物
const DOCS_DIR = path.resolve(__dirname, '../docs');    // 截图证据（长期保留）
const FIXTURE = 'file://' + path.resolve(__dirname, '../tests/fixtures/demo.html');

// 读出页面上当前的高亮覆盖层（排除右下角控制器面板）
const READ_OVERLAYS = () => {
  const panel = document.getElementById('__pw-panel');
  return Array.from(document.querySelectorAll('[data-pw-recorder-ui]'))
    .filter((el) => el !== panel)
    .map((el) => {
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        label: (el.textContent || '').trim(),
        borderStyle: cs.borderTopStyle,
        borderColor: cs.borderTopColor,
        hasChip: !!el.querySelector('span'),
      };
    });
};

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  const browser = await chromium.launch();

  // ---------- 1) 录制时高亮 ----------
  const recPage = await browser.newPage();
  const recorder = new Recorder(recPage, {
    title: 'highlight check',
    outputFile: path.join(OUT_DIR, 'highlight.spec.js'),
    highlight: true,
  });
  await recorder.start(FIXTURE);

  assert.ok(await recPage.evaluate(() => !!window.__pwHighlight), '录制时应安装高亮客户端');

  // 截图取证要慢工出细活：截图本身有几百毫秒开销，默认 900ms 的高亮会先淡出
  await recPage.evaluate(() => { window.__pwHighlight.holdMs = 8000; });

  await recPage.getByTestId('login-submit').click();
  await recPage.waitForTimeout(160);   // 等 90ms 淡入完成，否则截到半透明状态
  await recPage.screenshot({ path: path.join(DOCS_DIR, 'highlight-recording.png') });
  const btnOverlays = await recPage.evaluate(READ_OVERLAYS);

  console.log('录制-按钮高亮:', JSON.stringify(btnOverlays));
  assert.ok(btnOverlays.length >= 1, '点击后应画出高亮框');
  assert.strictEqual(btnOverlays[0].borderStyle, 'dashed', '应是虚线框（对齐 browser-use 的 dashed 风格）');
  assert.strictEqual(btnOverlays[0].borderColor, rgb('#FF6B6B'), 'button 应为 red #FF6B6B');
  assert.strictEqual(btnOverlays[0].label, 'click', '标签应显示操作名');
  assert.ok(btnOverlays[0].hasChip, '应有文字标签');

  await recPage.getByLabel('Email').fill('me@example.com');
  await recPage.waitForTimeout(500);   // 等 fill 的 400ms 防抖落地
  const inputOverlays = await recPage.evaluate(READ_OVERLAYS);
  console.log('录制-输入框高亮:', JSON.stringify(inputOverlays));
  assert.ok(
    inputOverlays.some((o) => o.borderColor === rgb('#4ECDC4') && /^fill /.test(o.label)),
    'input 应为 teal #4ECDC4 且标签带输入值',
  );

  // 高亮层不能被自己录进去
  const recorded = recorder.actions.map((a) => a.type);
  assert.strictEqual(
    recorded.filter((t) => t === 'click').length, 1,
    '点击按钮只应记录 1 次 click（高亮层不该产生额外事件）',
  );
  await recorder.stop();

  // ---------- 2) 回放时高亮 ----------
  // 直接用录制器生成的产物，确保测的就是用户会 require 的那个文件
  const exported = await recorder.export();
  const support = path.join(path.dirname(exported), '_pw-highlight.js');
  assert.ok(fs.existsSync(support), '导出时应生成 _pw-highlight.js');
  const hl = require(support);

  const raw = await browser.newPage();
  await raw.goto(FIXTURE);
  // 预览时先装好，方便把停留时长调大给截图用
  await raw.evaluate(require('../src/highlight-client'));
  await raw.evaluate(() => { window.__pwHighlight.holdMs = 8000; });

  const page = hl(raw);                       // 生成脚本里的接入方式

  await page.getByLabel('Email').fill('me@example.com');   // 走 Proxy，动作写法不变
  await raw.waitForTimeout(160);       // 等淡入完成
  const op = await raw.evaluate(() => {
    const el = document.querySelector('[data-pw-recorder-ui]');
    return el ? getComputedStyle(el).opacity : null;
  });
  console.log('  截图时高亮层 opacity =', op);
  await raw.screenshot({ path: path.join(DOCS_DIR, 'highlight-playback.png') });
  const pbOverlays = await raw.evaluate(READ_OVERLAYS);

  console.log('回放-输入框高亮:', JSON.stringify(pbOverlays));
  assert.ok(pbOverlays.length >= 1, '回放时动作前应画出高亮框');
  assert.strictEqual(pbOverlays[0].borderColor, rgb('#4ECDC4'), 'input 高亮颜色应一致');
  assert.ok(/^fill "me@example\.com"/.test(pbOverlays[0].label), '标签应带动作与内容');
  assert.strictEqual(await raw.inputValue('#email'), 'me@example.com', '高亮不得影响动作本身');

  // 链式 locator 也要能高亮（.nth(1).click() 这种）
  await page.getByLabel('Row action').nth(1).click();
  const nthOverlays = await raw.evaluate(READ_OVERLAYS);
  console.log('回放-链式 locator:', JSON.stringify(nthOverlays));
  assert.ok(nthOverlays.some((o) => o.label === 'click'), '.nth().click() 也应触发高亮');

  await browser.close();

  console.log('\n✅ highlight: 录制高亮 / 回放高亮 / 不污染录制 全部通过');
  console.log('   截图:', path.join(DOCS_DIR, 'highlight-recording.png'));
  console.log('   截图:', path.join(DOCS_DIR, 'highlight-playback.png'));
})().catch((err) => {
  console.error('\n❌ highlight 自检失败:', err.message);
  process.exit(1);
});
