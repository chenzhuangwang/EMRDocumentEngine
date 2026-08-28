// ============================================================
// CaretScope 单元格导航测试 (v21.0 Phase 4)
//
// 验证 Tab/Shift+Tab 导航所需的纯函数:
//   1. listTableCells — 阅读顺序展平 (rowspan 下半部分不重复)
//   2. getAdjacentCell — 前向/后向相邻单元格 + 越界
//   3. resolveCellPosition / getCaretScope — 段落 → cell 定位
// ============================================================

import { describe, it, expect } from 'vitest'
import { listTableCells, getAdjacentCell, resolveCellPosition, getCaretScope } from '../state/CaretScope'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode,
  createTable, createTableRow, createTableCell,
} from '../document/factory/ElementFormatter'
import type { BaseNode } from '../document/core/DocumentModel'

/** 2×2 表格, cell(0,0) rowspan=2:
 *   row0: [A(rowspan=2), B]
 *   row1: [D]  (列 0 被 rowspan 占用)
 */
function makeRowspanFixture() {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)

  const mk = () => {
    const tn = createTextNode('x')
    const para = createParagraph([tn.id])
    allNodes.set(tn.id, tn as unknown as BaseNode)
    allNodes.set(para.id, para as unknown as BaseNode)
    return para
  }
  const A = mk(); const B = mk(); const D = mk()

  const c00 = createTableCell([A.id], { rowspan: 2 })
  const c01 = createTableCell([B.id])
  const c11 = createTableCell([D.id])
  const row0 = createTableRow([c00, c01])
  const row1 = createTableRow([c11])
  const table = createTable(
    [{ width: 50, mode: 'percentage' }, { width: 50, mode: 'percentage' }],
    [row0, row1],
  )
  for (const n of [table, row0, row1, c00, c01, c11]) allNodes.set(n.id, n as unknown as BaseNode)
  doc.body.children.push(table.id)

  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool, A, B, D, c00, c01, c11, table }
}

/** 1×2 表格, cell(0,0) colspan=2:
 *   row0: [M(colspan=2)]
 *   row1: [L, R]
 */
function makeColspanFixture() {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)

  const mk = () => {
    const tn = createTextNode('x')
    const para = createParagraph([tn.id])
    allNodes.set(tn.id, tn as unknown as BaseNode)
    allNodes.set(para.id, para as unknown as BaseNode)
    return para
  }
  const M = mk(); const L = mk(); const R = mk()

  const cM = createTableCell([M.id], { colspan: 2 })
  const cL = createTableCell([L.id])
  const cR = createTableCell([R.id])
  const row0 = createTableRow([cM])
  const row1 = createTableRow([cL, cR])
  const table = createTable(
    [{ width: 50, mode: 'percentage' }, { width: 50, mode: 'percentage' }],
    [row0, row1],
  )
  for (const n of [table, row0, row1, cM, cL, cR]) allNodes.set(n.id, n as unknown as BaseNode)
  doc.body.children.push(table.id)

  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool, M, L, R, cM, cL, cR, table }
}

describe('CaretScope 单元格导航', () => {
  it('listTableCells: rowspan 下半部分不重复, 阅读顺序正确', () => {
    const { pool, table, c00, c01, c11 } = makeRowspanFixture()
    const cells = listTableCells(pool, table.id)
    expect(cells.map(c => c.cellId)).toEqual([c00.id, c01.id, c11.id])
    expect(cells.map(c => ({ row: c.row, col: c.col }))).toEqual([
      { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 },
    ])
  })

  it('listTableCells: colspan 不影响阅读顺序', () => {
    const { pool, table, cM, cL, cR } = makeColspanFixture()
    const cells = listTableCells(pool, table.id)
    expect(cells.map(c => c.cellId)).toEqual([cM.id, cL.id, cR.id])
  })

  it('getAdjacentCell: 前向/后向 + 越界返回 null', () => {
    const { pool, table, c00, c01, c11 } = makeRowspanFixture()

    // 前向: A → B → D → null
    expect(getAdjacentCell(pool, table.id, 0, 0, 1)).toMatchObject({ cellId: c01.id })
    expect(getAdjacentCell(pool, table.id, 0, 1, 1)).toMatchObject({ cellId: c11.id })
    expect(getAdjacentCell(pool, table.id, 1, 0, 1)).toBeNull()

    // 后向: D → B → A → null
    expect(getAdjacentCell(pool, table.id, 1, 0, -1)).toMatchObject({ cellId: c01.id })
    expect(getAdjacentCell(pool, table.id, 0, 1, -1)).toMatchObject({ cellId: c00.id })
    expect(getAdjacentCell(pool, table.id, 0, 0, -1)).toBeNull()
  })

  it('resolveCellPosition / getCaretScope: 段落定位到 cell', () => {
    const { pool, doc, A, B, D, table } = makeRowspanFixture()

    expect(resolveCellPosition(A.id, pool)).toEqual({ tableId: table.id, row: 0, col: 0 })
    expect(resolveCellPosition(B.id, pool)).toEqual({ tableId: table.id, row: 0, col: 1 })
    expect(resolveCellPosition(D.id, pool)).toEqual({ tableId: table.id, row: 1, col: 0 })

    expect(getCaretScope([doc.id, A.id], pool)).toEqual({ type: 'cell', tableId: table.id, row: 0, col: 0 })
    expect(getCaretScope([doc.id, B.id], pool).type).toBe('cell')
  })

  it('getCaretScope: 正文段落为 body', () => {
    const { doc, pool } = makeRowspanFixture()
    // 正文段落 (不在 cell 内)
    const tn = createTextNode('body')
    const para = createParagraph([tn.id])
    pool.addNode(tn as unknown as BaseNode)
    pool.addNode(para as unknown as BaseNode)
    doc.body.children.push(para.id)

    expect(getCaretScope([doc.id, para.id], pool)).toEqual({ type: 'body' })
  })
})
