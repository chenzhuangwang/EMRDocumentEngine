// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// check-headers.mjs — 文件头校验 (CI 门禁)
//
// 只读。对每个在范围内的已跟踪文件断言其前 SENTINEL_SCAN_LINES 行内
// 含 SPDX 哨兵; 任一缺失则 exit 1。
//
// 与 apply-headers.mjs 共用 headers.config.mjs 与 header-io.mjs,
// 因此「校验什么」必然等于「写入什么」。
// ============================================================

import path from 'node:path'
import process from 'node:process'

import { LICENSE_ID, SENTINEL, resolveFamily } from './headers.config.mjs'
import { REPO_ROOT, hasHeader, listTrackedFiles, readText } from './header-io.mjs'

const missing = []
let inScope = 0

for (const rel of listTrackedFiles()) {
  if (!resolveFamily(rel)) continue
  inScope += 1

  let text
  try {
    text = readText(path.join(REPO_ROOT, rel))
  } catch {
    missing.push(rel)
    continue
  }
  if (!hasHeader(text)) missing.push(rel)
}

if (missing.length === 0) {
  console.log(`✓ 文件头校验通过: 范围内 ${inScope} 个文件均含 ${SENTINEL} ${LICENSE_ID}`)
  process.exit(0)
}

console.error(`✖ 文件头校验失败: ${missing.length} / ${inScope} 个文件缺少许可证头`)
for (const rel of missing) console.error(`  ${rel}: missing license header`)
console.error('')
console.error('修复: npm run headers:apply')
process.exit(1)
