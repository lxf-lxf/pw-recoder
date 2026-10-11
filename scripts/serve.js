#!/usr/bin/env node
'use strict';

/**
 * 起一个静态服务，方便手动体验 v2 浏览器 Agent：
 *
 *   npm run agent:demo
 *   → 打开 http://127.0.0.1:4173/tests/fixtures/agent-demo.html
 *
 * 页面里已经按"自己的站点"的方式引了 /dist/pw-agent.js，
 * 打开就会自动开始录制，右下角有控件，点"结束并导出"看多语言弹窗。
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 4173);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(String(req.url).split('?')[0]);
  const rel = path.normalize(url === '/' ? '/tests/fixtures/agent-demo.html' : url);
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`pw-recorder v2 demo 已启动：
  ${'http://127.0.0.1:' + PORT}/tests/fixtures/agent-demo.html   ← 第 1 页（含跨页链接）
  ${'http://127.0.0.1:' + PORT}/dist/pw-agent.js                 ← 引入用的 bundle

页面右下角是录制控件；点"结束并导出"看 JavaScript / Python / Java 三种脚本。
Ctrl+C 退出。`);
});
