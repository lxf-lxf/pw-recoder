#!/usr/bin/env node
'use strict';

const path = require('path');
const readline = require('readline');

const useLocalBrowsers = require('./src/browserPath');
useLocalBrowsers();   // 必须在 launch 之前：定位项目内安装的浏览器

const { chromium } = require('@playwright/test');

const Recorder = require('./src/Recorder');
const installPanel = require('./src/panel');

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

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const url = typeof args.url === 'string' ? args.url : 'about:blank';
  const output = typeof args.output === 'string'
    ? args.output : path.resolve('tests/recorded/flow.spec.js');
  const title = typeof args.title === 'string' ? args.title : 'recorded flow';
  // 高亮默认开：录制时框出刚捕获的操作，导出的 spec 回放时也框
  const highlight = args['no-highlight'] !== true;

  // 默认开有头窗口（录制就是要看页面）；--headless / PW_RECORDER_HEADLESS=1 用于 CI 自检
  const headless = args.headless === true || process.env.PW_RECORDER_HEADLESS === '1';

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  const recorder = new Recorder(page, {
    title, outputFile: output, highlight,
    onAction: (_evt, list) => {
      page.evaluate((n) => window.__pwRecorderSetCount?.(n), list.length).catch(() => {});
    },
  });

  await page.addInitScript(installPanel);

  // 节点 → 页面：把权威的录制状态推给面板（终端控制 / 跳转后重建 DOM 时保持一致）
  const syncPanel = () =>
    page
      .evaluate((on) => window.__pwRecorderSetState?.(on), recorder.recording)
      .catch(() => {});

  // 暴露给面板的三个回调
  await page.exposeFunction('__pwRecorderToggle', async (v) => {
    v ? await recorder.resume() : await recorder.stop();
    await syncPanel();
    console.log(`[rec] ${v ? '▶ recording' : '⏸ paused'} (${recorder.actions.length})`);
  });
  await page.exposeFunction('__pwRecorderSave', async () => {
    await recorder.stop();
    await syncPanel();
    const f = await recorder.export();
    console.log(`[rec] 💾 saved -> ${f}`);
    return f;
  });
  await page.exposeFunction('__pwRecorderReset', () => { recorder.reset(); console.log('[rec] cleared'); });

  // 首跳失败（服务没起、端口写错）不该让整个录制器崩掉：
  // 浏览器和录制器都保持就绪，等用户把服务拉起来后再 `goto <url>`。
  let startFailed = false;
  try {
    await recorder.start(url);
  } catch (err) {
    startFailed = true;
    const reason = String(err && err.message ? err.message : err).split('\n')[0];
    console.error(`
⚠️  打开 ${url} 失败：${reason}

   常见原因：目标服务还没启动、端口不对、或地址写错。
   浏览器窗口和录制器都保持就绪，你的服务起来之后在下面输入：
       goto <正确的地址>
   就会导航过去并开始录制。
`);
  }

  await page.evaluate(installPanel).catch(() => {});

  // 每次新文档后面板都是全新的 DOM，需要重新对齐状态与计数
  page.on('load', async () => {
    await syncPanel();
    await page.evaluate((n) => window.__pwRecorderSetCount?.(n), recorder.actions.length).catch(() => {});
  });
  await syncPanel();

  console.log(`
🎬  Playwright Recorder ${startFailed ? '已就绪（尚未打开页面）' : '已启动'}
   页面右下角悬浮面板：Pause / Save / Reset
   操作高亮：${highlight ? '开（录制时框出刚捕获的操作，导出的脚本回放时也框）' : '关'}
   终端命令：
     goto <url>  导航到指定地址并开始录制
     start       继续录制
     stop        暂停录制
     save        导出 .spec.js
     list        查看已录动作
     reset       清空
     quit        退出
`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'rec> ' });
  rl.prompt();

  async function handle(cmd) {
    if (cmd.startsWith('goto ')) {
      const target = cmd.slice('goto '.length).trim();
      const effective = await recorder.navigate(target);
      if (!recorder.recording) await recorder.resume();
      await page.evaluate(installPanel).catch(() => {});
      await syncPanel();
      console.log(`→ ${effective}（已记录 goto，继续录制）`);
    } else if (cmd === 'start') { await recorder.resume(); await syncPanel(); console.log('▶ recording'); }
    else if (cmd === 'stop') { await recorder.stop(); await syncPanel(); console.log('⏸ paused'); }
    else if (cmd === 'save') { console.log('💾 ->', await recorder.export()); }
    else if (cmd === 'reset') { recorder.reset(); console.log('cleared'); }
    else if (cmd === 'list') console.log(JSON.stringify(recorder.actions, null, 2));
    else if (cmd === 'quit' || cmd === 'exit') { await browser.close(); process.exit(0); }
  }

  // readline 不会等上一个异步命令跑完就派发下一行（粘贴多行时会交错），
  // 用一条 Promise 链把命令串行化。
  let queue = Promise.resolve();
  rl.on('line', (line) => {
    const cmd = line.trim();
    if (!cmd) { rl.prompt(); return; }
    queue = queue
      .then(() => handle(cmd))
      .catch((e) => {
        // 例如 goto 到仍然打不开的地址：报一行原因，REPL 继续可用
        console.error('[error]', String(e && e.message ? e.message : e).split('\n')[0]);
      })
      .then(() => rl.prompt());
  });

  browser.on('disconnected', () => process.exit(0));
})().catch((err) => {
  console.error('[fatal]', String(err && err.message ? err.message : err).split('\n')[0]);
  process.exit(1);
});
