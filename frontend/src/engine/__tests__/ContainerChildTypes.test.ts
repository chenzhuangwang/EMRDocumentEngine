// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ContainerChildTypes — 契约 §31.13「容器子类型契约」
//
// 这条规则此前**没有任何地方声明过**, 每个消费者各猜一套, 结果同一个格内
// Section 让三个遍历器给出三种互相矛盾的答案 (W3 当它是段落 / W4 看不见它 /
// R1 却能找到它)。本文件把"声明 + 三处边界执行 + 嵌套表真正跑通"全部钉成
// CI 会红的事实。
//
// 三处边界各有其职 (契约 §31.13):
//   NodePool  → enforcement: 命令层建不出非法结构
//   Loader    → load:  非法持久化文档在可用之前被拒
//   Importer  → import: 外部模板在解析期被拒, 消息指出容器与类型
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  CHILD_TYPES_OF, HEADER_FOOTER_CHILD_TYPES, DEFERRED_INLINE_CHILD_TYPES,
  isLegalChild, assertLegalChild, childTypesOf, ContainerChildTypeError,
} from '../document/core/ContainerChildTypes'
import { NodeType } from '../document/core/DocumentModel'
import { TemplateImporter } from '../import/TemplateImporter'
import { loadDocumentFromObject } from '../document/io/DocumentLoader'
import { serializeDocument } from '../document/io/DocumentSerializer'
import { buildNodePool } from '../document/core/NodePool'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { testMeasurer } from './helpers'
import { bodyParagraphSpine, sectionsOf, sectionOf } from '../document/selection/SelectionCollector'
import { getFlatPageItems } from '../layout/core/SLIF'
import { buildExportText } from '@/lib/documentExport'
import {
  createDocument, createParagraph, createTextNode,
  createTable, createTableRow, createTableCell, createSection,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'

// ---- 夹具 ----

/** 一个可以被放进任意容器的段落 */
function mkParagraph(all: Map<string, BaseNode>, text: string) {
  const t = createTextNode(text)
  const p = createParagraph([t.id])
  all.set(t.id, t as unknown as BaseNode)
  all.set(p.id, p as unknown as BaseNode)
  return p
}

/**
 * table(1×1) → row → cell → [传入的子块...]。
 * 返回连同 cell/row/table 一起注册好的 id, 供"往 cell 里放什么"的用例复用。
 */
function mkTableWithCellChildren(
  all: Map<string, BaseNode>,
  childIds: readonly string[],
) {
  const cell = createTableCell([...childIds])
  const row = createTableRow([cell])
  const table = createTable([{ width: 100, mode: 'percentage' }], [row])
  for (const n of [table, row, cell]) all.set(n.id, n as unknown as BaseNode)
  return { table, row, cell }
}

/** 走真实序列化链路加载 (校验 validateStructure) */
function roundTrip(doc: DocumentTree, all: Map<string, BaseNode>) {
  const pool = buildNodePool(all, { body: doc.id })
  return loadDocumentFromObject(JSON.parse(serializeDocument(doc, pool)))
}

// ---- 外部模板 (导入器边界) ----

function extDoc(bodyChildren: unknown[], headerChildren?: unknown[]) {
  return {
    title: '外部模板',
    document: {
      ...(headerChildren ? { header: { type: '$root', children: headerChildren } } : {}),
      body: { type: '$root', children: bodyChildren },
    },
  }
}

function extTable(cellChildren: unknown[]) {
  return {
    id: 'tb-1', type: 'table',
    children: [
      { id: 'cg-1', type: 'colgroup', children: [{ id: 'c-1', type: 'col' }] },
      {
        id: 'tbody-1', type: 'tablebody',
        children: [{
          id: 'row-1', type: 'row',
          children: [{ id: 'cell-1', type: 'cell', children: cellChildren }],
        }],
      },
    ],
  }
}

const EXT_SECTION = {
  id: 'sec-1', type: 'section', code: 'x',
  children: [{ id: 'p-1', type: 'paragraph', children: [{ id: 't-1', type: 'text', data: '格内节' }] }],
}

const EXT_NESTED_TABLE = {
  id: 'tb-2', type: 'table',
  children: [
    { id: 'cg-2', type: 'colgroup', children: [{ id: 'c-2', type: 'col' }] },
    {
      id: 'tbody-2', type: 'tablebody',
      children: [{
        id: 'row-2', type: 'row',
        children: [{
          id: 'cell-2', type: 'cell',
          children: [{ id: 'p-9', type: 'paragraph', children: [{ id: 't-9', type: 'text', data: '格中格' }] }],
        }],
      }],
    },
  ],
}

// ================================================================

describe('契约表本身 (契约 §31.13)', () => {
  it('cell 允许 paragraph + table, 不含 section', () => {
    const cell = childTypesOf(NodeType.CELL)
    expect(cell.has(NodeType.PARAGRAPH)).toBe(true)
    expect(cell.has(NodeType.TABLE)).toBe(true)
    expect(cell.has(NodeType.SECTION)).toBe(false)
  })

  it('Section 只能出现在 body 或 Section 下', () => {
    expect(isLegalChild(NodeType.DOCUMENT, NodeType.SECTION)).toBe(true)
    expect(isLegalChild(NodeType.SECTION, NodeType.SECTION)).toBe(true)
    expect(isLegalChild(NodeType.CELL, NodeType.SECTION)).toBe(false)
    expect(isLegalChild(NodeType.ROW, NodeType.SECTION)).toBe(false)
    expect(isLegalChild(NodeType.TABLE, NodeType.SECTION)).toBe(false)
  })

  it('SECTION_BREAK 是 body 级分页边界, 不进 Section (契约 §31.10)', () => {
    expect(isLegalChild(NodeType.DOCUMENT, NodeType.SECTION_BREAK)).toBe(true)
    expect(isLegalChild(NodeType.SECTION, NodeType.SECTION_BREAK)).toBe(false)
  })

  it('table→row→cell 是唯一的单向链', () => {
    expect(isLegalChild(NodeType.TABLE, NodeType.ROW)).toBe(true)
    expect(isLegalChild(NodeType.ROW, NodeType.CELL)).toBe(true)
    expect(isLegalChild(NodeType.ROW, NodeType.PARAGRAPH)).toBe(false)
    expect(isLegalChild(NodeType.TABLE, NodeType.PARAGRAPH)).toBe(false)
  })

  it('页眉/页脚只允许 paragraph', () => {
    expect(HEADER_FOOTER_CHILD_TYPES.has(NodeType.PARAGRAPH)).toBe(true)
    expect(HEADER_FOOTER_CHILD_TYPES.has(NodeType.TABLE)).toBe(false)
    expect(HEADER_FOOTER_CHILD_TYPES.has(NodeType.SECTION)).toBe(false)
  })

  it('未声明契约的父类型不予判定 (paragraph 内联本轮 deferred)', () => {
    // paragraph 刻意**不在** CHILD_TYPES_OF 里 —— 表里只放已被边界强制的东西
    expect(CHILD_TYPES_OF.has(NodeType.PARAGRAPH)).toBe(false)
    expect(isLegalChild(NodeType.PARAGRAPH, 'anything')).toBe(true)
    expect(DEFERRED_INLINE_CHILD_TYPES.has(NodeType.TEXT)).toBe(true)
  })

  it('childTypesOf 对无契约的容器抛错 (问错了容器是编程错误)', () => {
    expect(() => childTypesOf(NodeType.PARAGRAPH)).toThrow(/no child-type contract/)
  })

  it('assertLegalChild 非法时抛 ContainerChildTypeError 并带上两方 id', () => {
    try {
      assertLegalChild(NodeType.CELL, NodeType.SECTION, 'cell-1', 'sec-1')
      expect.unreachable('应当抛错')
    } catch (e) {
      expect(e).toBeInstanceOf(ContainerChildTypeError)
      expect((e as ContainerChildTypeError).parentId).toBe('cell-1')
      expect((e as ContainerChildTypeError).childId).toBe('sec-1')
    }
  })
})

describe('边界一: TemplateImporter', () => {
  const importer = new TemplateImporter()

  it('cell 含 section → 抛"非法嵌套"', () => {
    expect(() => importer.import(extDoc([extTable([EXT_SECTION])]) as never))
      .toThrow(/非法嵌套|illegal nesting/)
  })

  it('cell 含 table → 放行 (嵌套表合法)', () => {
    const r = importer.import(extDoc([extTable([EXT_NESTED_TABLE])]) as never)
    expect(r.nodes.get('tb-2')?.type).toBe(NodeType.TABLE)
    expect((r.nodes.get('cell-1') as unknown as { children: string[] }).children).toEqual(['tb-2'])
  })

  it('页眉含 table → 抛"非法嵌套"', () => {
    expect(() => importer.import(
      extDoc([{ id: 'p-0', type: 'paragraph', children: [] }], [extTable([])]) as never,
    )).toThrow(/非法嵌套|illegal nesting/)
  })

  it('未知块类型仍报"未知块类型", 与非法嵌套是两个不同的诊断', () => {
    expect(() => importer.import(
      extDoc([extTable([{ id: 'x', type: 'mystery_block', children: [] }])]) as never,
    )).toThrow(/未知块类型|unknown block type/)
  })
})

describe('边界二: DocumentLoader', () => {
  it('持久化文档含格内 Section → 拒绝加载', () => {
    const doc = createDocument('t')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)
    const sec = createSection([], 'x')
    all.set(sec.id, sec as unknown as BaseNode)
    const { table } = mkTableWithCellChildren(all, [sec.id])
    doc.body.children = [table.id]

    expect(() => roundTrip(doc, all)).toThrow(/非法容器子类型|illegal container child type/)
  })

  it('页眉含非段落 → 拒绝加载', () => {
    const doc = createDocument('t')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)
    const body = mkParagraph(all, '正文')
    const { table } = mkTableWithCellChildren(all, [])
    doc.body.children = [body.id]
    doc.header = [table.id]

    expect(() => roundTrip(doc, all)).toThrow(/非法容器子类型|illegal container child type/)
  })

  it('格内嵌套表 → 正常加载, 且 W3 不含 table id', () => {
    const doc = createDocument('t')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)

    const innerPara = mkParagraph(all, '格中格')
    const { table: innerTable } = mkTableWithCellChildren(all, [innerPara.id])
    const outerPara = mkParagraph(all, '外层')
    const { table: outerTable } = mkTableWithCellChildren(all, [outerPara.id, innerTable.id])
    doc.body.children = [outerTable.id]

    const r = roundTrip(doc, all)
    const w3 = bodyParagraphSpine(r.doc, r.pool)
    expect(w3).toContain(innerPara.id)
    expect(w3.every(id => r.pool.nodes.get(id)?.type !== NodeType.TABLE)).toBe(true)
    // 三个遍历器对"节"的回答保持一致 —— 格内没有节, 三处都说没有
    expect(sectionsOf(r.doc, r.pool)).toEqual([])
    expect(sectionOf(innerPara.id, r.pool)).toBeNull()
  })
})

describe('边界三: NodePool (enforcement)', () => {
  function poolWith(children: readonly string[]) {
    const doc = createDocument('t')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)
    const { cell } = mkTableWithCellChildren(all, [])
    const sec = createSection([], 'x')
    all.set(sec.id, sec as unknown as BaseNode)
    const para = mkParagraph(all, 'x')
    doc.body.children = children.includes('para') ? [para.id, sec.id] : [sec.id]
    const pool = buildNodePool(all, { body: doc.id })
    return { pool, cell, sec, para }
  }

  it('insertChild: 把 section 插进 cell → 抛错', () => {
    const { pool, cell, sec } = poolWith([])
    expect(() => pool.insertChild(cell.id, sec.id, 0)).toThrow(/illegal child type/)
  })

  it('insertChild: 把 paragraph 插进 cell → 放行', () => {
    const { pool, cell, para } = poolWith(['para'])
    expect(() => pool.insertChild(cell.id, para.id, 0)).not.toThrow()
  })

  it('moveChildTo: 把 section 移进 cell → 抛错 (跨父移动同样受约束)', () => {
    const { pool, cell, sec } = poolWith([])
    expect(() => pool.moveChildTo(sec.id, pool.rootIds.body, cell.id, 0))
      .toThrow(/illegal child type/)
  })
})

describe('嵌套表端到端 (契约 §31.13 的"合法即可用")', () => {
  /** body = [table(1×1); cell = [外层段落, 内层表(1×1; cell = [内层段落])]] */
  function makeNestedTableDoc() {
    const doc = createDocument('nested')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)

    const innerPara = mkParagraph(all, '内层格文本')
    const { table: innerTable } = mkTableWithCellChildren(all, [innerPara.id])
    const outerPara = mkParagraph(all, '外层格文本')
    const { table: outerTable } = mkTableWithCellChildren(all, [outerPara.id, innerTable.id])
    doc.body.children = [outerTable.id]

    const pool = buildNodePool(all, { body: doc.id })
    return { doc, pool, outerTable, innerTable, outerPara, innerPara }
  }

  it('布局: 内层文本上屏 (不再是幻影空行), 且外层行高把嵌套表算进去', () => {
    const { doc, pool, outerTable } = makeNestedTableDoc()
    const engine = new LayoutEngine(new EventBus(), testMeasurer)
    const pages = engine.fullLayout(doc, pool)

    const tableItem = pages.flatMap(p => p.items).find(i => i.nodeId === outerTable.id)
    expect(tableItem).toBeDefined()
    const serialized = JSON.stringify(tableItem)
    expect(serialized).toContain('外层格文本')
    expect(serialized).toContain('内层格文本')

    // 外层行高必须容纳 段落 + 嵌套表: 明显高于单行 (24)
    expect(tableItem!.rows![0].height).toBeGreaterThan(40)
  })

  it('getFlatPageItems: 递归展平嵌套格内容, 归属记在内层表上', () => {
    const { doc, pool, innerTable, innerPara } = makeNestedTableDoc()
    const engine = new LayoutEngine(new EventBus(), testMeasurer)
    const pages = engine.fullLayout(doc, pool)

    const flat = pages.flatMap(p => getFlatPageItems(p))
    const innerItems = flat.filter(i => i.nodeId !== innerTable.id && i.text === '内层格文本')
    expect(innerItems).toHaveLength(1)
    // 归属是内层表 —— 不是最外层那张
    expect(innerItems[0].ownerTableId).toBe(innerTable.id)
    // 内层段落在池里可达, 且是段落
    expect(pool.nodes.get(innerPara.id)?.type).toBe(NodeType.PARAGRAPH)
  })

  it('导出: 内层文本进入 TXT (与既有 nested-aware 的导出实现一致)', () => {
    const { doc, pool } = makeNestedTableDoc()
    const txt = buildExportText(doc, pool)
    expect(txt).toContain('外层格文本')
    expect(txt).toContain('内层格文本')
  })
})
