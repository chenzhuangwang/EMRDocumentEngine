// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// retheme-chrome — 中性色 class → chrome token 的机械替换 codemod
//
// 用法:
//   node scripts/retheme-chrome.mjs --dry     # 只做对账, 不写盘
//   node scripts/retheme-chrome.mjs           # 执行替换
//
// 设计要点: **对账是这个脚本的内建断言**, 不是事后再数一遍。
// 手工数两遍必然对不上 —— 同一份代码、同一批 grep, 两套工具会差几十处
// (见 glimmering-singing-lerdorf.md 审计 ②)。所以这里让脚本自己保证:
//   旧类 (白名单外) 归零  &&  替换点数 === 匹配点数
// 任一不成立就 exit 1。
//
// 替换范围含 `src/index.css`: `.toolbar-btn` 的 @apply 写在 CSS 里, 只扫
// tsx 的闸门会漏掉这个最高杠杆点 (改一处等于改几十处)。
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCAN_ROOTS = [
  join(ROOT, 'frontend/src/components'),
  join(ROOT, 'frontend/src/pages'),
]
const SCAN_FILES = [join(ROOT, 'frontend/src/index.css')]
const EXTS = new Set(['.tsx', '.ts', '.css'])

// ---- 映射表 (机械 1:1, 与 tailwind.config.ts 的 chrome/line 组一一对应) ----

const MAP = new Map(Object.entries({
  'bg-white': 'bg-chrome',
  'bg-gray-50': 'bg-chrome-subtle',
  'bg-gray-100': 'bg-chrome-muted',
  'bg-gray-200': 'bg-chrome-strong',
  'bg-[#E5E7EB]': 'bg-chrome-desk',

  'border-gray-50': 'border-line-subtle',
  'border-gray-100': 'border-line-subtle',
  'border-gray-200': 'border-line',
  'border-gray-300': 'border-line-strong',

  'divide-gray-50': 'divide-line-subtle',
  'divide-gray-100': 'divide-line-subtle',

  'text-gray-900': 'text-chrome-ink',
  'text-gray-800': 'text-chrome-ink-strong',
  'text-gray-700': 'text-chrome-ink-body',
  'text-gray-600': 'text-chrome-ink-secondary',
  'text-gray-500': 'text-chrome-ink-tertiary',
  'text-gray-400': 'text-chrome-ink-muted',
  'text-gray-300': 'text-chrome-ink-disabled',
}))

/**
 * 刻意 **不** 替换 —— 这些中性色不是"外壳面/墨/线", 换成 token 反而错:
 * - `text-white`: 全部坐落在 primary / 语义色底上, 是**彩色底上的白字**,
 *   跟着主题走会变成"深色底上浅灰字", 对比度反而崩掉。
 * - `bg-black/20|30|40`: 模态遮罩, 语义就是"压暗底层", 不需要随主题变。
 * - `bg-gray-900/95`: 深色 toast, 本身已是深色, 且**不随主题反色**。
 * 写成显式白名单而不是"正好没匹配到", 是为了让下一轮改动看见这些是**故意留的**。
 */
const KEEP = [
  { re: /^text-white$/, why: '彩色底上的白字' },
  { re: /^bg-black\/(20|30|40)$/, why: '模态遮罩' },
  { re: /^bg-gray-900\/95$/, why: '深色 toast' },
]

// 只匹配 bg/text/border/divide 四个前缀下的白/黑/灰 —— ring/from/via/placeholder
// 等前缀当前无灰系用法 (已核), 若将来出现会走"未映射"分支直接报错, 不会静默漏过。
// `black` 也进来是为了让遮罩**被看见并被显式保留**, 而不是靠"正则正好没匹配到"
// 稀里糊涂留下 —— 那样下一轮就没人知道它是故意的。
const TOKEN_RE = /(?<![\w-])(bg|text|border|divide)-(white|black|gray-\d{2,3}|\[#E5E7EB\])(\/\d{1,3})?(?![\w-])/g

function isKept(token) {
  return KEEP.some((k) => k.re.test(token))
}

/**
 * 行级豁免标记。
 *
 * 有些中性色**看起来**是该替换的容器色, 实际是"内容本体"——最典型的是打印
 * 预览里的 A4 纸面: 它必须是纸白, 否则深色外壳下预览会说谎 (打印是 WYSIWYG)。
 * 这种按 token 白名单表达不了, 只能按位置豁免。
 *
 * 约定: 该行含 `retheme-keep` 即整行跳过, 且替换后仍计入"豁免"对账。
 * 必须写在**同一行**(不是上一行注释), 否则标记会脱离它守护的那个 token。
 */
const KEEP_MARK = 'retheme-keep'

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      walk(full, out)
    } else if (EXTS.has(name.slice(name.lastIndexOf('.')))) {
      out.push(full)
    }
  }
  return out
}

function collectFiles() {
  const files = []
  for (const root of SCAN_ROOTS) walk(root, files)
  return [...files, ...SCAN_FILES]
}

/** 扫描一段文本, 返回 { token, index } 列表 */
function scan(text) {
  const hits = []
  TOKEN_RE.lastIndex = 0
  let m
  while ((m = TOKEN_RE.exec(text)) !== null) {
    hits.push({ token: m[0], key: `${m[1]}-${m[2]}`, alpha: m[3] ?? '' })
  }
  return hits
}

// ---- 主流程 ----

const dry = process.argv.includes('--dry')
const files = collectFiles()

const beforeCounts = new Map()
const unmapped = new Map()
const keptCounts = new Map()
const markedCounts = new Map()
const perFile = []
let totalReplaced = 0

/** 按行处理: 带 KEEP_MARK 的行整行跳过 (标记必须与它守护的 token 同行) */
function processText(text) {
  let replaced = 0
  let marked = 0
  const lines = text.split('\n').map((line) => {
    const hits = scan(line)
    if (hits.length === 0) return line

    if (line.includes(KEEP_MARK)) {
      for (const h of hits) {
        markedCounts.set(h.token, (markedCounts.get(h.token) ?? 0) + 1)
        marked++
      }
      return line
    }

    return line.replace(TOKEN_RE, (token, prefix, color, alpha = '') => {
      if (isKept(token)) {
        keptCounts.set(token, (keptCounts.get(token) ?? 0) + 1)
        return token
      }
      const key = `${prefix}-${color}`
      const target = MAP.get(key)
      if (!target) {
        unmapped.set(token, (unmapped.get(token) ?? 0) + 1)
        return token
      }
      beforeCounts.set(key, (beforeCounts.get(key) ?? 0) + 1)
      replaced++
      return `${target}${alpha}`
    })
  })
  return { next: lines.join('\n'), replaced, marked }
}

let matchedRaw = 0
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const hits = scan(text)
  if (hits.length === 0) continue
  matchedRaw += hits.length

  const { next, replaced } = processText(text)
  totalReplaced += replaced

  if (replaced > 0) {
    perFile.push({ file: relative(ROOT, file), n: replaced })
    if (!dry) writeFileSync(file, next, 'utf8')
  }
}

// 三个计数各自累加, 但**匹配总数另由正则独立数一遍**(matchedRaw, 在替换前的
// 原文上数) —— 若两者不等, 说明有 token 走进了没人统计的分支, 对账才有意义。
const sumOf = (m) => [...m.values()].reduce((a, b) => a + b, 0)
const keptTotal = sumOf(keptCounts)
const markedTotal = sumOf(markedCounts)
const totalMatched = totalReplaced + keptTotal + markedTotal

// ---- 报告 ----

const pad = (s, n) => String(s).padEnd(n)
console.log(`\n${dry ? '[DRY RUN] ' : ''}retheme-chrome — 扫描 ${files.length} 个文件\n`)

console.log('旧类清单 (将替换 → 目标):')
for (const [k, n] of [...beforeCounts].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pad(k, 22)} ${pad(n, 4)} → ${MAP.get(k)}`)
}
console.log(`  ${pad('合计', 22)} ${totalReplaced}`)

console.log('\n白名单 (刻意保留, 按设计不替换):')
for (const [k, n] of [...keptCounts].sort((a, b) => b[1] - a[1])) {
  const why = KEEP.find((x) => x.re.test(k))?.why ?? '?'
  console.log(`  ${pad(k, 22)} ${pad(n, 4)} — ${why}`)
}

console.log(`\n行级豁免 (${KEEP_MARK} 标记处):`)
for (const [k, n] of [...markedCounts].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pad(k, 22)} ${pad(n, 4)} — 内容本体, 非外壳`)
}

console.log('\n按文件:')
for (const { file, n } of perFile.sort((a, b) => b.n - a.n)) {
  console.log(`  ${pad(n, 4)}  ${file}`)
}

// ---- 内建断言 ----

const problems = []

// 1. 未映射的旧类 —— 映射表不全时必须显式红, 不能悄悄留着
if (unmapped.size > 0) {
  problems.push(
    `映射表缺项 (${[...unmapped.keys()].join(', ')}) —— ` +
    `要么补进 MAP, 要么补进 KEEP 并写明理由`,
  )
}

// 2. 非 dry 模式下复算: 非豁免位置的旧类必须归零
if (!dry) {
  const residual = new Map()
  for (const file of files) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.includes(KEEP_MARK)) continue
      for (const hit of scan(line)) {
        if (isKept(hit.token)) continue
        residual.set(hit.token, (residual.get(hit.token) ?? 0) + 1)
      }
    }
  }
  if (residual.size > 0) {
    problems.push(`替换后仍有旧类残留: ${[...residual].map(([k, n]) => `${k}×${n}`).join(', ')}`)
  }
}

// 3. 独立数的匹配总数必须等于三个出口之和
if (matchedRaw !== totalMatched) {
  problems.push(
    `对账不平: 正则数出 ${matchedRaw} ≠ 替换 ${totalReplaced} + 白名单 ${keptTotal} + 行级豁免 ${markedTotal}`,
  )
}

if (problems.length > 0) {
  console.error('\n✗ 对账失败:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

console.log(
  `\n✓ 对账通过: 匹配 ${matchedRaw} = 替换 ${totalReplaced} + 白名单 ${keptTotal} + 行级豁免 ${markedTotal}` +
  (dry ? ' (dry run, 未写盘)' : ''),
)
