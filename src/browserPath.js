'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 受限环境（沙箱/CI）里常把浏览器装到项目内的 ./.pw-browsers。
 * 如果存在这个目录、且用户没有显式指定 PLAYWRIGHT_BROWSERS_PATH，
 * 就自动指向它，保证 `node record.js` / `npm run e2e` 开箱可跑。
 * 显式设置了环境变量的情况下一律以用户为准。
 */
function useLocalBrowsers(rootDir = path.resolve(__dirname, '..')) {
  const local = path.join(rootDir, '.pw-browsers');
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(local)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = local;
  }
  return process.env.PLAYWRIGHT_BROWSERS_PATH;
}

module.exports = useLocalBrowsers;
