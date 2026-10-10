// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// TableCrossPage — 表格真正跨页续排集成测试 (LayoutEngine + PageBreaker + HitTest)
//
// 验证:
//   1. 表格按行跨页拆分, 逻辑行各出现一次 (无同页叠排/无重复)
//   2. 表前/表后有内容 → fragment y 正确 (不假设从 bodyTop 开始)
//   3. 跨页命中: Page1 的 table→cell 与 Page2 的 table→cell 均得正确 paragraph
// ================================================================

import { describe, it, expect } from 'vitest'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { HitTestIndex } from '../render/HitTestIndex'
import { testMeasurer } from './helpers'
import {
  createDocument, createParagraph, createTextNode,
  createTable, createTableRow, createTableCell,
} from '../document/factory/ElementFormatter'
import { buildNodePool } from '../document/core/NodePool'
import type { BaseNode, Paragraph } from '../document/core/DocumentModel'

function mkPara(allNodes: Map<string, BaseNode>, text: string): Paragraph {
  const tn = createTextNode(text)
  const para = createParagraph([tn.id])
  allNodes.set(tn.id, tn as unknown as BaseNode)
  allNodes.set(para.id, para as unknown as BaseNode)
  return para
}

/** 单列、rows 行表格 (每格一段文字), 返回 paras 供命中反查 */
function makeTallTable(rows: number) {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)

  const paras: { text: string; paraId: string }[] = []
  const rowNodes = []
  for (let i = 0; i < rows; i++) {
    const text = `R${i}`
    const para = mkPara(allNodes, text)
    paras.push({ text, paraId: para.id })
    const cell = createTableCell([para.id])
    allNodes.set(cell.id, cell as unknown as BaseNode)
    const row = createTableRow([cell])
    allNodes.set(row.id, row as unknown as BaseNode)
    rowNodes.push(row)
  }
  const table = createTable([{ width: 100, mode: 'percentage' }], rowNodes)
  allNodes.set(table.id, table as unknown as BaseNode)
  doc.body.children = [table.id]
  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool, table, paras }
}

/** 小页面布局, 使表格必然跨页 */
function layoutSmall(doc: ReturnType<typeof makeTallTable>['doc'], pool: ReturnType<typeof makeTallTable>['pool']) {
  const engine = new LayoutEngine(new EventBus(), testMeasurer)
  engine.updateConfig({ pageHeight: 300, marginTop: 20, marginBottom: 20, marginLeft: 40, marginRight: 40 })
  const pages = engine.fullLayout(doc, pool)
  return { engine, pages }
}

function tableItems(pages: ReturnType<LayoutEngine['fullLayout']>) {
  return pages.flatMap((p) => p.items.filter((i) => i.type === 'table'))
}

describe('表格跨页拆分 (真实分页)', () => {
  it('12 行表格跨多页, 逻辑行按序各出现一次, 无同页叠排', () => {
    const { doc, pool, paras } = makeTallTable(12)
    const { pages } = layoutSmall(doc, pool)
    const items = tableItems(pages)

    expect(items.length).toBeGreaterThan(1) // 拆分

    const seen: string[] = []
    for (const item of items) {
      expect(item.nodeId).toBe(items[0].nodeId) // 同 tableId
      for (const row of item.rows!) {
        for (const cell of row.cells) {
          for (const ci of cell.items) {
            if (ci.text) seen.push(ci.text)
          }
        }
      }
    }
    expect(seen).toEqual(paras.map((p) => p.text)) // 各一次, 有序
  })

  it('表前有段落 → 表格 fragment 不假设从 bodyTop 开始', () => {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const before = mkPara(allNodes, 'before')
    const cell = createTableCell([mkPara(allNodes, 'x').id])
    allNodes.set(cell.id, cell as unknown as BaseNode)
    const row = createTableRow([cell])
    allNodes.set(row.id, row as unknown as BaseNode)
    const table = createTable([{ width: 100, mode: 'percentage' }], [row])
    allNodes.set(table.id, table as unknown as BaseNode)
    doc.body.children = [before.id, table.id]
    const pool = buildNodePool(allNodes, { body: doc.id })

    const { pages } = layoutSmall(doc, pool)
    const tableItem = pages.flatMap((p) => p.items).find((i) => i.type === 'table')!
    const beforeItem = pages.flatMap((p) => p.items).find((i) => i.nodeId === (before as unknown as { children: string[] }).children[0])!
    expect(tableItem.y).toBeGreaterThan(beforeItem.y)
  })

  it('表后有段落 → 段落 y > 最后一个 fragment 底部', () => {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const cell = createTableCell([mkPara(allNodes, 'x').id])
    allNodes.set(cell.id, cell as unknown as BaseNode)
    const row = createTableRow([cell])
    allNodes.set(row.id, row as unknown as BaseNode)
    const table = createTable([{ width: 100, mode: 'percentage' }], [row])
    allNodes.set(table.id, table as unknown as BaseNode)
    const after = mkPara(allNodes, 'after')
    doc.body.children = [table.id, after.id]
    const pool = buildNodePool(allNodes, { body: doc.id })

    const { pages } = layoutSmall(doc, pool)
    const items = pages.flatMap((p) => p.items)
    const tableItem = items.find((i) => i.type === 'table')!
    const afterItem = items.find((i) => i.nodeId === (after as unknown as { children: string[] }).children[0])!
    expect(afterItem.y).toBe(tableItem.y + tableItem.height)
  })
})

describe('跨页命中 (HitTestTable)', () => {
  it('Page1 的 table→cell 与 Page2 的 table→cell 均得正确 paragraph', () => {
    const { doc, pool, paras } = makeTallTable(12)
    const { pages } = layoutSmall(doc, pool)
    const items = tableItems(pages)

    const hitIndex = new HitTestIndex(testMeasurer)
    hitIndex.rebuild(pages)

    const first = items[0]
    const last = items[items.length - 1]

    // Page1 首行 (R0)
    const h1 = hitIndex.hitTestTable(first, first.x + 10, first.y + 10, pool, doc.id)
    expect(h1).not.toBeNull()
    expect(h1!.paraPath[1]).toBe(paras[0].paraId)

    // 最后一页首行 (分片后的第一个逻辑行)
    const firstRowOfLast = first.rows!.length // 前面页已消费的行数
    const h2 = hitIndex.hitTestTable(last, last.x + 10, last.y + 10, pool, doc.id)
    expect(h2).not.toBeNull()
    expect(h2!.paraPath[1]).toBe(paras[firstRowOfLast].paraId)
  })
})
