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
// 用静态扫描把三类问题变成 CI 会红的事实:
//
//   A. 用户可见文案硬编码中文 (字符串字面量 + JSX 文本节点)
//   B. 用「翻译结果反推当前语言」—— t(...) === '字面量' 的判定式
//   C. 硬编码语言标识 ('zh-CN' / 'en-US') —— 日期格式化那类 bug 的形式化
//
// 扫描范围是**整个源码面**, 不只是 UI 层: 第二批把引擎层也接了进来, 而引擎层
// 恰恰藏着最隐蔽的那个 bug —— FieldFormatter 的 `toLocaleDateString('zh-CN')`
// 让 en-US 界面下的日期域渲染成中文格式, 且 FieldTextContext 里根本没有
// locale 字段, 调用方想注入都没地方传。UI 层闸门扫不到它。
//
// ------------------------------------------------------------
// 引擎物理剥离之后 (契约 §32) 的调整
// ------------------------------------------------------------
//
// 引擎源码已搬到 packages/emr-document-engine/src —— 它仍然是**同一份必须接
// i18n 的代码**, 所以本闸门改成**双根遍历**: 应用 `frontend/src` 与引擎包
// `packages/emr-document-engine/src` 都在范围内, 键前缀 `app:` / `pkg:` 区分。
// 遍历方式从 import.meta.glob 改成 node:fs —— glob 以 Vite root (frontend/) 为
// 基准, 跨 root 扫包外目录不可靠 (声明见同目录 nodeShims.d.ts)。
//
// 与 ChromeTokenGate 同一思路: 靠肉眼扫 40 个文件发现不了, 就交给闸门。
// 改白名单时想清楚: 加进白名单等于承认那处不接 i18n 是**设计**, 不是欠债。
// ============================================================

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cwd } from 'node:process'

/** 应用源码根 (vitest 的 cwd 是 frontend/) */
const APP_SRC = join(cwd(), 'src')
/** 引擎包源码根 (契约 §32 物理剥离后的位置) */
const PKG_SRC = join(cwd(), '..', 'packages', 'emr-document-engine', 'src')

/** 递归列出目录下全部文件, key 为 `<prefix><相对路径>` (正斜杠) */
function walk(dir: string, prefix: string, rel = ''): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const next = rel ? `${rel}/${name}` : name
    if (statSync(abs).isDirectory()) out.push(...walk(abs, prefix, next))
    else out.push([`${prefix}${next}`, abs])
  }
  return out
}

const uiSources: Record<string, string> = {}
for (const [key, abs] of [...walk(APP_SRC, 'app:'), ...walk(PKG_SRC, 'pkg:')]) {
  if (!/\.(ts|tsx)$/.test(key) || key.endsWith('.d.ts')) continue
  uiSources[key] = readFileSync(abs, 'utf8')
}

const FILES = Object.keys(uiSources)
  .filter((f) => !f.includes('__tests__/'))
  .sort()

/**
 * 闸门必须真的扫到这些文件 —— 否则下面的空数组断言全是假通过。
 * (ChromeTokenGate 用同样的手法防"闸门自己漏扫": 那比没有闸门更危险。)
 *
 * 应用侧四项守 UI 层; 引擎侧五项守当初漏掉的那半 —— 它们现在住在包里,
 * 但接不接 i18n 的标准不变。
 */
const MUST_SCAN = [
  'app:components/layout/Toolbar.tsx',
  'app:components/layout/Sidebar.tsx',
  'app:pages/EditorPage.tsx',
  'app:pages/HomePage.tsx',
  // 引擎层 —— 第二批接入的对象, 物理剥离后仍必须真扫到
  'pkg:engine/qc/QCEngine.ts',
  'pkg:engine/ErrorRecovery.ts',
  'pkg:engine/document/factory/FieldFormatter.ts',
  'pkg:engine/document/control/ControlOptions.ts',
  'pkg:engine/loaders/DocumentLoaderRegistry.ts',
]

/**
 * 白名单 (整文件): 这些文件里的中文**不是欠债**, 按类别说明理由。
 *
 * 判据是「中文在这里是不是**内容**」:
 *   - 语言包本身 → 它就是翻译存储
 *   - 领域数据 → 中文是正确内容 (中文 EMR 病历 / 国标码表 / 字形), 翻成英文反而错
 *   - 固定文本 → 版权署名 / 语言自名, 不随界面语言变
 */
const EXEMPT = new Set([
  // ---- 语言包本身 (它就是翻译存储, 中文是数据不是文案) ----
  'pkg:engine/i18n/index.ts',
  'app:i18n/bootstrap.ts',              // LOCALES 的语言自名「简体中文」不随界面语言变

  // ---- 领域数据: 中文是正确内容 ----
  'pkg:engine/AutoCorrectEngine.ts',    // 医嘱缩写 → 中文词表 (i.v. → 静脉滴注)
  'pkg:engine/render/particles/ListParticle.ts', // CJK 数字字形 (一/二/三…), 两种语言下都是它
  'pkg:engine/layout/line/LineBreaker.ts',       // 中文避头尾字符集, 纯布局数据不上屏
  'app:platform/data/controlLibrary.ts',         // 控件库名 (患者姓名…); §12.4 明确「引擎不得硬编码医学字典」
  'app:platform/data/dictionaryCatalog.ts',      // GB/T 国标码表 (性别/婚姻状况…)
  'pkg:platform/dom/DomTextHost.ts',             // 字体度量取样字符 '中' (量全角宽用)
  'app:mocks/documents.ts',                      // mock 病历的医生名 ('李医生') —— 病历内容不是界面文案

  // ---- 固定文本 ----
  'pkg:lib/provenance.ts',              // 版权署名 'Copyright (c) 2026 陈庄旺' —— 导出件的法务标识

  // ---- 纯函数 t 注入 + zh-CN 兜底 (无 hook 上下文, 见各文件头) ----
  'app:components/editor/contextMenuModel.ts',
  'app:components/editor/controlMessages.ts',
  'app:components/views/controlDisplay.ts',
])

/** 中文区间 (CJK 统一表意文字) */
const CJK = /[一-鿿]/

/**
 * 行内豁免标记: 该行的中文是**有意的**, 理由写在标记后。
 *
 * 用于"用户可见但刻意不翻译"的个例 (如 CJK 编号样式的字形样本 —— 它在两种
 * 语言下都必须是「一」)。整文件级别的豁免见 EXEMPT。
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
 * 语言归属应该读 `useTranslation().locale` / `locale.getLocale()`, 而不是拿某个
 * 键的值去猜。这行代码在 Toolbar 里恒为 false, 是整批替换里最隐蔽的失败。
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

/**
 * 反模式: 硬编码语言标识。
 *
 * `toLocaleDateString('zh-CN')` / `toLocaleTimeString('en-US')` 这类调用把格式
 * 钉死在一种语言上, 界面切到另一种语言时输出不变 —— FieldFormatter 的日期域
 * 就是这个 bug (en-US 界面下渲染出 '2026/9/22')。应该传 `locale.getLocale()`
 * 或由调用方经 ctx 注入。
 *
 * 只扫 `engine/` 与 `lib/` 这类**运行时**代码; UI 组件里出现 'zh-CN' 通常是在
 * 处理 locale 本身 (如 LOCALES 列表), 不在此列。
 */
function scanHardcodedLocale(file: string, src: string): Hit[] {
  const hits: Hit[] = []
  src.split('\n').forEach((raw, i) => {
    const trimmed = raw.trim()
    if (trimmed.startsWith('*') || trimmed.startsWith('/*')) return
    if (KEEP_MARKER.test(raw)) return
    const line = stripComments(raw)
    // toLocaleDateString('zh-CN') / toLocaleTimeString('en-US') / Intl.*('zh-CN')
    if (/\b(toLocaleDateString|toLocaleTimeString|toLocaleString|DateTimeFormat)\s*\(\s*['"`](zh-CN|en-US)['"`]/.test(line)) {
      hits.push({ file, line: i + 1, kind: 'hardcoded-locale', text: line.trim() })
    }
  })
  return hits
}

const SCANNED = FILES.filter((f) => !EXEMPT.has(f))
const literalHits = SCANNED.flatMap((f) => scanLiterals(f, uiSources[f]))
const guessHits = SCANNED.flatMap((f) => scanLocaleGuessing(f, uiSources[f]))
// 硬编码语言只对运行时层 (引擎包 / 应用 lib) 生效 —— UI 层处理 locale 本身是合法的
const LOCALE_SCOPE = SCANNED.filter(
  (f) => f.startsWith('pkg:engine/') || f.startsWith('pkg:lib/') || f.startsWith('app:lib/'),
)
const localeHits = LOCALE_SCOPE.flatMap((f) => scanHardcodedLocale(f, uiSources[f]))

const fmt = (h: Hit) => `${h.file}:${h.line} [${h.kind}] ${h.text}`

describe('I18nGate — 扫描覆盖', () => {
  it('闸门必须扫到全部源文件 (漏扫比没闸门更危险)', () => {
    expect(FILES.length).toBeGreaterThan(150)
    for (const must of MUST_SCAN) {
      expect(FILES).toContain(must)
      expect(SCANNED).toContain(must)
    }
  })

  it('两个根都真的扫到了 (跨 root 遍历坏掉时会静默变成"只扫一半")', () => {
    expect(FILES.some((f) => f.startsWith('app:'))).toBe(true)
    expect(FILES.some((f) => f.startsWith('pkg:'))).toBe(true)
  })

  it('白名单文件真实存在 (删了文件却留着白名单 = 白名单在保护空气)', () => {
    for (const f of EXEMPT) {
      expect(FILES).toContain(f)
    }
  })
})

describe('I18nGate — 不得硬编码用户可见中文', () => {
  it('全源码面 (应用 + 引擎包) 无中文文案字面量 (领域数据见 EXEMPT)', () => {
    expect(literalHits.map(fmt)).toEqual([])
  })
})

describe('I18nGate — 不得用翻译结果反推语言', () => {
  it('无 t(...) === 字面量 形式的语言判定', () => {
    expect(guessHits.map(fmt)).toEqual([])
  })
})

describe('I18nGate — 不得硬编码语言标识', () => {
  it('engine/ 与 lib/ 的日期格式化不得钉死 zh-CN / en-US', () => {
    expect(localeHits.map(fmt)).toEqual([])
  })
})
