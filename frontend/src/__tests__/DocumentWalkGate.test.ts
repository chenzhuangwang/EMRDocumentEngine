// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// DocumentWalkGate — 「遍历口径」的 CI 硬闸门 (契约 §31)
//
// 为什么需要: Section 落地的最大风险不是"写不出 Section", 而是**15 个消费点
// 各自遍历 `doc.body.children`** —— Section 一旦不是段落/表格, 每处都会以自己
// 的方式静默失败 (方向键导航死、点击不落光标、字数统计漏节、目录漏标题…)。
// 这类缺陷不会让 tsc / 全量 vitest / build 变红, 因为**没有任何既有用例的文档
// 含 Section**。所以这里把"谁可以遍历 body 子节点"变成 CI 会红的事实:
//
//   A. 白名单之外, 代码里不得出现 `doc.body.children`
//      (注释 / 字符串字面量已剥离 —— QC 规则名 'field_exists:body.children'
//       与 i18n 文案里的同名文本不是遍历)
//   B. 闸门必须真的扫到该扫的文件 (漏扫比没闸门更危险)
//   C. 扫描器对注入的越权遍历必须报警 (证明闸门不是空断言)
//
// 白名单的判据是「这里用的是**结构树**还是**逻辑流**」(契约 §31.1):
//   - 结构树 (真实下标 / 真实兄弟 / 真容器身份 / 序列化可达性) → 允许
//   - 逻辑流 (按阅读顺序读) → 必须走 SelectionCollector 的 W1–W4
// 加白名单等于承认"这处是结构语义", 不是欠债 —— 想清楚再改。
//
// ------------------------------------------------------------
// 引擎物理剥离之后 (契约 §32) 的两点调整
// ------------------------------------------------------------
//
// 1. **两个扫描根**: 引擎源码在 packages/emr-document-engine/src, 应用源码仍在
//    frontend/src。这条闸门守的是**全仓**的遍历口径 (应用代码一样可以抓到
//    DocumentTree 去遍历), 所以它留在应用侧、同时扫两棵树 —— 与 I18nGate 同法。
//    键前缀 `pkg:` / `app:` 把两个根分开, 免得同名路径互相冒充。
//
// 2. **遍历方式从 import.meta.glob 改成 node:fs**: glob 以 Vite root
//    (frontend/) 为基准, 跨 root 去扫包外目录不可靠; node:fs 与 root 解耦,
//    两个根一视同仁。(声明见同目录 nodeShims.d.ts)
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

/** 只收 .ts / .tsx 源码, `.d.ts` 与 `__tests__` 一并排除 */
const sources: Record<string, string> = {}
const FILES: string[] = []
for (const [key, abs] of [
  ...walk(APP_SRC, 'app:'),
  ...walk(PKG_SRC, 'pkg:'),
]) {
  if (!/\.(ts|tsx)$/.test(key) || key.endsWith('.d.ts')) continue
  if (key.includes('__tests__/')) continue
  // 构建产物不属于源码 (包内 dist 已在 gitignore, 此处兜底)
  if (key.startsWith('pkg:engine/dist/')) continue
  sources[key] = readFileSync(abs, 'utf8')
  FILES.push(key)
}
FILES.sort()

/** 闸门必须真的扫到这些文件, 否则下面的断言是假通过 */
const MUST_SCAN = [
  'pkg:engine/Editor.ts',
  'pkg:engine/layout/core/LayoutEngine.ts',
  'pkg:engine/interaction/KeyboardHandler.ts',
  'pkg:engine/interaction/MouseHandler.ts',
  'pkg:engine/qc/QCEngine.ts',
  'pkg:engine/render/Draw.ts',
  'pkg:engine/render/TOCGenerator.ts',
  'pkg:engine/render/BookmarkRenderer.ts',
  'pkg:engine/DocumentDiffer.ts',
  'pkg:engine/document/selection/SelectionCollector.ts',
  'pkg:lib/documentExport.ts',
  // 导出特性层的新模块 —— 它们读取文档, 必须走 W2/W3/R1 而不是自己遍历 body
  'pkg:lib/export/fields.ts',
  'pkg:lib/export/elementsExport.ts',
  'pkg:lib/export/cdaExport.ts',
  'pkg:lib/export/ofd/ofdModel.ts',
  'pkg:lib/export/ofd/ofdXml.ts',
  'pkg:lib/export/ofd/buildOfd.ts',
  // 应用侧必须仍在扫描范围内 —— 否则"全仓遍历口径"就只是包内约定
  'app:components/editor/EditorProvider.tsx',
  'app:pages/EditorPage.tsx',
]

/**
 * 白名单 —— 这些文件的 `doc.body.children` 是**结构语义**, 契约 §31.1 明确保留。
 *
 * 除 SelectionCollector (遍历器本体) 外, 每一项都对应契约 §31.2 的 Q9
 * 「绝对不能使用 W2/W3 代替原始结构树的场景」。
 */
const STRUCTURE_EXEMPT = new Map<string, string>([
  ['pkg:engine/document/selection/SelectionCollector.ts',
    '遍历器本体 (契约 §31.3 W1–W4 / R1–R2 的唯一实现)'],
  ['pkg:engine/document/io/DocumentSerializer.ts',
    '序列化: collectDocumentNodes 必须走真结构, 否则 Section 节点丢失 (§31.2 Q9①)'],
  ['pkg:engine/document/io/DocumentLoader.ts',
    '加载: 引用校验 / buildPool 走真结构 (§14 / §31.2 Q9①)'],
  ['pkg:engine/document/version/ModelUpgrader.ts',
    '版本迁移: 直接改写 body.children 的数据迁移路径 (§14)'],
  ['pkg:engine/state/CaretScope.ts',
    'R2: 段落区域 + **真实兄弟数组** (结构命令需要真兄弟真下标, §31.2 Q9②)'],
])

/** 去掉块注释 / 行注释, 保留换行与长度 (行号一致) */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '))
}

/** 去掉字符串字面量 —— 'field_exists:body.children' 这类规则名不是遍历 */
function stripStrings(src: string): string {
  return src
    .replace(/'(?:[^'\\\n]|\\.)*'/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/"(?:[^"\\\n]|\\.)*"/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/`(?:[^`\\]|\\.)*`/g, (m) => m.replace(/[^\n]/g, ' '))
}

function lineOf(src: string, index: number): number {
  let n = 1
  for (let i = 0; i < index; i++) if (src[i] === '\n') n++
  return n
}

/**
 * 扫描器本体 —— 单独抽出, 便于用注入源码证明它真的会红。
 *
 * 判据: 剥离注释与字符串后仍出现 `doc.body.children`, **且该出现不是赋值目标**。
 *
 *   - 读 (`doc.body.children` 后接 `.` / `[` / 标识符 / 分号) = 遍历 → 违规
 *   - 写 (`doc.body.children = [...]`) = 构造 / 数据迁移 → 不是遍历
 *     (仅两处: Editor 空文档构造与 ModelUpgrader 的 v2→v3 迁移, 后者在白名单)
 *
 * 结构语义的合法读法 (`.length` / `.indexOf(`) 只出现在白名单文件里, 故这里不必
 * 再按调用形态区分 —— 白名单即"这处是结构语义"的显式声明。
 */
export function scanForbiddenBodyTraversal(
  file: string,
  src: string,
): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = []
  const code = stripStrings(stripComments(src))
  const re = /\bdoc\.body\.children\b(?!\s*=(?!=))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    hits.push({ file, line: lineOf(code, m.index), text: m[0] })
  }
  return hits
}

const SCANNED = FILES.filter((f) => !STRUCTURE_EXEMPT.has(f))
const hits = SCANNED.flatMap((f) => scanForbiddenBodyTraversal(f, sources[f]))

const fmt = (h: { file: string; line: number; text: string }) => `${h.file}:${h.line} ${h.text}`

describe('DocumentWalkGate — 扫描覆盖', () => {
  it('闸门必须扫到全部源文件 (漏扫比没闸门更危险)', () => {
    expect(FILES.length).toBeGreaterThan(150)
    for (const must of MUST_SCAN) {
      expect(FILES).toContain(must)
    }
    // 关键消费点必须落在**被扫**的一侧, 而不是靠白名单绕过
    for (const must of MUST_SCAN) {
      if (must.endsWith('SelectionCollector.ts')) continue
      expect(SCANNED, `${must} 不应在白名单里`).toContain(must)
    }
  })

  it('白名单文件真实存在 (删了文件却留着白名单 = 白名单在保护空气)', () => {
    for (const f of STRUCTURE_EXEMPT.keys()) {
      expect(FILES).toContain(f)
    }
  })

  it('两个根都真的扫到了 (跨 root 遍历坏掉时会静默变成"只扫一半")', () => {
    expect(FILES.some((f) => f.startsWith('app:'))).toBe(true)
    expect(FILES.some((f) => f.startsWith('pkg:'))).toBe(true)
  })
})

describe('DocumentWalkGate — 遍历口径', () => {
  it('walker 模块之外不得遍历 doc.body.children (契约 §31.1)', () => {
    expect(
      hits.map(fmt),
      '逻辑流遍历必须走 SelectionCollector 的 W1–W4; 结构语义请显式加入白名单并写明理由',
    ).toEqual([])
  })
})

describe('DocumentWalkGate — 扫描器有效性', () => {
  it('对注入的越权遍历必须报警 (证明闸门不是空断言)', () => {
    const injected = [
      'function bad(doc) {',
      '  for (const id of doc.body.children) {',
      '    console.log(id)',
      '  }',
      '}',
    ].join('\n')
    const found = scanForbiddenBodyTraversal('pkg:engine/injected.ts', injected)
    expect(found.map((h) => h.line)).toEqual([2])
  })

  it('注释与字符串里的 doc.body.children 不误报', () => {
    const benign = [
      "// 旧实现用 doc.body.children.indexOf, 已废弃",
      "const RULE = 'field_exists:body.children'",
      '/* doc.body.children */',
    ].join('\n')
    expect(scanForbiddenBodyTraversal('pkg:engine/benign.ts', benign)).toEqual([])
  })
})
