'use strict';

const fs = require('fs');
const path = require('path');
const installRecorder = require('./injected');
const installHighlight = require('./highlight-client');
const generateSpec = require('./CodeGenerator');
const renderSupportFile = require('./playback-highlight');
const { SUPPORT_FILENAME } = require('./playback-highlight');
const normalizeUrl = require('./url');

/** 上一次导航（例如失败留下的错误页）还没收尾，导致本次导航被"打断"——可重试 */
const isNavigationInterrupted = (err) => {
  const m = String((err && err.message) || '');
  return m.includes('interrupted by another navigation') || m.includes('ERR_ABORTED');
};

class Recorder {
  constructor(page, options = {}) {
    this.page = page;
    this.options = Object.assign(
      { title: 'recorded flow', outputFile: null, onAction: null, highlight: true },
      options,
    );
    this.actions = [];
    this.recording = false;
    this._attached = false;
  }

  async attach() {
    if (this._attached) return;
    this._attached = true;

    // 页面 → Node 事件桥
    await this.page.exposeFunction('__pwRecorderEmit', (evt) => this._onEvent(evt));

    // 每次新文档都注入
    await this.page.addInitScript(installRecorder);
    // 高亮客户端单独注入：即使它出问题也不会影响录制本身
    if (this.options.highlight) await this.page.addInitScript(installHighlight);
    await this._injectCurrent();

    // 导航/刷新后自动恢复开关状态
    this.page.on('load', async () => {
      await this._injectCurrent();
      if (this.recording) {
        await this.page
          .evaluate(() => window.__pwRecorderSetEnabled?.(true))
          .catch(() => {});
      }
    });
  }

  async _injectCurrent() {
    try { await this.page.evaluate(installRecorder); } catch { /* 页面尚未就绪 */ }
    if (this.options.highlight) {
      try { await this.page.evaluate(installHighlight); } catch { /* 页面尚未就绪 */ }
    }
  }

  /**
   * 显式跳转（--url 首跳、终端 goto 命令都走这里）。
   * 只有导航成功才记 goto：失败时不该在动作列表里留一条打不开的地址。
   *
   * 上一次导航失败会留下 chrome-error 页，其收尾会"打断"紧随其后的导航，
   * 而且这种打断是级联的（被打断的那次自己又成为下一次的打断者）。
   * 所以对"被打断"要带间隔重试，直到导航真正落地。
   * 连不上 / 超时这类真错误则立即抛出，不做无谓重试。
   */
  async navigate(url, options = {}) {
    // 用户随手写的 www.baidu.com / localhost:3000 也要能用
    const target = normalizeUrl(url);
    if (target !== url) console.log(`[rec] 地址补全：${url} → ${target}`);

    const opts = {
      waitUntil: options.waitUntil || 'domcontentloaded',
      ...(options.timeout ? { timeout: options.timeout } : {}),
    };
    const maxAttempts = options.attempts || 4;
    let lastErr;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) await this.page.waitForTimeout(150 * attempt);
      try {
        await this.page.goto(target, opts);
        // 记的是实际访问的地址，否则回放的脚本跑到一半就打不开
        this.actions.push({ type: 'goto', url: target });
        return target;
      } catch (err) {
        lastErr = err;
        if (!isNavigationInterrupted(err)) throw err;
      }
    }
    throw lastErr;
  }

  async start(url) {
    await this.attach();
    if (url) {
      try {
        await this.navigate(url);
      } catch (err) {
        // 失败后把页面落到干净文档，别让 chrome-error 残页留在用户眼前
        await this.page.goto('about:blank').catch(() => {});
        throw err;
      }
    }
    await this._injectCurrent();
    await this.page.evaluate(() => window.__pwRecorderSetEnabled(true));
    this.recording = true;
  }

  async stop() {
    this.recording = false;
    await this.page.evaluate(() => window.__pwRecorderSetEnabled(false)).catch(() => {});
  }

  async resume() {
    this.recording = true;
    await this.page.evaluate(() => window.__pwRecorderSetEnabled(true)).catch(() => {});
  }

  reset() { this.actions = []; }

  _sameTarget(a, b) {
    if (!a || !b) return false;
    return a.tagPath === b.tagPath && a.testId === b.testId
      && a.ariaLabel === b.ariaLabel && a.id === b.id;
  }

  /**
   * 浏览器在 dblclick 之前必定先派发两次 click，官方 codegen 只记 dblclick。
   * 这两次 click 必须丢掉：在 TodoMVC 这类"点标题即切换完成状态"的页面上，
   * 回放时会先把条目切两次，语义直接变掉。
   */
  _dropClicksBeforeDblclick(evt) {
    let dropped = 0;
    while (dropped < 2 && this.actions.length) {
      const last = this.actions[this.actions.length - 1];
      if (last.type !== 'click' || !this._sameTarget(last.target, evt.target)) break;
      this.actions.pop();
      dropped++;
    }
    return dropped;
  }

  _onEvent(evt) {
    if (!this.recording) return;

    if (evt.type === 'dblclick') this._dropClicksBeforeDblclick(evt);

    // 连续重复的 hover 只保留一次（页面重渲染会重置去重状态，这里兜底）
    const last = this.actions[this.actions.length - 1];
    if (evt.type === 'hover' && last && last.type === 'hover' && this._sameTarget(last.target, evt.target)) {
      return;
    }

    this.actions.push(evt);
    if (typeof this.options.onAction === 'function') {
      try { this.options.onAction(evt, this.actions); } catch {}
    }
  }

  generate() {
    return generateSpec(this.actions, {
      title: this.options.title,
      highlight: this.options.highlight,
    });
  }

  async export(filePath) {
    const out = filePath || this.options.outputFile;
    if (!out) throw new Error('[Recorder] outputFile is not set');
    await fs.promises.mkdir(path.dirname(out), { recursive: true });
    await fs.promises.writeFile(out, this.generate(), 'utf8');

    // 回放高亮的支持文件与 spec 放在同一目录，spec 用 ./_pw-highlight 引用
    if (this.options.highlight) {
      await fs.promises.writeFile(
        path.join(path.dirname(out), SUPPORT_FILENAME),
        renderSupportFile(),
        'utf8',
      );
    }
    return path.resolve(out);
  }
}

module.exports = Recorder;
