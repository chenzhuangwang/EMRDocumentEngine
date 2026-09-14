// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// apply-headers.mjs — 批量写入 MPL-2.0 文件头
//
// 用法:
//   node scripts/apply-headers.mjs              写入 (幂等)
//   node scripts/apply-headers.mjs --dry-run    只打印计划, 不落盘
//   node scripts/apply-headers.mjs --replace    改写既有头块 (换主体/年份用)
//
// 只前插, 不改写既有字节 —— BOM / 行尾 / 末尾换行均原样保留。
// ============================================================

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { LICENSE_GUARD, LICENSE_ID, resolveFamily } from './headers.config.mjs'
import {
  REPO_ROOT,
  detectEol,
  detectInsertOffset,
  findHeaderBlock,
  hasHeader,
  listTrackedFiles,
  readText,
  renderHeader,
  writeText,
} from './header-io.mjs'

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')
const REPLACE = args.has('--replace')

// ---- 护栏: LICENSE 必须是 MPL-2.0, 否则拒绝写入 ----
// 这是防止把 MPL 文件头写到 MIT (或其他协议) 项目上的保险。
let licenseText
try {
  licenseText = readFileSync(path.join(REPO_ROOT, 'LICENSE'), 'utf8')
} catch {
  console.error('✖ 找不到 LICENSE 文件, 拒绝写入文件头。')
  process.exit(2)
}
if (!licenseText.includes(LICENSE_GUARD)) {
  console.error(`✖ LICENSE 不含 "${LICENSE_GUARD}", 拒绝写入 ${LICENSE_ID} 文件头。`)
  console.error('  请先统一许可证, 再运行本脚本。')
  process.exit(2)
}

const stats = { written: 0, skipped: 0, replaced: 0, outOfScope: 0, failed: 0 }

for (const rel of listTrackedFiles()) {
  const family = resolveFamily(rel)
  if (!family) {
    stats.outOfScope += 1
    continue
  }

  const abs = path.join(REPO_ROOT, rel)
  let text
  try {
    text = readText(abs)
  } catch (err) {
    console.error(`✖ 读取失败 ${rel}: ${err.message}`)
    stats.failed += 1
    continue
  }

  const already = hasHeader(text)
  if (already && !REPLACE) {
    stats.skipped += 1
    continue
  }

  const eol = detectEol(text)
  const header = renderHeader(family, eol)
  const offset = detectInsertOffset(text)

  let next
  let action
  if (already) {
    const body = text.slice(offset)
    const block = findHeaderBlock(body)
    if (!block) {
      console.error(`✖ ${rel}: --replace 找不到既有头块的边界, 已跳过 (需手工检查)`)
      stats.failed += 1
      continue
    }
    next = text.slice(0, offset) + header + body.slice(block.length)
    action = 'replaced'
  } else {
    next = text.slice(0, offset) + header + text.slice(offset)
    action = 'written'
  }

  if (DRY_RUN) {
    console.log(`  [${action}] ${rel}`)
  } else {
    try {
      writeText(abs, next)
    } catch (err) {
      console.error(`✖ 写入失败 ${rel}: ${err.message}`)
      stats.failed += 1
      continue
    }
  }

  if (action === 'replaced') stats.replaced += 1
  else stats.written += 1
}

console.log('')
console.log(DRY_RUN ? '文件头计划 (--dry-run, 未落盘)' : '文件头写入完成')
console.log(`  新写入   ${stats.written}`)
console.log(REPLACE ? `  已替换   ${stats.replaced}` : `  已存在   ${stats.skipped}`)
console.log(`  不在范围 ${stats.outOfScope}`)
if (stats.failed) console.log(`  失败     ${stats.failed}`)
console.log('')

process.exit(stats.failed ? 1 : 0)
