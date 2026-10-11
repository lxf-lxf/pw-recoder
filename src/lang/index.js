'use strict';

/**
 * 导出语言注册表：UI 的标签页、文件名、生成函数都由这里统一提供。
 */

const generateJs = require('../CodeGenerator');
const generatePython = require('./python');
const generateJava = require('./java');
const { className } = require('./java');
const { funcName } = require('./python');

/** 标题 → 文件名用的 slug */
function slug(title) {
  const s = String(title || 'recorded flow')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'recorded-flow';
}

const LANGS = [
  {
    id: 'javascript',
    label: 'JavaScript',
    hint: 'Playwright Test',
    extension: 'js',
    comment: '//',
    filename: (title) => `${slug(title)}.spec.js`,
    generate: (actions, options) => generateJs(actions, Object.assign({}, options, {
      filename: `${slug(options && options.title)}.spec.js`,
    })),
  },
  {
    id: 'python',
    label: 'Python',
    hint: 'pytest + Playwright',
    extension: 'py',
    comment: '#',
    filename: (title) => `${funcName(title)}.py`,
    generate: (actions, options) => generatePython(actions, Object.assign({}, options, {
      filename: `${funcName(options && options.title)}.py`,
    })),
  },
  {
    id: 'java',
    label: 'Java',
    hint: 'JUnit 5 + Playwright',
    extension: 'java',
    comment: '//',
    filename: (title) => `${className(title)}.java`,
    generate: (actions, options) => generateJava(actions, options),
  },
];

function byId(id) {
  return LANGS.filter((l) => l.id === id)[0] || null;
}

module.exports = { LANGS, byId, slug };
