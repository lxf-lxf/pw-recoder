'use strict';

/**
 * 把用户随手写的地址补全成合法 URL。
 *
 * Playwright 的 page.goto 只接受绝对 URL，`www.baidu.com` 这种会直接报
 * "Cannot navigate to invalid URL"。命令行工具没理由要求用户手打协议头。
 *
 * 注意 `localhost:3000` 这类写法有歧义：按 RFC 看起来像 scheme:path。
 * 判断依据是"冒号后面全是数字" → 那是端口，不是协议。
 */

const SCHEME_WITH_SLASHES = /^[a-z][a-z0-9+.-]*:\/\//i;   // http:// https:// file://
const KNOWN_SCHEME = /^(https?|file|about|data|blob|mailto|tel|chrome|view-source):/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const HOST_PORT = /^[a-z0-9][a-z0-9.-]*:\d+(\/|\?|#|$)/i;   // localhost:3000 / myapp:8080

// 本机 / 内网地址一律走 http：开发服务器基本没有证书
const PRIVATE_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?(\/|\?|#|$)/i;
const DOT_LOCAL = /^[^/]*\.local(:\d+)?(\/|\?|#|$)/i;
const BARE_HOST_PORT = /^[^/:?#]+:\d+(\/|\?|#|$)/;

function schemeFor(raw) {
  if (PRIVATE_HOST.test(raw) || DOT_LOCAL.test(raw)) return 'http';
  const host = raw.split('/')[0].split('?')[0].split('#')[0].split(':')[0];
  // myapp:8080 这种没有点的裸主机名也当内网
  if (!host.includes('.') && BARE_HOST_PORT.test(raw)) return 'http';
  return 'https';
}

function normalizeUrl(input) {
  if (typeof input !== 'string') return input;

  const raw = input.trim();
  if (!raw) return raw;

  if (SCHEME_WITH_SLASHES.test(raw)) return raw;   // http://… file://…
  if (KNOWN_SCHEME.test(raw)) return raw;          // about:blank / data:… / mailto:…
  if (raw.startsWith('//')) return 'https:' + raw;

  // host:port —— 注意必须排在 HAS_SCHEME 之前，否则 localhost:3000 会被当成协议
  if (HOST_PORT.test(raw)) return schemeFor(raw) + '://' + raw;

  // 其余自定义协议（myproto:xxx）原样放行，让 Playwright 自己判断
  if (HAS_SCHEME.test(raw)) return raw;

  return schemeFor(raw) + '://' + raw;
}

module.exports = normalizeUrl;
