// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// pack-engine.mjs — 把引擎分发包打成可安装的 tarball (契约 §32)
//
// 包根就是源码所在目录 packages/emr-document-engine (2026-10 物理剥离后),
// LICENSE / NOTICE 在仓库根 —— npm pack 只收包根之内的文件, 所以先暂存两份
// 进来, 打完再清掉。这样包根平时保持干净, tarball 里许可证又是齐的。
//
// 构建配置 (vite.config.ts / tsconfig.json) 随包走。依赖仍从 frontend/node_modules
// 借 —— 仓库刻意不发 npm workspaces, 只有一份依赖树; 见下 binJs 的说明。
//
// 用法:
//   node scripts/pack-engine.mjs                  # 输出到 dist-packages/
//   node scripts/pack-engine.mjs --out D:/somewhere
//   node scripts/pack-engine.mjs --skip-build     # 复用已有 dist
// ============================================================

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const FRONTEND = path.join(REPO_ROOT, 'frontend')
/** 包根 = 引擎源码所在目录 (契约 §32: 源码、manifest、构建配置同处一根) */
const PKG_DIR = path.join(REPO_ROOT, 'packages', 'emr-document-engine')

const argv = process.argv.slice(2)
const SKIP_BUILD = argv.includes('--skip-build')
const outIdx = argv.indexOf('--out')
const OUT_DIR = path.resolve(outIdx >= 0 ? argv[outIdx + 1] : path.join(REPO_ROOT, 'dist-packages'))

/** npm 在 Windows 上是 npm.cmd, Node 20 起 spawnSync 直接执行 .cmd 会 EINVAL,
 *  故 npm 走 shell; vite/tsc 则直接调它们的 JS 入口, 完全绕开 npm 与 .cmd。 */
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function run(cmd, args, cwd, { shell = false } = {}) {
  return execFileSync(cmd, args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], shell,
  })
}

/** 递归列出目录下所有文件的相对路径 (正斜杠) */
function walk(dir, prefix = '') {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel))
    else out.push(rel)
  }
  return out
}

/** 前端 node_modules 里某个包的 CLI 入口 JS (跨平台, 不经 .cmd)
 *
 *  为什么借用前端的那份而不是在包内装: 仓库刻意不发 npm workspaces —— 单份
 *  frontend/node_modules、无根 lockfile、无 npm install。包声明的依赖
 *  (fflate) 在开发期由前端依赖传递满足, 分发时由 tarball 的 dependencies 提供。
 */
function binJs(pkg, rel) {
  const p = path.join(FRONTEND, 'node_modules', pkg, rel)
  if (!existsSync(p)) {
    console.error(`[pack-engine] 找不到 ${p} —— 先在前端目录跑一次 npm install`)
    process.exit(1)
  }
  return p
}

// ---- 0. 前置检查 ------------------------------------------------------
{
  const manifest = path.join(PKG_DIR, 'package.json')
  if (!existsSync(manifest)) {
    console.error(`[pack-engine] 找不到 ${manifest} —— 包根应为 packages/emr-document-engine`)
    process.exit(1)
  }
}

// ---- 1. 构建 ----------------------------------------------------------
if (SKIP_BUILD) {
  if (!existsSync(path.join(PKG_DIR, 'dist', 'index.js'))) {
    console.error('[pack-engine] --skip-build 但 dist/index.js 不存在; 去掉该参数重试')
    process.exit(1)
  }
  console.log('[pack-engine] 复用已有 dist (--skip-build)')
} else {
  console.log('[pack-engine] 构建库产物 (vite lib + tsc declarations)…')
  // cwd=包根: 包内 vite.config.ts / tsconfig.json, 输出到包内 dist/
  //
  // 构建期为什么需要一个临时 node_modules 链接: 包内 vite.config.ts 会
  // `import { defineConfig } from 'vite'`, 而仓库刻意不发 npm workspaces ——
  // 包目录下没有 node_modules, Node 从包目录向上也找不到 (仓库根的
  // node_modules 是空的)。链接用完即删, 包根保持干净 (§32 "包不装 node_modules")。
  const nmLink = path.join(PKG_DIR, 'node_modules')
  let linked = false
  if (!existsSync(nmLink)) {
    symlinkSync(path.join(FRONTEND, 'node_modules'), nmLink, 'junction')
    linked = true
  }
  try {
    run(process.execPath, [binJs('vite', 'bin/vite.js'), 'build'], PKG_DIR)
    run(process.execPath, [binJs('typescript', 'bin/tsc'), '-p', 'tsconfig.json'], PKG_DIR)
  } finally {
    if (linked) rmSync(nmLink, { recursive: true, force: true })
  }
}

// ---- 2. 暂存 LICENSE / NOTICE ----------------------------------------
// 包根的 files 字段列了这两个文件; npm pack 只认包根内的路径。
const STAGED = ['LICENSE', 'NOTICE']
for (const name of STAGED) {
  const from = path.join(REPO_ROOT, name)
  if (!existsSync(from)) {
    console.error(`[pack-engine] 仓库根缺少 ${name} —— MPL-2.0 分发必须带许可证`)
    process.exit(1)
  }
  copyFileSync(from, path.join(PKG_DIR, name))
}

// ---- 3. pack ----------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true })
let tarball = ''
try {
  const out = run(
    NPM,
    ['pack', '--pack-destination', `"${OUT_DIR}"`, '--json'],
    PKG_DIR,
    { shell: true },
  )
  // npm 的 --json 输出是数组; 前面可能混有 npm notice 之类的非 JSON 行
  const start = out.indexOf('[')
  const parsed = JSON.parse(out.slice(start))
  tarball = path.join(OUT_DIR, parsed[0].filename)
  console.log(`[pack-engine] 文件名: ${parsed[0].filename}`)
  console.log(`[pack-engine] 条目数: ${parsed[0].entryCount}, 未压缩大小: ${(parsed[0].size / 1024).toFixed(1)} kB`)
} finally {
  // 无论成功失败都清掉暂存, 否则包根会永久多出两份许可证副本
  for (const name of STAGED) rmSync(path.join(PKG_DIR, name), { force: true })
}

// ---- 4. 自检: 产物必须齐全且不含别名 ---------------------------------
const dist = path.join(PKG_DIR, 'dist')
const required = ['index.js', 'index.cjs', 'dom.js', 'react.js', 'export.js']
const missing = required.filter((f) => !existsSync(path.join(dist, f)))
if (missing.length) {
  console.error(`[pack-engine] dist 缺少入口文件: ${missing.join(', ')}`)
  process.exit(1)
}
console.log(`[pack-engine] dist 入口齐全: ${required.join(', ')}`)
console.log(`[pack-engine] dist 类型: ${readdirSync(path.join(dist, 'types')).join(', ')}`)

// 契约 §32.1 的执行点: 打包产物里不得残留构建期别名说明符。
// 别名不会被 tsc 改写成相对路径, 留在 .d.ts 里外部项目直接解析不了 ——
// 而这类问题只有把产物拿给仓库外的消费方才会暴露, 所以在最后一道闸门上查。
const ALIAS_SPEC = /(?:^|[\s(])(?:import|export)[^'"\n]*from\s+['"]@\//
const aliasHits = []
for (const rel of walk(path.join(dist, 'types'))) {
  if (!rel.endsWith('.d.ts')) continue
  const text = readFileSync(path.join(dist, 'types', rel), 'utf8')
  text.split('\n').forEach((line, i) => {
    // 注释里的 @/ 是文档 (例如解释为什么不这么 import), 不是说明符
    if (/^\s*(?:\*|\/\*|\/\/)/.test(line)) return
    if (ALIAS_SPEC.test(line)) aliasHits.push(`types/${rel}:${i + 1}`)
  })
}
if (aliasHits.length) {
  console.error('[pack-engine] 产物声明里残留了 @/ 别名说明符 (契约 §32.1):')
  for (const h of aliasHits.slice(0, 20)) console.error(`  ${h}`)
  process.exit(1)
}
console.log('[pack-engine] 产物声明零 @/ 别名说明符 OK (契约 §32.1)')

console.log(`[pack-engine] tarball → ${tarball}`)
console.log('[pack-engine] 下一步: node scripts/verify-engine-package.mjs 做真实安装验证')
