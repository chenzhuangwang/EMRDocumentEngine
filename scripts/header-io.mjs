// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// header-io.mjs — 文件头工具链的共享 IO 与探测逻辑
//
// apply-headers.mjs 与 check-headers.mjs 都从这里取文件枚举与
// 「是否已有头」的判定, 保证写入与校验用同一套规则。
//
// 所有插入都是「只前插, 不改写既有字节」, 因此 BOM / 行尾 /
// 末尾换行 / 编码均原样保留。
// ============================================================

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { COPYRIGHT_PREFIX, FAMILIES, SENTINEL, SENTINEL_SCAN_LINES } from './headers.config.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** 仓库根 (scripts/ 的上一级) */
export const REPO_ROOT = path.resolve(HERE, '..')

// 写成转义序列, 不写字面不可见字符: 字面 BOM 在 review 中不可见,
// 会被某些格式化器静默剥离, 且让 grep / diff 失效。
const BOM = '\uFEFF'

/**
 * 枚举全部已跟踪文件。
 * 必须用 -z 并按 \0 切分: 仓库有 8 个中文+空格路径 (knowledge/每日推文/…),
 * 非 -z 输出会被 core.quotepath 转义成不可用形式。
 */
export function listTrackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return out.split('\0').filter((s) => s.length > 0)
}

export function readText(abs) {
  return readFileSync(abs, 'utf8')
}

export function writeText(abs, text) {
  writeFileSync(abs, text, 'utf8')
}

/** 文件是否已有许可证头 (哨兵出现在前 SENTINEL_SCAN_LINES 行内) */
export function hasHeader(text) {
  return text.split(/\r?\n/, SENTINEL_SCAN_LINES).some((line) => line.includes(SENTINEL))
}

/** 探测文件主行尾: 看第一个 \n 前面是不是 \r */
export function detectEol(text) {
  const nl = text.indexOf('\n')
  return nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n'
}

/**
 * 计算头应当插入的字符偏移。四种情况必须让位给文件首行的「不可前置于注释的声明」:
 *   BOM        → 插到 BOM 之后
 *   #!         → shebang 必须是首行 (仓库仅 pre-push 一个)
 *   <?xml      → XML 声明必须是字节 0, 注释在前是非法 XML (backend/pom.xml)
 *   <!doctype  → 插到 doctype 之后 (frontend/index.html)
 * 三斜线指令 (///) 之上插入是合法的, 故无需特殊处理。
 * 其余一律插到偏移 0。
 */
export function detectInsertOffset(text) {
  const offset = text.startsWith(BOM) ? 1 : 0
  const rest = text.slice(offset)
  const nl = rest.indexOf('\n')
  const firstLine = (nl === -1 ? rest : rest.slice(0, nl)).replace(/\r$/, '')
  const afterFirstLine = offset + (nl === -1 ? rest.length : nl + 1)

  if (firstLine.startsWith('#!')) return afterFirstLine
  if (firstLine.startsWith('<?xml')) return afterFirstLine
  if (/^<!doctype\s+html/i.test(firstLine)) return afterFirstLine
  return offset
}

/** 渲染某 family 的头文本, 并按目标文件的行尾拼接 */
export function renderHeader(family, eol) {
  const template = FAMILIES[family]
  if (template === undefined) throw new Error(`未知 family: ${family}`)
  return eol === '\n' ? template : template.replace(/\n/g, eol)
}

/**
 * 三种注释形态的匹配: 块注释 / HTML-XML 注释 / 连续行注释。
 * 行注释那一条的贪婪 `+` 会在第一个空行处停下 —— 头模板本身以空行结尾,
 * 所以不会连后面的装饰性 banner (`// ====`) 一起吃掉。
 */
const HEADER_BLOCK_PATTERNS = [
  /^\/\*[\s\S]*?\*\//,
  /^<!--[\s\S]*?-->/,
  /^(?:[ \t]*(?:\/\/|--|#)[^\n]*\r?\n)+/,
]

/**
 * 从 body (已切掉 BOM/插入点之前的字节) 中找出既有头块的完整文本。
 * 必须同时含版权行与哨兵, 否则不认 (避免误删文件本身的说明注释)。
 * @returns {string|null} 含尾随空行的头块, 找不到返回 null
 */
export function findHeaderBlock(body) {
  for (const pattern of HEADER_BLOCK_PATTERNS) {
    const m = body.match(pattern)
    if (!m) continue
    if (!m[0].includes(COPYRIGHT_PREFIX) || !m[0].includes(SENTINEL)) continue

    // 吃掉紧随其后的空行, 否则替换后会残留多余空行
    let end = m[0].length
    while (end < body.length && (body[end] === '\n' || body[end] === '\r')) end += 1
    return body.slice(0, end)
  }
  return null
}
