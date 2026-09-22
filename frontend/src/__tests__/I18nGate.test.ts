// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// I18nGate — "切语言只换了一半" 的 CI 硬闸门
//
// 为什么需要: i18n 全量替换批次之后, 三个 commit 的说明都写着"components/ 与
// pages/ 所有用户可见文案已接 t()", 实测仍有 39 处硬编码中文; 更糟的是
// Toolbar 里重复 5 次的
//
//     const isEN = t('headerBar.brand') === 'EMR Editor' ? false : true
//
// —— 'EMR Editor' 在 zh-CN 与 en-US **两个语言包里是同一个值**, 该表达式恒为
// false, 于是字体/标题/编号/域代码四组下拉切到 English 后仍显示中文。
// tsc / 全量 vitest / vite build 当时全绿, 因为**没有任何用例渲染过 Toolbar**。
//
// 端到端用例只能覆盖被渲染到的组件 (i18nBinding.test.tsx 当时只渲染了
// ModeSwitcher 一个), 覆盖不了"还有哪些文件没接"这个**全局**问题。所以这里
// 用静态扫描把两类问题变成 CI 会红的事实:
//
//   A. 用户可见文案硬编码中文 (字符串字面量 + JSX 文本节点)
//   B. 用「翻译结果反推当前语言」—— t(...) === '字面量' 的判定式
//
// 与 ChromeTokenGate 同一思路: 靠肉眼扫 40 个文件发现不了, 就交给闸门。
// 改白名单时想清楚: 加进白名单等于承认那处不接 i18n 是**设计**, 不是欠债。
// ============================================================

import { describe, it, expect } from 'vitest'

// 构建期读入 UI 源码文本 (key 为 /src/... 相对项目根)
const uiSources = import.meta.glob('/src/{components,pages}/**/*.{ts,tsx}', {
  as: 'raw',
  eager: true,
}) as Record<string, string>

const FILES = Object.keys(uiSources)
  .filter((f) => !f.includes('/__tests__/'))
  .sort()

/**
 * 闸门必须真的扫到这些文件 —— 否则下面的空数组断言全是假通过。
 * (ChromeTokenGate 用同样的手法防"闸门自己漏扫": 那比没有闸门更危险。)
 */
const MUST_SCAN = [
  '/src/components/layout/Toolbar.tsx',
  '/src/components/layout/Sidebar.tsx',
  '/src/pages/EditorPage.tsx',
  '/src/pages/HomePage.tsx',
]

/**
 * 白名单: 这些文件的 zh-CN 字面量是**刻意设计**的兜底 ——
 * 它们是纯函数 / 无 hook 上下文, t 由调用方注入, 未注入时回退 zh-CN。
 * 契约 §27.3 的 locale 单例是 React 之外的单例, 纯函数不能挂 hook。
 * 每个文件头都写了理由; 新增白名单必须同样写清为什么。
 */
const DESIGNED_ZH_FALLBACK = [
  '/src/components/editor/contextMenuModel.ts',
  '/src/components/editor/controlMessages.ts',
  '/src/components/views/controlDisplay.ts',
]

/** 中文区间 (CJK 统一表意文字) */
const CJK = /[一-鿿]/

/**
 * 行内豁免标记: 该行的中文是**有意的**, 理由写在标记后。
 *
 * 用于"用户可见但刻意不翻译"的个例 (如 CJK 编号样式的字形样本 —— 它在两种
 * 语言下都必须是「一」)。整文件级别的豁免见 DESIGNED_ZH_FALLBACK。
 */
const KEEP_MARKER = /\/\/\s*i18n-keep:\s*\S/

/** 去掉行注释 / JSX 注释 —— 注释里的中文是文档, 不是文案 */
function stripComments(line: string): string {
  let s = line.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  const i = s.indexOf('//')
  if (i >= 0) s = s.slice(0, i)
  return s
}

/**
 * 开发期诊断日志 (`console.error('保存失败:', err)` 之类) 不是用户可见文案 ——
 * 它们只进 devtools, 且报错对象本身 (err) 也无法翻译。豁免掉。
 *
 * 注意豁免的是**这一行**, 不是这个文件: 同一个页面里真正的 UI 文案仍要接 t()。
 */
function isDevLog(line: string): boolean {
  return /\bconsole\.(log|info|warn|error|debug)\s*\(/.test(line)
}

/** 把 t('...') / t(`...`) 的参数挖空, 免得语言包键名被当成文案 */
function blankTArgs(line: string): string {
  return line.replace(/\bt\(\s*(['"`])(?:\\.|(?!\1).)*\1/g, 't()')
}

interface Hit { file: string; line: number; kind: string; text: string }

function scanLiterals(file: string, src: string): Hit[] {
  const hits: Hit[] = []
  src.split('\n').forEach((raw, i) => {
    const trimmed = raw.trim()
    // 块注释续行
    if (trimmed.startsWith('*') || trimmed.startsWith('/*')) return
    // 行内豁免: 有意的中文 (理由见标记后正文)
    if (KEEP_MARKER.test(raw)) return
    // 开发期日志: 不是用户可见文案
    if (isDevLog(raw)) return
    const line = blankTArgs(stripComments(raw))
    for (const m of line.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) {
      if (CJK.test(m[2])) hits.push({ file, line: i + 1, kind: 'string', text: m[2] })
    }
    // JSX 文本节点: >中文<
    for (const m of line.matchAll(/>([^<>{}]*[一-鿿][^<>{}]*)</g)) {
      const body = m[1].trim()
      if (body) hits.push({ file, line: i + 1, kind: 'jsx', text: body })
    }
  })
  return hits
}

/**
 * 反模式: 用翻译结果反推语言。
 *
 * 任何 `t(...) === '<字面量>'` / `t(...) !== '<字面量>'` 的判定都是可疑的 ——
 * 语言归属应该读 `useTranslation().locale`, 而不是拿某个键的值去猜。
 * 这行代码在 Toolbar 里恒为 false, 是整批替换里最隐蔽的失败。
 */
function scanLocaleGuessing(file: string, src: string): Hit[] {
  const hits: Hit[] = []
  src.split('\n').forEach((raw, i) => {
    const trimmed = raw.trim()
    if (trimmed.startsWith('*') || trimmed.startsWith('/*')) return
    const line = stripComments(raw)
    if (/\bt\([^)]*\)\s*[!=]==?\s*['"`]/.test(line)) {
      hits.push({ file, line: i + 1, kind: 'locale-guess', text: line.trim() })
    }
  })
  return hits
}

const SCANNED = FILES.filter((f) => !DESIGNED_ZH_FALLBACK.includes(f))
const literalHits = SCANNED.flatMap((f) => scanLiterals(f, uiSources[f]))
const guessHits = SCANNED.flatMap((f) => scanLocaleGuessing(f, uiSources[f]))

const fmt = (h: Hit) => `${h.file}:${h.line} [${h.kind}] ${h.text}`

describe('I18nGate — 扫描覆盖', () => {
  it('闸门必须扫到全部 UI 源文件 (漏扫比没闸门更危险)', () => {
    expect(FILES.length).toBeGreaterThan(30)
    for (const must of MUST_SCAN) {
      expect(FILES).toContain(must)
      expect(SCANNED).toContain(must)
    }
  })

  it('白名单文件真实存在 (删了文件却留着白名单 = 白名单在保护空气)', () => {
    for (const f of DESIGNED_ZH_FALLBACK) {
      expect(FILES).toContain(f)
    }
  })
})

describe('I18nGate — 不得硬编码用户可见中文', () => {
  it('components/ 与 pages/ 无中文文案字面量', () => {
    expect(literalHits.map(fmt)).toEqual([])
  })
})

describe('I18nGate — 不得用翻译结果反推语言', () => {
  it('无 t(...) === 字面量 形式的语言判定', () => {
    expect(guessHits.map(fmt)).toEqual([])
  })
})
