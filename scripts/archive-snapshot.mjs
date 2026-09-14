// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// archive-snapshot.mjs — 生成可独立验证的离线归档快照
//
// 产出一份「挺得过远程账号被删除」的证据副本:
//   repo.bundle      git bundle --all, 单文件含完整历史 (含全部分支与标签)
//   source.tar.gz    git archive HEAD, 不含 .git 的源码快照
//   SHA256SUMS       GNU sha256sum -c 兼容格式
//   MANIFEST.txt     commit / 分支 / 日期 / 文件数 / 远程 URL / 版本号
//
// 输出目录由 EMRDE_ARCHIVE_DIR 指定 (默认 D:/emrde-archive, 与 pre-push 写
// D:/post-push-ran.txt 的既有先例一致)。**必须在仓库之外** —— 归档进仓库
// 会被后续提交带走, 证据就废了, 因此脚本对「输出在仓库内」硬拒绝。
//
// 用法:
//   node scripts/archive-snapshot.mjs
//   node scripts/archive-snapshot.mjs --allow-dirty   工作树脏时也归档
// ============================================================

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')

const ALLOW_DIRTY = process.argv.includes('--allow-dirty')

/** git 参数里的路径统一用正斜杠, 避免 Windows 反斜杠在参数中被误解析 */
const fwd = (p) => p.replace(/\\/g, '/')

function git(args) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  }).trim()
}

/** 从 TS 源码里读出版本常量 (如 CURRENT_DOCUMENT_VERSION = { major: 4, ... }) */
function readConstVersion(relPath, constName) {
  try {
    const src = readFileSync(path.join(REPO_ROOT, relPath), 'utf8')
    const m = src.match(
      new RegExp(`${constName}[^=]*=\\s*\\{\\s*major:\\s*(\\d+),\\s*minor:\\s*(\\d+),\\s*patch:\\s*(\\d+)`),
    )
    return m ? `${m[1]}.${m[2]}.${m[3]}` : 'unknown'
  } catch {
    return 'unknown'
  }
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

// ---- 1. 前置检查 ----

const dirty = git(['status', '--porcelain'])
if (dirty && !ALLOW_DIRTY) {
  console.error('✖ 工作树有未提交改动, 归档会捕获不到这些内容。')
  console.error('  请先提交, 或加 --allow-dirty 明确接受。')
  process.exit(2)
}

const commit = git(['rev-parse', 'HEAD'])
const shortSha = commit.slice(0, 7)
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])

const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const dateOnly = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
const stamp = `${dateOnly}_${shortSha}`

const archiveRoot = process.env.EMRDE_ARCHIVE_DIR || 'D:/emrde-archive'
const outDir = path.resolve(archiveRoot, stamp)

// 护栏: 拒绝把归档写进仓库 (否则会被后续 commit 带走, 且污染工作树)
const relToRepo = path.relative(REPO_ROOT, outDir)
if (relToRepo === '' || (!relToRepo.startsWith('..') && !path.isAbsolute(relToRepo))) {
  console.error(`✖ 归档目录不能位于仓库内: ${outDir}`)
  console.error('  请设置 EMRDE_ARCHIVE_DIR 到仓库之外的路径。')
  process.exit(2)
}

mkdirSync(outDir, { recursive: true })

// ---- 2. 产物 ----

const base = `EMRDocumentEngine-${stamp}`
const bundlePath = path.join(outDir, `${base}.bundle`)
const srcPath = path.join(outDir, `${base}-src.tar.gz`)

console.log(`归档 ${commit.slice(0, 12)} (${branch}) → ${outDir}`)

// --all 同时捕获全部分支与标签, 使 bundle 成为完整可还原仓库
execFileSync('git', ['bundle', 'create', fwd(bundlePath), '--all'], { cwd: REPO_ROOT })
console.log('  ✓ repo.bundle      (git bundle --all)')

// 不用 zip: 部分环境没有 zip 命令, tar.gz 到处都有
execFileSync('git', ['archive', '--format=tar.gz', '-o', fwd(srcPath), 'HEAD'], { cwd: REPO_ROOT })
console.log('  ✓ source.tar.gz    (git archive HEAD)')

// ---- 3. 校验清单 ----

const bundleHash = sha256(bundlePath)
const srcHash = sha256(srcPath)
const sums =
  `${bundleHash}  ${path.basename(bundlePath)}\n` + `${srcHash}  ${path.basename(srcPath)}\n`
writeFileSync(path.join(outDir, 'SHA256SUMS'), sums, 'utf8')
console.log('  ✓ SHA256SUMS')

// ---- 4. MANIFEST ----

const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean).length
const remoteLines = git(['remote', '-v'])
  .split('\n')
  .filter((l) => l.includes('(fetch)'))
  .map((l) => {
    const [name, url] = l.split(/\s+/)
    return `  ${name.padEnd(7)}${url}`
  })
  .join('\n')

const editorVersion = readConstVersion(
  'frontend/src/engine/document/version/EditorVersion.ts',
  'EDITOR_VERSION',
)
const docFormatVersion = readConstVersion(
  'frontend/src/engine/document/version/DocumentFormatVersion.ts',
  'CURRENT_DOCUMENT_VERSION',
)

const manifest = `EMR Document Editor Engine — 归档快照
=================================================================
生成时间    : ${now.toISOString()}
Commit      : ${commit}
短 SHA      : ${shortSha}
分支        : ${branch}
工作树      : ${dirty ? `DIRTY (${dirty.split('\n').length} 项改动)` : 'clean'}
跟踪文件数  : ${tracked}
引擎版本    : ${editorVersion}   (frontend/src/engine/document/version/EditorVersion.ts)
文档格式版本: ${docFormatVersion}   (frontend/src/engine/document/version/DocumentFormatVersion.ts)
许可证      : MPL-2.0

远程
${remoteLines}

产物
  ${path.basename(bundlePath)}
    sha256  ${bundleHash}
    大小    ${statSync(bundlePath).size} 字节
  ${path.basename(srcPath)}
    sha256  ${srcHash}
    大小    ${statSync(srcPath).size} 字节

验证方式
  1) sha256sum -c SHA256SUMS
       校验产物完整性 (改一个字节即失败)
  2) git bundle list-heads ${path.basename(bundlePath)}
       列出 bundle 内的全部引用。**无需 git 仓库**, 在归档目录直接跑即可。
  3) git clone ${path.basename(bundlePath)} /tmp/restored
       独立还原 (不涉及任何远程)
  4) git -C /tmp/restored rev-parse HEAD
       应等于上面的 Commit

  可选: 若要校验包内前置对象是否齐备, 需在 git 仓库内运行 (bundle verify
  要求存在仓库才能比对)。在仓库里指向本文件即可:
      git -C <任一仓库> bundle verify ${path.basename(bundlePath)}
  本 bundle 用 --all 生成, 含完整历史, 正常情况下会报告
  "The bundle records a complete history."
`
writeFileSync(path.join(outDir, 'MANIFEST.txt'), manifest, 'utf8')
console.log('  ✓ MANIFEST.txt')

// ---- 5. 提示 ----

console.log('')
console.log(`bundle sha256: ${bundleHash}`)
console.log('')
console.log('下一步 (让第三方时间戳为这份 commit 作证):')
console.log(`  git tag -a archive/${dateOnly} -m "Archive snapshot ${shortSha}"`)
console.log(`  git push origin archive/${dateOnly}    # Gitee`)
console.log(`  git push github archive/${dateOnly}    # GitHub`)
console.log('')
console.log('⚠ 请把归档目录同步到至少一处异地介质 —— 只存本机, 磁盘损坏即失去证据价值。')
