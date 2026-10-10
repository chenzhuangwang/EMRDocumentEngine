// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// verify-engine-package.mjs — 「别的项目能否直接导入使用」的端到端证据
//
// 主张 (README / 契约 §32): 引擎可以完全剥离出去, 被任意项目 import。
// 一个主张只有在一个**不在本仓库内**的消费方里真的跑通, 才算被证明。
//
// 做法: 把 tarball 解包到一个临时目录, 按真实 node_modules 布局摆好, 再从
// 那个目录跑一个消费脚本。这样验证的是**包自己的 exports 映射**, 而不是
// 仓库里的 vite alias / tsconfig paths —— 后者正是最容易自欺的地方。
//
// 临时目录刻意放在 os.tmpdir() 而不是仓库内: 出了仓库, Node 的向上查找
// 找不到本仓库的 node_modules, 依赖只能靠显式 symlink 提供, 结果才是真的。
//
// 用法:
//   node scripts/verify-engine-package.mjs
//   node scripts/verify-engine-package.mjs --tarball dist-packages/xxx.tgz
//   node scripts/verify-engine-package.mjs --keep       保留临时目录供排查
// ============================================================

import { execFileSync } from 'node:child_process'
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync,
  symlinkSync, writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const FRONTEND_NM = path.join(REPO_ROOT, 'frontend', 'node_modules')
const OUT_DIR = path.join(REPO_ROOT, 'dist-packages')

const argv = process.argv.slice(2)
const KEEP = argv.includes('--keep')
const tbIdx = argv.indexOf('--tarball')

// ============================================================
// 消费方脚本 —— 写进临时目录后由 Node 执行。
// 这是"外部项目"的视角: 它对本仓库一无所知, 只能通过包名访问。
// ============================================================
const CONSUMER_SOURCE = `import assert from 'node:assert/strict'

// ---- 1) 核心入口: 在**无 DOM 的纯 Node** 下必须可导入 (契约 §29 / §32.3) ----
const core = await import('@emrde/document-engine')
assert.ok(core.Editor, 'Editor 未导出')
assert.ok(core.createDocument && core.createParagraph && core.createTextNode, '模型工厂未导出')
assert.ok(core.buildNodePool, 'buildNodePool 未导出')
assert.ok(core.loadDocument && core.serializeDocument, 'load/serialize 未导出')
console.log('  · 核心入口 OK (导出符号 ' + Object.keys(core).length + ' 个)')

// ---- 2) headless 往返: create → serialize → load → serialize 逐字节相同 ----
const para = core.createParagraph()
const text = core.createTextNode('入院记录')
para.children = [text.id]
const doc = core.createDocument('smoke', { mode: 'flow', children: [para.id] })

const flat = new Map([[para.id, para], [text.id, text]])
const pool = core.buildNodePool(flat, { body: para.id })
const s1 = core.serializeDocument(doc, pool)

const loaded = core.loadDocument(s1)
const s2 = core.serializeDocument(loaded.doc, loaded.pool)
assert.equal(s2, s1, 'round-trip 不是逐字节相同')
console.log('  · serialize -> load -> serialize 逐字节相同 OK (' + s1.length + ' bytes)')

// ---- 3) 版本与 locale 可用 ----
const v = core.CURRENT_DOCUMENT_VERSION
assert.ok(v && typeof v.major === 'number', 'CURRENT_DOCUMENT_VERSION 未导出')
assert.ok(core.locale && typeof core.locale.getLocale === 'function', 'locale 未导出')
console.log('  · 文档格式版本 ' + v.major + '.' + v.minor + '.' + v.patch +
            ', locale=' + core.locale.getLocale() + ' OK')

// ---- 4) 其余三个子路径必须能被 exports 解析 ----
const exp = await import('@emrde/document-engine/export')
assert.equal(typeof exp.buildExportText, 'function', './export 缺 buildExportText')
assert.equal(typeof exp.buildOfd, 'function', './export 缺 buildOfd')
assert.equal(typeof exp.collectFields, 'function', './export 缺 collectFields')
console.log('  · ./export 入口 OK (导出符号 ' + Object.keys(exp).length + ' 个)')

const dom = await import('@emrde/document-engine/dom')
assert.equal(typeof dom.createDomEditorHost, 'function', './dom 缺 createDomEditorHost')
console.log('  · ./dom 入口 OK (无 DOM 环境下导入不抛 = 构造零副作用, §29)')

const react = await import('@emrde/document-engine/react')
assert.equal(typeof react.EditorProvider, 'function', './react 缺 EditorProvider')
assert.equal(typeof react.useEditorStoreSnapshot, 'function', './react 缺 hook')
console.log('  · ./react 入口 OK (导出符号 ' + Object.keys(react).length + ' 个)')

// ---- 5) 反证: 核心入口不得把 React 拖进来 (§32.4) ----
const coreKeys = Object.keys(core)
assert.ok(!coreKeys.includes('useState'), '核心入口泄漏了 React 符号')
assert.ok(!Object.keys(core).some(function (k) { return /^(jsx|createElement|Fragment)$/.test(k) }),
  '核心入口泄漏了 React 运行时符号')
console.log('  · 核心入口不含 React 符号 OK')
`

function fail(msg) {
  console.error(`\n[verify] 失败: ${msg}`)
  process.exit(1)
}

/** npm 在 Windows 上是 npm.cmd */
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'

// ---- 1. 拿到 tarball --------------------------------------------------
let tarball = tbIdx >= 0 ? path.resolve(argv[tbIdx + 1]) : ''
if (!tarball) {
  console.log('[verify] 打包引擎分包…')
  execFileSync(process.execPath, [path.join(HERE, 'pack-engine.mjs')], {
    cwd: REPO_ROOT, stdio: 'inherit',
  })
  const pkgs = existsSync(OUT_DIR) ? readdirSync(OUT_DIR).filter((f) => f.endsWith('.tgz')) : []
  if (!pkgs.length) fail(`${OUT_DIR} 下没有 .tgz`)
  tarball = path.join(OUT_DIR, pkgs[pkgs.length - 1])
}
if (!existsSync(tarball)) fail(`tarball 不存在: ${tarball}`)
console.log(`[verify] tarball: ${tarball}`)

// ---- 2. 解到临时目录, 摆成真实 node_modules 布局 ----------------------
const tmp = mkdtempSync(path.join(os.tmpdir(), 'emrde-verify-'))
console.log(`[verify] 临时消费方目录: ${tmp}`)

let ok = false
try {
  // tar 一律在临时目录内、只用不带盘符的相对名操作。
  // 原因: GNU tar 把 `D:\...` 里的冒号当成「远程主机」语法 (host:path),
  // 传绝对 Windows 路径会直接报 "Cannot connect to D"。先拷进来最省事。
  copyFileSync(tarball, path.join(tmp, 'pkg.tgz'))
  execFileSync('tar', ['-xzf', 'pkg.tgz'], { cwd: tmp, stdio: 'inherit' })

  const extracted = path.join(tmp, 'package')
  if (!existsSync(extracted)) fail('tarball 里没有 package/ 顶层目录')

  const scopeDir = path.join(tmp, 'node_modules', '@emrde')
  mkdirSync(scopeDir, { recursive: true })
  // 从解包目录挪到真实包名位置 —— 于是 `import '@emrde/document-engine'`
  // 走的是 Node 自己的 package.json exports 解析
  renameSync(extracted, path.join(scopeDir, 'document-engine'))

  // 运行期依赖从本仓库前端的 node_modules 借 (离线可跑, 不触网)。
  // react-dom 的传递依赖也要带上, 否则 ./react 解析会断。
  const DEPS = [
    'fflate', 'react', 'react-dom',
    'scheduler', 'loose-envify', 'js-tokens',
  ]
  for (const dep of DEPS) {
    const target = path.join(FRONTEND_NM, dep)
    const link = path.join(tmp, 'node_modules', dep)
    if (existsSync(target) && !existsSync(link)) symlinkSync(target, link, 'junction')
  }

  // ---- 3. 消费方工程 ------------------------------------------------
  writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
    name: 'emrde-consumer-smoke', private: true, type: 'module', version: '0.0.0',
  }, null, 2))
  writeFileSync(path.join(tmp, 'check.mjs'), CONSUMER_SOURCE)

  console.log('[verify] 运行消费方 smoke…\n')
  const out = execFileSync(process.execPath, ['check.mjs'], {
    cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  })
  process.stdout.write(out)
  ok = true
} finally {
  if (KEEP) console.log(`\n[verify] --keep: 临时目录保留在 ${tmp}`)
  else rmSync(tmp, { recursive: true, force: true })
}

if (ok) {
  console.log('\n[verify] ✅ 分包在仓库之外的消费方里 import / 往返 / 四入口解析全部通过')
} else {
  process.exit(1)
}
