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
  bodyIndexOf, bodyParagraphCount, initialCursorParaPath,
  nearestParagraphInBody, nearestParagraphInSpine, BodySpineError,
} from '../document/selection/SelectionCollector'
import type { SpinePool } from '../document/selection/SelectionCollector'
import type { DocumentTree, BaseNode } from '../document/core/DocumentModel'
import {
  createDocument, createParagraph, createTextNode, createTable,
  createTableRow, createTableCell, createSeparatorNode, createSectionBreak,
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

/** 追加一张 1×(cols) 表, 每格一个段落 */
function addTable(b: Built, cellTexts: string[]): string {
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
  b.bodyIds.push(table.id)
  b.doc.body.children = b.bodyIds
  return table.id
}

/** 追加一个无子节点的分隔线 */
function addSeparator(b: Built): string {
  const sep = createSeparatorNode()
  b.nodes.set(sep.id, sep as unknown as BaseNode)
  b.bodyIds.push(sep.id)
  b.doc.body.children = b.bodyIds
  return sep.id
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

  it('demo 病历文档 (含 2 张嵌套表): W2/W3 逐元素等于旧口径', () => {
    const { doc, pool } = loadDemo()
    expect(bodyBlockSpine(doc, pool)).toEqual([...doc.body.children])
    expect(bodyParagraphSpine(doc, pool))
      .toEqual(flattenTextContainers(pool, doc.body.children))
  })
})

describe('结构侧助手 — 真实下标 / 真实兄弟 (契约 §31.6)', () => {
  it('bodyIndexOf 返回真实结构下标', () => {
    const b = makeDoc()
    const p1 = addParagraph(b, '甲')
    const t = addTable(b, ['乙'])
    const p2 = addParagraph(b, '丙')
    expect(bodyIndexOf(b.doc, p1)).toBe(0)
    expect(bodyIndexOf(b.doc, t)).toBe(1)
    expect(bodyIndexOf(b.doc, p2)).toBe(2)
    expect(bodyIndexOf(b.doc, 'nope')).toBe(-1)
  })

  it('bodyParagraphCount 数的是段落, 不含表格/分隔线', () => {
    const b = makeDoc()
    addParagraph(b, '甲')
    addTable(b, ['乙'])
    addParagraph(b, '丙')
    addSeparator(b)
    expect(bodyParagraphCount(b.doc, b.pool)).toBe(2)
  })

  it('nearestParagraphInBody 先向后、找不到再向前', () => {
    const b = makeDoc()
    const p1 = addParagraph(b, '甲')
    addTable(b, ['乙'])
    const p2 = addParagraph(b, '丙')
    // 从表格的下标 (1) 向后 → p2; 向前 → p1
    expect(nearestParagraphInBody(b.doc, b.pool, 1, 1)).toBe(p2)
    expect(nearestParagraphInBody(b.doc, b.pool, 1, -1)).toBe(p1)
    // 边界: 末尾向后 → null
    expect(nearestParagraphInBody(b.doc, b.pool, 2, 1)).toBeNull()
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
