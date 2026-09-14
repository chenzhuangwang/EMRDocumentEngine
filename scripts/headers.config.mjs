// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// headers.config.mjs — 文件头工具链的唯一真源
//
// apply-headers.mjs 与 check-headers.mjs 共同 import 本文件, 保证
// 「写入什么」与「校验什么」不可能漂移。
//
// 要改版权主体 / 年份 / 许可证: 只改下面的 HOLDER / YEAR / LICENSE_ID,
// 然后跑 `npm run headers:apply -- --replace`。
// ============================================================

export const HOLDER = '陈庄旺'
export const YEAR = '2026'
export const LICENSE_ID = 'MPL-2.0'
export const LICENSE_URL = 'https://mozilla.org/MPL/2.0/'

/** LICENSE 文件必须含此串, 否则 apply 拒绝运行 (防止把 MPL 头写到 MIT 项目上) */
export const LICENSE_GUARD = 'Mozilla Public License Version 2.0'

/** 幂等哨兵: 出现在文件前 SENTINEL_SCAN_LINES 行内即视为「已有头」 */
export const SENTINEL = 'SPDX-License-Identifier:'
export const SENTINEL_SCAN_LINES = 15

/** --replace 模式用于识别既有头块的首行前缀 */
export const COPYRIGHT_PREFIX = 'Copyright (c)'

// ------------------------------------------------------------
// 通知正文 — MPL-2.0 Exhibit A 逐字不改 (只替换年份 / 主体 / URL)
// ------------------------------------------------------------

const NOTICE_BODY = Object.freeze([
  `Copyright (c) ${YEAR} ${HOLDER}.`,
  'This Source Code Form is subject to the terms of the Mozilla Public',
  'License, v. 2.0. If a copy of the MPL was not distributed with this',
  `file, You can obtain one at ${LICENSE_URL}.`,
  `SPDX-License-Identifier: ${LICENSE_ID}`,
])

/** 行注释族: 每行加 `prefix `, 末尾留一个空行 */
function lineComment(prefix) {
  return NOTICE_BODY.map((l) => `${prefix} ${l}`).join('\n') + '\n\n'
}

/** 块注释族: open / inner / close, 末尾留一个空行 */
function blockComment(open, inner, close) {
  return [open, ...NOTICE_BODY.map((l) => `${inner}${l}`), close, '', ''].join('\n')
}

export const FAMILIES = Object.freeze({
  slash: lineComment('//'),
  dashdash: lineComment('--'),
  hash: lineComment('#'),
  block: blockComment('/*', ' * ', ' */'),
  html: blockComment('<!--', '  ', '-->'),
  xml: blockComment('<!--', '  ', '-->'),
})

// ------------------------------------------------------------
// 自我校验: 头文本不得包含会让 ContractCompliance.test.ts 误判的串
//
// 该测试的 stripComments() 只剥离块注释与行注释, 而 §6.1 检查会扫描
// DocumentModel.ts 的「含注释」原文。头文本一旦含有这些串, 就会让
// 强制契约门禁产生假阳性。
// ------------------------------------------------------------

const FORBIDDEN_IN_HEADER = Object.freeze([
  'children: string[]',
  'interface WatermarkConfig',
  'document.',
  'window.',
])

for (const [name, text] of Object.entries(FAMILIES)) {
  for (const bad of FORBIDDEN_IN_HEADER) {
    if (text.includes(bad)) {
      throw new Error(`headers.config.mjs: family "${name}" 的头文本含有禁用串 "${bad}"`)
    }
  }
}

// ------------------------------------------------------------
// 文件 → family 解析
// ------------------------------------------------------------

/** 精确路径白名单: 优先于扩展名排除 (JSONC 的 tsconfig 用 // 注释) */
export const PATH_TO_FAMILY = Object.freeze({
  'frontend/tsconfig.json': 'slash',
  'frontend/tsconfig.node.json': 'slash',
})

export const EXT_TO_FAMILY = Object.freeze({
  '.ts': 'slash',
  '.tsx': 'slash',
  '.js': 'slash',
  '.jsx': 'slash',
  '.mjs': 'slash',
  '.cjs': 'slash',
  '.java': 'block',
  '.css': 'block',
  '.sql': 'dashdash',
  '.yml': 'hash',
  '.yaml': 'hash',
  '.conf': 'hash',
  '.html': 'html',
  '.htm': 'html',
  '.xml': 'xml',
})

/** 无扩展名或扩展名不可靠的文件, 按 basename 判定 */
export const NAME_TO_FAMILY = Object.freeze({
  Dockerfile: 'hash',
  '.dockerignore': 'hash',
  'pre-push': 'hash',
})

export const EXCLUDE_PATH_PREFIXES = Object.freeze([
  '.claude/',        // 含强制性 AI_EDITOR_CONTRACT.md, 非分发源码
  '.super-dev/',     // 流水线状态
  'output/',         // 产品文档
  'knowledge/',      // 知识库 / 营销稿
  'node_modules/',
  'frontend/node_modules/',
  'frontend/dist/',
  'backend/target/',
])

export const EXCLUDE_EXACT_PATHS = Object.freeze(new Set([
  'LICENSE',
  'NOTICE',
  'IP-POLICY.md',
  '.gitignore',
  '.gitattributes',
  'package.json',                          // 根 manifest (JSON 不能写注释)
  'package-lock.json',
  'frontend/package.json',                 // 改用 license/author 字段
  'frontend/package-lock.json',            // npm 自动重写
  'frontend/src/mocks/admissionRecord.json', // 序列化引擎文档产物, 加键会改变 MOCK_DOCUMENTS 行为
  'frontend/src/vite-env.d.ts',            // Vite 脚手架单行文件
]))

export const EXCLUDE_EXTENSIONS = Object.freeze(new Set([
  '.md', '.markdown', '.txt',              // 散文文档, 通知由 README + NOTICE 承载
  '.json', '.lock',                        // 见 PATH_TO_FAMILY 白名单
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.class', '.jar', '.war',
]))

/**
 * 解析某仓库相对路径应使用的头 family。
 * @param {string} rel 仓库相对路径, 正斜杠分隔
 * @returns {string|null} family 名, 或 null 表示不在范围内
 */
export function resolveFamily(rel) {
  const posix = rel.replace(/\\/g, '/')

  // 1. 精确白名单优先 (先于扩展名排除)
  if (Object.hasOwn(PATH_TO_FAMILY, posix)) return PATH_TO_FAMILY[posix]
  if (EXCLUDE_EXACT_PATHS.has(posix)) return null

  // 2. 目录前缀排除
  for (const prefix of EXCLUDE_PATH_PREFIXES) {
    if (posix.startsWith(prefix)) return null
  }

  // 3. 扩展名 (只看 basename, 避免目录名里的点造成误判)
  const base = posix.slice(posix.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : ''
  if (ext && EXCLUDE_EXTENSIONS.has(ext)) return null
  if (ext && Object.hasOwn(EXT_TO_FAMILY, ext)) return EXT_TO_FAMILY[ext]

  // 4. basename
  if (Object.hasOwn(NAME_TO_FAMILY, base)) return NAME_TO_FAMILY[base]

  return null
}
