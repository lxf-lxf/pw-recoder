#!/usr/bin/env node
'use strict';

/**
 * 真实站点录制：无头浏览器 + 一个 driver 文件扮演用户操作，
 * 录制结果导出成 .spec.js，随后可用 `npm run live:replay` 回放验证。
 *
 * 用法:
 *   node scripts/record-live.js --url <url> --driver <driver.js> [--output <spec.js>] [--title <name>] [--verify]
 *
 * driver 文件需导出 async (page) => {}，例如 scripts/live/todomvc.js。
 * 若 driver 额外导出了 snapshot(page)，加 --verify 会再生成一份带终态断言的
 * `<name>.verify.spec.js`：先不录制跑一遍取终态，回放录制脚本后再比对，
 * 用来证明录下来的动作语义和手工操作一致（光"回放不报错"证明不了这点）。
 *
 * 想录有交互的流程却不想写 driver，就直接用 `npm run record`（有头窗口手工操作）。
 */

const path = require('path');

const useLocalBrowsers = require('../src/browserPath');
useLocalBrowsers();

const { chromium } = require('@playwright/test');
const Recorder = require('../src/Recorder');
const { actionToCode } = require('../src/CodeGenerator');
const fs = require('fs');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    out[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

/** 用同一批动作 + 终态断言，生成一份可独立运行的校验脚本 */
function buildVerifySpec(actions, title, snapshotFn, expected) {
  const lines = [];
  lines.push("const { test, expect } = require('@playwright/test');");
  lines.push('');
  lines.push(`const snapshot = ${snapshotFn.toString()};`);
  lines.push('');
  lines.push(`test('[verify] ${title}', async ({ page }) => {`);
  for (const a of actions) {
    const code = actionToCode(a);
    if (code) lines.push('  ' + code);
  }
  const expectedJson = JSON.stringify(expected, null, 2).split('\n').join('\n  ');
  lines.push(`  expect(await snapshot(page)).toEqual(${expectedJson});`);
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.url !== 'string' || typeof args.driver !== 'string') {
    console.error('用法: node scripts/record-live.js --url <url> --driver <driver.js> [--output <spec.js>] [--title <name>]');
    process.exit(1);
  }

  const driverPath = path.resolve(args.driver);
  const run = require(driverPath);
  if (typeof run !== 'function') {
    console.error(`[error] driver 必须导出一个 async (page) => {} 函数: ${driverPath}`);
    process.exit(1);
  }

  const title = typeof args.title === 'string' ? args.title : path.basename(driverPath, '.js');
  const output = typeof args.output === 'string'
    ? path.resolve(args.output)
    : path.resolve('tests/recorded', `${path.basename(driverPath, '.js')}.spec.js`);

  const browser = await chromium.launch();

  // 需要校验时，先在干净页面里"不录制"跑一遍，取用户操作后的终态。
  // browser.newPage() 每次都是全新 context，localStorage / 登录态不会串。
  let expected = null;
  if (args.verify === true) {
    if (typeof run.snapshot !== 'function') {
      console.warn('[warn] --verify 需要 driver 导出 snapshot(page)，已跳过终态校验');
    } else {
      const probe = await browser.newPage();
      await probe.goto(args.url, { waitUntil: 'domcontentloaded' });
      await run(probe);
      expected = await run.snapshot(probe);
      await probe.close();
      console.log('基准终态:', JSON.stringify(expected));
    }
  }

  const page = await browser.newPage();

  const recorder = new Recorder(page, {
    title,
    outputFile: output,
    highlight: args['no-highlight'] !== true,
  });
  await recorder.start(args.url);

  try {
    await run(page);
  } catch (err) {
    console.error('[driver error]', err.message);
    await browser.close();
    process.exit(1);
  }

  await page.waitForTimeout(800);   // 等 fill 的防抖落地
  await recorder.stop();

  const out = await recorder.export();
  await browser.close();

  console.log(`已录制 ${recorder.actions.length} 个动作 -> ${out}`);
  console.log('动作序列:', recorder.actions.map((a) => a.type).join(', '));

  if (expected !== null) {
    const verifyFile = out.replace(/\.spec\.js$/, '.verify.spec.js');
    fs.writeFileSync(verifyFile, buildVerifySpec(recorder.actions, title, run.snapshot, expected), 'utf8');
    console.log(`已生成终态校验脚本 -> ${verifyFile}`);
    console.log(`用这条命令回放并断言终态: npx playwright test ${path.relative(process.cwd(), verifyFile)}`);
  }
})();
