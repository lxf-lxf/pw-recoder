// @ts-check
'use strict';

/**
 * 专门跑「浏览器 Agent 导出的脚本」的配置。
 *
 * 单独分一个 testDir 的原因：这些脚本里写的是本次录制用的临时地址
 * （http://127.0.0.1:<随机端口>），跑完那个服务就没了。
 * 放进默认的 `npm test` 里会让日常回归莫名其妙地失败。
 *
 *   npx playwright test --config playwright.generated.config.js
 */
const { defineConfig, devices } = require('@playwright/test');

require('./src/browserPath')();

module.exports = defineConfig({
  testDir: './tests/generated',
  fullyParallel: false,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
  },
});
