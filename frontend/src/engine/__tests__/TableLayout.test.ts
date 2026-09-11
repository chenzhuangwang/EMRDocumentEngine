// ============================================================
// TableLayout 布局测试 (v21.0 Phase 2)
//
// 验证 buildTableRows 的 rowspan 布局:
//   1. rowspan 单元格高度 = 合并行高之和
//   2. 后续行跳过被 rowspan 占用的列
// ============================================================

import { describe, it, expect } from 'vitest'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { testMeasurer } from './helpers'
import {
  createDocument, createParagraph, createTextNode,
  createTable, createTableRow, createTableCell,
} from '../document/factory/ElementFormatter'
import { buildNodePool } from '../document/core/NodePool'
import type { BaseNode } from '../document/core/DocumentModel'

/** 2×2 表格, cell(0,0) rowspan=2:
 *   row0: [A(rowspan=2), B]
 *   row1: [D]  (列 0 被 rowspan 占用)
 */
function makeTableDoc() {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)

  const mkPara = (text: string) => {
    const tn = createTextNode(text)
    const para = createParagraph([tn.id])
    allNodes.set(tn.id, tn as unknown as BaseNode)
    allNodes.set(para.id, para as unknown as BaseNode)
    return para
  }

  const paraA = mkPara('A')
  const paraB = mkPara('B')
  const paraD = mkPara('D')

  const cell00 = createTableCell([paraA.id], { rowspan: 2 })
  const cell01 = createTableCell([paraB.id])
  const cell11 = createTableCell([paraD.id])
  const row0 = createTableRow([cell00, cell01])
  const row1 = createTableRow([cell11])
  const table = createTable(
    [{ width: 50, mode: 'percentage' }, { width: 50, mode: 'percentage' }],
    [row0, row1],
  )

  for (const n of [table, row0, row1, cell00, cell01, cell11]) {
    allNodes.set(n.id, n as unknown as BaseNode)
  }
  doc.body.children = [table.id]

  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool }
}

describe('TableLayout rowspan', () => {
  it('rowspan 单元格高度合并 + 后续行跳过占用列', () => {
    const { doc, pool } = makeTableDoc()
    const engine = new LayoutEngine(new EventBus(), testMeasurer)
    const pages = engine.fullLayout(doc, pool)

    const tableItem = pages.flatMap(p => p.items).find(i => i.type === 'table')
    expect(tableItem).toBeDefined()
    const rows = tableItem!.rows!
    expect(rows.length).toBe(2)

    // row0: [c00(rowspan=2), c01]
    expect(rows[0].cells.length).toBe(2)
    expect(rows[0].cells[0].rowspan).toBe(2)
    expect(rows[0].cells[0].height).toBe(73) // 36 + 1(gap) + 36 (单行内容 16 + 上下 padding 20)
    expect(rows[0].cells[0].x).toBe(0)

    // row1: [c11] 且 c11 在列 1 (列 0 被 rowspan 占用)
    expect(rows[1].cells.length).toBe(1)
    expect(rows[1].cells[0].x).toBe(rows[0].cells[1].x) // 与 c01 同列 x
    expect(rows[1].cells[0].height).toBe(36)
  })
})

// ---- Phase 3: 单元格内多段落换行渲染 ----

/** 构建单列表格 (fixed 100px), cell 内含 `paraTexts` 指定的若干段落 */
function buildSingleCellTable(paraTexts: (string | null)[]) {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)

  const paraIds: string[] = []
  for (const text of paraTexts) {
    const para = text === null
      ? createParagraph([]) // 空段落
      : (() => {
          const tn = createTextNode(text)
          allNodes.set(tn.id, tn as unknown as BaseNode)
          return createParagraph([tn.id])
        })()
    allNodes.set(para.id, para as unknown as BaseNode)
    paraIds.push(para.id)
  }

  const cell = createTableCell(paraIds)
  const row = createTableRow([cell])
  const table = createTable([{ width: 100, mode: 'fixed' }], [row])
  for (const n of [table, row, cell]) allNodes.set(n.id, n as unknown as BaseNode)
  doc.body.children = [table.id]

  const pool = buildNodePool(allNodes, { body: doc.id })
  const engine = new LayoutEngine(new EventBus(), testMeasurer)
  const pages = engine.fullLayout(doc, pool)
  const tableItem = pages.flatMap(p => p.items).find(i => i.type === 'table')!
  return { doc, pool, tableItem }
}

describe('TableLayout cell 内容换行 (Phase 3)', () => {
  it('长文本在 cell 内换行为多行, 行高增长', () => {
    // 10 个 CJK 字 (cell 默认 16, 每字 16px) → 内容宽 100-20=80px, 每行 5 字 → 2 行
    const { tableItem } = buildSingleCellTable(['一二三四五六七八九十'])
    const cell = tableItem.rows![0].cells[0]

    expect(cell.items.length).toBe(2)
    expect(cell.items[0].text).toBe('一二三四五')
    expect(cell.items[1].text).toBe('六七八九十')
    // 两行堆叠: 第二行 y 大于第一行
    expect(cell.items[1].y).toBeGreaterThan(cell.items[0].y)
    // 行高增长: 2*16 内容 + 20 padding = 52
    expect(tableItem.rows![0].height).toBe(52)
    expect(cell.height).toBe(52)
  })

  it('多段落垂直堆叠, 各行 y 递增', () => {
    const { tableItem } = buildSingleCellTable(['甲', '乙'])
    const cell = tableItem.rows![0].cells[0]

    // 两个段落各一行 → 2 个 item
    expect(cell.items.length).toBe(2)
    expect(cell.items[0].text).toBe('甲')
    expect(cell.items[1].text).toBe('乙')
    // 第二段落 y 在下方 (段落边界为硬换行)
    expect(cell.items[1].y).toBeGreaterThan(cell.items[0].y)
    // 内容 32 → 行高 52
    expect(tableItem.rows![0].height).toBe(52)
  })

  it('空段落占一行, 不产生可见文本但保留占位', () => {
    const { tableItem } = buildSingleCellTable(['甲', null, '乙'])
    const cell = tableItem.rows![0].cells[0]

    // 甲 / 空段落 / 乙 → 3 行
    const texts = cell.items.map(i => i.text)
    expect(cell.items.length).toBe(3)
    expect(texts[0]).toBe('甲')
    expect(texts[1]).toBe('') // 空段落占位
    expect(texts[2]).toBe('乙')
    // 三段 3*16 内容 + 20 padding = 68
    expect(tableItem.rows![0].height).toBe(68)
    // y 严格递增
    expect(cell.items[2].y).toBeGreaterThan(cell.items[1].y)
    expect(cell.items[1].y).toBeGreaterThan(cell.items[0].y)
  })
})

