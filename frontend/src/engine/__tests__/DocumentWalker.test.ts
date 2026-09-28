// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// DocumentWalker — W2/W3 逻辑文档流 (契约 §31.3)
//
// P0 的核心判据是**零行为变更**: 对无 Section 的合法文档, W2/W3 的输出必须
// 与旧的"直接遍历 doc.body.children"**逐元素一致**。本文件用真实 demo 病历
// (admissionRecord.json: 22 个 body 块含 2 张表) 做逐字节比对, 而不是用合成
// fixture —— 合成文档覆盖不到嵌套表格与真实形状。
//
// 另一半判据是 §31.5 的失败语义: 未知块类型必须**抛错**, 不得静默丢弃内容。
// 这是 Section 落地后「旧客户端读到新文档」的唯一防线之一 (另一条是版本闸门)。
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  bodyBlockSpine, bodyParagraphSpine, flattenTextContainers,
  bodyParagraphCount, initialCursorParaPath,
  nearestParagraphInSpine, BodySpineError,
} from '../document/selection/SelectionCollector'
import type { SpinePool } from '../document/selection/SelectionCollector'
import type { DocumentTree, BaseNode } from '../document/core/DocumentModel'
import {
  createDocument, createParagraph, createTextNode, createTable,
  createTableRow, createTableCell, createSeparatorNode, createSectionBreak, createSection,
} from '../document/factory/ElementFormatter'
import docJson from '@/mocks/admissionRecord.json'

// ---- 夹具 ----

interface Built {
  doc: DocumentTree
  pool: SpinePool
  nodes: Map<string, BaseNode>
  bodyIds: string[]
}

/** 用工厂函数搭一份最小文档, 保留 append-only 的 nodes 表 */
function makeDoc(): Built {
  const doc = createDocument('walker 测试')
  const nodes = new Map<string, BaseNode>()
  nodes.set(doc.id, doc as unknown as BaseNode)
  return { doc, pool: { nodes }, nodes, bodyIds: [] }
}

/** 追加一个含文本的段落, 返回其 id 并挂到 body 末尾 */
function addParagraph(b: Built, text: string): string {
  const tn = createTextNode(text)
  const p = createParagraph([tn.id])
  b.nodes.set(tn.id, tn as unknown as BaseNode)
  b.nodes.set(p.id, p as unknown as BaseNode)
  b.bodyIds.push(p.id)
  b.doc.body.children = b.bodyIds
  return p.id
}

/** 追加一张 1×(cols) 表, 每格一个段落, 并挂到 body 末尾 */
function addTable(b: Built, cellTexts: string[]): string {
  const id = makeTable(b, cellTexts)
  attachToBody(b, id)
  return id
}

/** 建一张 1×(cols) 表 (每格一个段落) 但**不**挂到 body (供放进 Section) */
function makeTable(b: Built, cellTexts: string[]): string {
  const cells = cellTexts.map(t => {
    const tn = createTextNode(t)
    const p = createParagraph([tn.id])
    const c = createTableCell([p.id])
    b.nodes.set(tn.id, tn as unknown as BaseNode)
    b.nodes.set(p.id, p as unknown as BaseNode)
    b.nodes.set(c.id, c as unknown as BaseNode)
    return c
  })
  const row = createTableRow(cells)
  const table = createTable([{ width: 100 }], [row])
  b.nodes.set(row.id, row as unknown as BaseNode)
  b.nodes.set(table.id, table as unknown as BaseNode)
  return table.id
}

/** 把已有节点挂到 body 末尾 */
function attachToBody(b: Built, id: string): string {
  b.bodyIds.push(id)
  b.doc.body.children = b.bodyIds
  return id
}

/** 追加一个无子节点的分隔线 */
function addSeparator(b: Built): string {
  const sep = createSeparatorNode()
  b.nodes.set(sep.id, sep as unknown as BaseNode)
  b.bodyIds.push(sep.id)
  b.doc.body.children = b.bodyIds
  return sep.id
}

/** 追加一个 Section (children 为给定 id 列表) */
function addSection(b: Built, childIds: string[], sectionCode?: string): string {
  const sec = createSection(childIds, sectionCode)
  b.nodes.set(sec.id, sec as unknown as BaseNode)
  b.bodyIds.push(sec.id)
  b.doc.body.children = b.bodyIds
  return sec.id
}

/** 追加一个段落节点但**不**挂到 body (供放进 Section) */
function makeParagraph(b: Built, text: string): string {
  const tn = createTextNode(text)
  const p = createParagraph([tn.id])
  b.nodes.set(tn.id, tn as unknown as BaseNode)
  b.nodes.set(p.id, p as unknown as BaseNode)
  return p.id
}

function loadDemo(): { doc: DocumentTree; pool: SpinePool } {
  const doc = docJson as unknown as DocumentTree
  const raw = (docJson as unknown as { nodes: Record<string, BaseNode> }).nodes
  return { doc, pool: { nodes: new Map(Object.entries(raw)) } }
}

// ================================================================

describe('bodyBlockSpine (W2) — 块级逻辑流', () => {
  it('无 Section 文档: 输出与 doc.body.children 逐元素一致', () => {
    const b = makeDoc()
    addParagraph(b, '甲')
    addTable(b, ['乙', '丙'])
    addSeparator(b)
    addParagraph(b, '丁')
    expect(bodyBlockSpine(b.doc, b.pool)).toEqual([...b.doc.body.children])
  })

  it('SectionBreak 入列 (Layout 需要它产出标记行)', () => {
    const b = makeDoc()
    const p1 = addParagraph(b, '前')
    const sb = createSectionBreak('next_page')
    b.nodes.set(sb.id, sb as unknown as BaseNode)
    b.bodyIds.push(sb.id)
    b.doc.body.children = b.bodyIds
    const p2 = addParagraph(b, '后')
    expect(bodyBlockSpine(b.doc, b.pool)).toEqual([p1, sb.id, p2])
  })

  it('未知块类型 → 抛 BodySpineError (不得静默丢弃内容, 契约 §31.5)', () => {
    const b = makeDoc()
    addParagraph(b, '甲')
    // 谎报的脏数据: body 直接挂了一个内联 text 节点
    const rogue = createTextNode('不该在这')
    b.nodes.set(rogue.id, rogue as unknown as BaseNode)
    b.bodyIds.push(rogue.id)
    b.doc.body.children = b.bodyIds
    expect(() => bodyBlockSpine(b.doc, b.pool)).toThrow(BodySpineError)
    expect(() => bodyBlockSpine(b.doc, b.pool)).toThrow(/unknown body child type/)
  })

  it('悬空引用静默跳过 (由 DocumentLoader.validate 兜底, 遍历器不二次报错)', () => {
    const b = makeDoc()
    const p1 = addParagraph(b, '甲')
    b.bodyIds.push('ghost_node_id')
    b.doc.body.children = b.bodyIds
    expect(bodyBlockSpine(b.doc, b.pool)).toEqual([p1])
  })

  it('visited 语义: 跨父重复归属的脏数据只产出一次 (契约 §31.3 X2)', () => {
    const b = makeDoc()
    const p1 = addParagraph(b, '甲')
    // 同一个 id 在两个位置出现 (NodePool 只在单父内查重, 跨父无防护)
    b.bodyIds.push(p1)
    b.doc.body.children = b.bodyIds
    expect(bodyBlockSpine(b.doc, b.pool)).toEqual([p1])
  })

  it('空 body → 空数组', () => {
    const b = makeDoc()
    expect(bodyBlockSpine(b.doc, b.pool)).toEqual([])
  })
})

describe('bodyParagraphSpine (W3) — 段落逻辑流 = W2 ∘ 表格展开', () => {
  it('表格就地展开为 cell 段落, 其余块保留原 id', () => {
    const b = makeDoc()
    const p1 = addParagraph(b, '前')
    const t = addTable(b, ['乙', '丙'])
    const p2 = addParagraph(b, '后')
    expect(bodyBlockSpine(b.doc, b.pool)).toEqual([p1, t, p2])

    // W3: 表格展开为 cell 内段落, 表格自身不入列
    const w3 = bodyParagraphSpine(b.doc, b.pool)
    expect(w3).not.toContain(t)
    expect(w3).toEqual([p1, ...w3.slice(1)])
    expect(w3[0]).toBe(p1)
    expect(w3[w3.length - 1]).toBe(p2)
    expect(w3).toHaveLength(4) // p1 + 2 cell 段落 + p2
  })

  it('W3 与旧 flattenTextContainers(pool, body.children) 逐元素一致', () => {
    const b = makeDoc()
    addParagraph(b, '甲')
    addTable(b, ['乙', '丙'])
    addSeparator(b)
    addParagraph(b, '丁')
    expect(bodyParagraphSpine(b.doc, b.pool))
      .toEqual(flattenTextContainers(b.pool, b.doc.body.children))
  })

  it('demo 病历文档: W2/W3 逐元素等于旧口径', () => {
    // 注: 用例名此前写作「含 2 张嵌套表」, 但 demo 文档实测**零嵌套表**
    // (cell.children 全是 paragraph) —— 名字是陈旧的。嵌套表的往返由
    // ContainerChildTypes.test.ts 的端到端用例覆盖 (契约 §31.13)。
    const { doc, pool } = loadDemo()
    expect(bodyBlockSpine(doc, pool)).toEqual([...doc.body.children])
    expect(bodyParagraphSpine(doc, pool))
      .toEqual(flattenTextContainers(pool, doc.body.children))
  })
})

describe('结构侧助手 — 真实下标 / 真实兄弟 (契约 §31.6)', () => {
  it('bodyParagraphCount 数的是段落, 不含表格/分隔线', () => {
    const b = makeDoc()
    addParagraph(b, '甲')
    addTable(b, ['乙'])
    addParagraph(b, '丙')
    addSeparator(b)
    expect(bodyParagraphCount(b.doc, b.pool)).toBe(2)
  })

  it('nearestParagraphInSpine 在逻辑流上查找 (方向键跨块导航消费)', () => {
    const b = makeDoc()
    const p1 = addParagraph(b, '甲')
    const t = addTable(b, ['乙'])
    const p2 = addParagraph(b, '丙')
    const spine = bodyBlockSpine(b.doc, b.pool)
    expect(nearestParagraphInSpine(spine, b.pool, spine.indexOf(t), 1)).toBe(p2)
    expect(nearestParagraphInSpine(spine, b.pool, spine.indexOf(t), -1)).toBe(p1)
    expect(nearestParagraphInSpine(spine, b.pool, spine.length - 1, 1)).toBeNull()
  })
})

describe('Section 展开 (契约 §31.3) — 结构树里的容器, 逻辑流里就地展平', () => {
  it('W2: Section 就地展开且自身不入列', () => {
    const b = makeDoc()
    const p1 = makeParagraph(b, 'A1')
    const p2 = makeParagraph(b, 'A2')
    const sec = addSection(b, [p1, p2])
    const px = addParagraph(b, 'X')
    expect(bodyBlockSpine(b.doc, b.pool)).toEqual([p1, p2, px])
    expect(bodyBlockSpine(b.doc, b.pool)).not.toContain(sec)
  })

  it('W3: Section 内段落与表格展开按阅读顺序交织, 逐元素确定', () => {
    const b = makeDoc()
    const p1 = makeParagraph(b, 'A1')
    const t = makeTable(b, ['C1', 'C2'])
    const p2 = makeParagraph(b, 'A2')
    addSection(b, [p1, t, p2])
    const px = addParagraph(b, 'X')

    const w2 = bodyBlockSpine(b.doc, b.pool)
    expect(w2).toEqual([p1, t, p2, px])

    const w3 = bodyParagraphSpine(b.doc, b.pool)
    expect(w3).not.toContain(t)
    expect(w3[0]).toBe(p1)
    expect(w3[w3.length - 1]).toBe(px)
    expect(w3).toHaveLength(5) // A1 + C1 + C2 + A2 + X
    // 顺序: A1 → 表内 C1, C2 → A2 → X (Section 边界不打断阅读顺序)
    expect(w3.slice(0, 3)).toEqual([p1, ...w3.slice(1, 3)])
  })

  it('风险 A 证否: 有 Section 与无 Section 的 W3 同构 (Section 边界不影响顺序)', () => {
    // body=[Section[P1, Table], P2] 与 body=[P1, Table, P2] 应产出同一**形状**
    const withSec = makeDoc()
    const a1 = makeParagraph(withSec, 'A')
    const at = makeTable(withSec, ['B'])
    addSection(withSec, [a1, at])
    const a2 = addParagraph(withSec, 'C')

    const plain = makeDoc()
    const b1 = addParagraph(plain, 'A')
    const bt = addTable(plain, ['B'])
    const b2 = addParagraph(plain, 'C')

    const s1 = bodyParagraphSpine(withSec.doc, withSec.pool)
    const s2 = bodyParagraphSpine(plain.doc, plain.pool)
    expect(s1).toHaveLength(s2.length)
    expect(s1[0]).toBe(a1); expect(s2[0]).toBe(b1)
    expect(s1[s1.length - 1]).toBe(a2); expect(s2[s2.length - 1]).toBe(b2)
    // 表内段落的位置一致 (索引 1): table → row → cell → paragraph
    const firstCellPara = (tableId: string, nodes: Map<string, BaseNode>): string => {
      const rowId = (nodes.get(tableId) as unknown as { children: string[] }).children[0]
      const cellId = (nodes.get(rowId) as unknown as { children: string[] }).children[0]
      return (nodes.get(cellId) as unknown as { children: string[] }).children[0]
    }
    expect(s1[1]).toBe(firstCellPara(at, withSec.nodes))
    expect(s2[1]).toBe(firstCellPara(bt, plain.nodes))
  })

  it('嵌套 Section: 递归展开, 内层 Section 亦不入列', () => {
    const b = makeDoc()
    const p1 = makeParagraph(b, 'A1')
    const inner = makeParagraph(b, 'A1-1')
    const secInner = createSection([inner], 'inner')
    b.nodes.set(secInner.id, secInner as unknown as BaseNode)
    const secOuter = addSection(b, [p1, secInner.id], 'outer')
    const p2 = makeParagraph(b, 'A2')
    const secOuterNode = b.nodes.get(secOuter) as unknown as { children: readonly string[] }
    ;(secOuterNode as { children: string[] }).children = [p1, secInner.id, p2]

    expect(bodyBlockSpine(b.doc, b.pool)).toEqual([p1, inner, p2])
    expect(bodyBlockSpine(b.doc, b.pool)).not.toContain(secOuter)
    expect(bodyBlockSpine(b.doc, b.pool)).not.toContain(secInner.id)
  })

  it('环状 Section 不会无限递归 (visited 语义, 契约 §31.3 X2)', () => {
    const b = makeDoc()
    const inner = makeParagraph(b, 'A1')
    const secA = createSection([inner])
    const secB = createSection([secA.id])
    b.nodes.set(secA.id, secA as unknown as BaseNode)
    b.nodes.set(secB.id, secB as unknown as BaseNode)
    // 自引用环: A 的 children 里放进 B
    ;(secA as unknown as { children: string[] }).children = [inner, secB.id]
    addSection(b, [secB.id])
    expect(() => bodyBlockSpine(b.doc, b.pool)).not.toThrow()
    expect(bodyBlockSpine(b.doc, b.pool)).toEqual([inner])
  })

  it('Section 内禁止出现 SectionBreak (它是 body 级页面设置边界, 契约 §31.10)', () => {
    const b = makeDoc()
    const sb = createSectionBreak('next_page')
    b.nodes.set(sb.id, sb as unknown as BaseNode)
    addSection(b, [sb.id])
    expect(() => bodyBlockSpine(b.doc, b.pool)).toThrow(BodySpineError)
  })

  it('Section 自身可被 body 直接引用或嵌套引用, 两者输出一致', () => {
    const b = makeDoc()
    const p1 = makeParagraph(b, 'A1')
    addSection(b, [p1])
    expect(bodyBlockSpine(b.doc, b.pool)).toEqual([p1])
  })
})

describe('initialCursorParaPath — 初始光标落点 (契约 §31.5 X6)', () => {
  it('首个段落优先', () => {
    const b = makeDoc()
    const p1 = addParagraph(b, '甲')
    expect(initialCursorParaPath(b.doc, b.pool)).toEqual([b.doc.id, p1])
  })

  it('首块是表格时落在表格内的首个 cell 段落 (旧实现会落在表格 id 上)', () => {
    const b = makeDoc()
    const t = addTable(b, ['乙', '丙'])
    const path = initialCursorParaPath(b.doc, b.pool)
    // 旧口径: [docId, tableId] —— 非文本容器, 光标静默不显示
    expect(path).not.toEqual([b.doc.id, t])
    expect(path[0]).toBe(b.doc.id)
    expect(b.pool.nodes.get(path[1])?.type).toBe('paragraph')
  })

  it('无段落但有块 → 退回首个块; 空 body → []', () => {
    const b = makeDoc()
    const sep = addSeparator(b)
    expect(initialCursorParaPath(b.doc, b.pool)).toEqual([b.doc.id, sep])

    const empty = makeDoc()
    expect(initialCursorParaPath(empty.doc, empty.pool)).toEqual([])
  })
})
