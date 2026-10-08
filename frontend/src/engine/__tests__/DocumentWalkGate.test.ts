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
// ============================================================

import { describe, it, expect } from 'vitest'

const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  as: 'raw',
  eager: true,
}) as Record<string, string>

const FILES = Object.keys(sources)
  .filter((f) => !f.includes('/__tests__/') && !f.endsWith('.d.ts'))
  .sort()

/** 闸门必须真的扫到这些文件, 否则下面的断言是假通过 */
const MUST_SCAN = [
  '/src/engine/Editor.ts',
  '/src/engine/layout/core/LayoutEngine.ts',
  '/src/engine/interaction/KeyboardHandler.ts',
  '/src/engine/interaction/MouseHandler.ts',
  '/src/engine/qc/QCEngine.ts',
  '/src/engine/render/Draw.ts',
  '/src/engine/render/TOCGenerator.ts',
  '/src/engine/render/BookmarkRenderer.ts',
  '/src/engine/DocumentDiffer.ts',
  '/src/engine/document/selection/SelectionCollector.ts',
  '/src/lib/documentExport.ts',
  // 导出特性层的新模块 —— 它们读取文档, 必须走 W2/W3/R1 而不是自己遍历 body
  '/src/lib/export/fields.ts',
  '/src/lib/export/elementsExport.ts',
  '/src/lib/export/cdaExport.ts',
  '/src/lib/export/ofd/ofdModel.ts',
  '/src/lib/export/ofd/ofdXml.ts',
  '/src/lib/export/ofd/buildOfd.ts',
]

/**
 * 白名单 —— 这些文件的 `doc.body.children` 是**结构语义**, 契约 §31.1 明确保留。
 *
 * 除 SelectionCollector (遍历器本体) 外, 每一项都对应契约 §31.2 的 Q9
 * 「绝对不能使用 W2/W3 代替原始结构树的场景」。
 */
const STRUCTURE_EXEMPT = new Map<string, string>([
  ['/src/engine/document/selection/SelectionCollector.ts',
    '遍历器本体 (契约 §31.3 W1–W4 / R1–R2 的唯一实现)'],
  ['/src/engine/document/io/DocumentSerializer.ts',
    '序列化: collectDocumentNodes 必须走真结构, 否则 Section 节点丢失 (§31.2 Q9①)'],
  ['/src/engine/document/io/DocumentLoader.ts',
    '加载: 引用校验 / buildPool 走真结构 (§14 / §31.2 Q9①)'],
  ['/src/engine/document/version/ModelUpgrader.ts',
    '版本迁移: 直接改写 body.children 的数据迁移路径 (§14)'],
  ['/src/engine/state/CaretScope.ts',
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
    const found = scanForbiddenBodyTraversal('/src/engine/injected.ts', injected)
    expect(found.map((h) => h.line)).toEqual([2])
  })

  it('注释与字符串里的 doc.body.children 不误报', () => {
    const benign = [
      "// 旧实现用 doc.body.children.indexOf, 已废弃",
      "const RULE = 'field_exists:body.children'",
      '/* doc.body.children */',
    ].join('\n')
    expect(scanForbiddenBodyTraversal('/src/engine/benign.ts', benign)).toEqual([])
  })
})
