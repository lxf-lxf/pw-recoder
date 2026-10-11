#!/usr/bin/env node
'use strict';

/**
 * 把浏览器 Agent 打包成单个 IIFE：dist/pw-agent.js
 *
 * 不引第三方打包器：模块图很小，只需要把相对 require 解析成模块 id 再套一层
 * CommonJS 壳。外部依赖（@playwright/test 之类）一律禁用——浏览器包里不该有。
 *
 *   node scripts/build-agent.js          生成 dist/pw-agent.js 和 extension/pw-agent.js
 *   node scripts/build-agent.js --check  只校验 dist 是否与源码一致（CI 用，不一致则退出码 1）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = 'src/agent/agent.js';
const OUT_DIST = path.join(ROOT, 'dist', 'pw-agent.js');
const OUT_EXT = path.join(ROOT, 'extension', 'pw-agent.js');

const VERSION = require(path.join(ROOT, 'package.json')).version;

const idOf = (rel) => rel.split(path.sep).join('/');

function resolveRequire(fromId, req) {
  if (req[0] !== '.') {
    throw new Error(`浏览器包不能用外部依赖：${fromId} → require('${req}')`);
  }
  let target = path.posix.normalize(path.posix.join(path.posix.dirname(fromId), req));
  const abs = path.join(ROOT, target);
  // 目录 → index.js（和 Node 的解析保持一致）
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    return target.replace(/\/+$/, '') + '/index.js';
  }
  if (!path.posix.extname(target)) target += '.js';
  return target;
}

/**
 * 把源码里真正的 require('./x') 换成 __require('<id>')。
 *
 * 必须能区分字符串、注释、正则：CodeGenerator 里有一段"生成出来的代码模板"，
 * 里面写着 require('@playwright/test') —— 那是输出给用户的文本，不是本包的依赖；
 * 而 escapeStr 里的 /'/g 这种正则如果被当成字符串，扫描就会错位。
 * 模板字符串里的 ${} 按字符串整体处理（本项目没有在 ${} 里 require 的写法）。
 */

/** 上一个有效字符决定 `/` 是除号还是正则起始 */
const REGEX_OK = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>', '\n']);

/** i 指向 '/'，返回正则字面量结束后的下标 */
function scanRegex(src, i) {
  let j = i + 1;
  let inClass = false;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '\\') { j += 2; continue; }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) { j++; break; }
    else if (ch === '\n') return i + 1;   // 不合法，当作普通字符
    j++;
  }
  while (j < src.length && /[a-z]/i.test(src[j])) j++;   // 修饰符
  return j;
}

function rewriteRequires(src, onDep) {
  let out = '';
  let i = 0;
  let prevSig = '';
  const n = src.length;

  const emit = (text, sig) => {
    out += text;
    if (sig !== undefined) { prevSig = sig; return; }
    for (let k = text.length - 1; k >= 0; k--) {
      if (!/\s/.test(text[k])) { prevSig = text[k]; return; }
    }
  };

  while (i < n) {
    const c = src[i];

    // 注释（注释不改变"上一个有效字符"）
    if (c === '/' && src[i + 1] === '/') {
      const j = src.indexOf('\n', i);
      const end = j < 0 ? n : j;
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      const end = j < 0 ? n : j + 2;
      out += src.slice(i, end);
      i = end;
      continue;
    }
    // 正则字面量（结果是一个值，所以后面跟 '/' 应视为除号）
    if (c === '/' && REGEX_OK.has(prevSig)) {
      const end = scanRegex(src, i);
      emit(src.slice(i, end), ')');
      i = end;
      continue;
    }
    // 字符串 / 模板字符串
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) { j++; break; }
        j++;
      }
      emit(src.slice(i, j), ')');
      i = j;
      continue;
    }
    // 真正的 require(...)
    if (src.startsWith('require', i) && !/[A-Za-z0-9_$.]/.test(src[i - 1] || '')) {
      const m = /^require\(\s*(['"])([^'"]+)\1\s*\)/.exec(src.slice(i));
      if (m) {
        emit('__require(' + JSON.stringify(onDep(m[2])) + ')', ')');
        i += m[0].length;
        continue;
      }
    }

    emit(c);
    i++;
  }
  return out;
}

/** 从入口开始收集模块图，并把相对 require 重写成模块 id */
function collectModules() {
  const modules = new Map();
  const queue = [ENTRY];

  while (queue.length) {
    const id = queue.shift();
    if (modules.has(id)) continue;

    const abs = path.join(ROOT, id);
    if (!fs.existsSync(abs)) throw new Error(`模块不存在：${id}`);

    const raw = fs.readFileSync(abs, 'utf8');
    const src = rewriteRequires(raw, (req) => {
      const dep = resolveRequire(id, req);
      if (!modules.has(dep) && queue.indexOf(dep) < 0) queue.push(dep);
      return dep;
    });

    modules.set(id, src);
  }
  return modules;
}

function bundle() {
  const modules = collectModules();
  const ids = Array.from(modules.keys()).sort();

  const parts = [];
  parts.push(`/*! pw-recorder v${VERSION} browser agent | 由 scripts/build-agent.js 生成，请勿手改 */`);
  parts.push('(function (global) {');
  parts.push("  'use strict';");
  parts.push('  var __modules = {};');
  parts.push('  var __cache = {};');
  parts.push('  function __require(id) {');
  parts.push('    if (__cache[id]) return __cache[id].exports;');
  parts.push('    var module = { exports: {} };');
  parts.push('    __cache[id] = module;');
  parts.push('    __modules[id](module, module.exports, __require);');
  parts.push('    return module.exports;');
  parts.push('  }');
  for (const id of ids) {
    parts.push(`  __modules[${JSON.stringify(id)}] = function (module, exports, __require) {`);
    parts.push(modules.get(id).replace(/\s+$/, ''));
    parts.push('  };');
  }
  parts.push(`  var agent = __require(${JSON.stringify(ENTRY)});`);
  parts.push('  global.PWAgent = agent;');
  parts.push("  if (typeof document !== 'undefined') agent.autoInit();");
  parts.push("})(typeof globalThis !== 'undefined' ? globalThis : this);");
  parts.push('');

  return { code: parts.join('\n'), modules: ids };
}

function main() {
  const check = process.argv.indexOf('--check') >= 0;
  const { code, modules } = bundle();
  const kb = (Buffer.byteLength(code, 'utf8') / 1024).toFixed(1);

  if (check) {
    const current = fs.existsSync(OUT_DIST) ? fs.readFileSync(OUT_DIST, 'utf8') : null;
    if (current !== code) {
      console.error('❌ dist/pw-agent.js 与源码不一致，请运行 npm run build:agent');
      process.exit(1);
    }
    console.log(`✅ dist/pw-agent.js 是最新的（${kb} KB，${modules.length} 个模块）`);
    return;
  }

  fs.mkdirSync(path.dirname(OUT_DIST), { recursive: true });
  fs.writeFileSync(OUT_DIST, code, 'utf8');

  // 扩展需要一个位于自己目录内的 bundle（MV3 不允许加载目录外的脚本）
  if (fs.existsSync(path.dirname(OUT_EXT))) {
    fs.writeFileSync(OUT_EXT, code, 'utf8');
  }

  console.log(`✅ 打包完成 dist/pw-agent.js（${kb} KB）`);
  console.log(`   模块: ${modules.map(idOf).join(', ')}`);
}

if (require.main === module) main();

module.exports = { bundle, collectModules };
