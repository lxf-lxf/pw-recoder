#!/usr/bin/env node
'use strict';

/**
 * 用 headless 浏览器"自动扮演用户"跑一遍 demo 页面，
 * 把录制结果导出成 tests/recorded/demo.spec.js。
 *
 * 配合 npm run demo:replay 即可验证「录制 → 回放」闭环。
 */

const path = require('path');

const useLocalBrowsers = require('../src/browserPath');
useLocalBrowsers();

const { chromium } = require('@playwright/test');

const Recorder = require('../src/Recorder');

const OUT_FILE = path.resolve(__dirname, '../tests/recorded/demo.spec.js');
const FIXTURE = 'file://' + path.resolve(__dirname, '../tests/fixtures/demo.html');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const recorder = new Recorder(page, { title: 'demo flow', outputFile: OUT_FILE });
  await recorder.start(FIXTURE);

  await page.getByLabel('Email').fill('me@example.com');
  await page.getByLabel('Password').fill('s3cret');
  await page.locator('#plan').selectOption('pro');
  await page.locator('#remember').check();
  await page.locator('[data-testid="login-submit"]').click();
  await page.getByTestId('search').fill('hello');
  await page.getByTestId('search').press('Enter');

  await page.waitForTimeout(800);   // 等 fill 的防抖落地
  await recorder.stop();

  const out = await recorder.export();
  await browser.close();

  console.log(`已录制 ${recorder.actions.length} 个动作 -> ${out}`);
})();
