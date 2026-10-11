// @ts-check
'use strict';

/**
 * 只需要跑录出来的脚本时用这份配置：npm test
 * 录制的入口是 record.js / npm run demo，不经过这里。
 */
const { defineConfig, devices } = require('@playwright/test');

// 和 record.js 保持一致：定位项目内安装的浏览器（必须在浏览器启动前生效）
require('./src/browserPath')();

module.exports = defineConfig({
  testDir: './tests/recorded',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
  },
});
