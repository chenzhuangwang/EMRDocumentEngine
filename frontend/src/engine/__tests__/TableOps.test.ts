// ============================================================
// TableOps 表格结构操作测试 (v21.0 Phase 5)
//
// 验证 insertRow/deleteRow/insertColumn/deleteColumn 在
// 普通表格 + colspan/rowspan 表格下的网格级正确性。
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  insertRow, deleteRow, insertColumn, deleteColumn,
  buildCellGrid, getCellGridPosition, normalizeRange, cellsInRange,
} from '../document/TableOps'
import { buildNodePool } from '../document/NodePool'
import type { NodePool } from '../document/NodePool'
import {
  createDocument, createParagraph, createTextNode,
  createTable, createTableRow, createTableCell,
} from '../document/ElementFormatter'
import type { BaseNode, TableCell, TableRow } from '../document/DocumentModel'

/** 构建普通 N×M 表格, 每个 cell 含一个文本段落 (文本为 "r{c}") */
function makeSimpleTable(rows: number, cols: number) {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)

  const mkCell = (r: number, c: number) => {
    const tn = createTextNode(`r${r}c${c}`)
    const para = createParagraph([tn.id])
    allNodes.set(tn.id, tn as unknown as BaseNode)
    allNodes.set(para.id, para as unknown as BaseNode)
    return createTableCell([para.id])
  }

  const rowsNodes: TableRow[] = []
  for (let r = 0; r < rows; r++) {
    const cells: TableCell[] = []
    for (let c = 0; c < cols; c++) cells.push(mkCell(r, c))
    const row = createTableRow(cells)
    allNodes.set(row.id, row as unknown as BaseNode)
    for (const cell of cells) allNodes.set(cell.id, cell as unknown as BaseNode)
    rowsNodes.push(row)
  }

  const table = createTable(
    Array.from({ length: cols }, () => ({ width: 100 / cols, mode: 'percentage' as const })),
    rowsNodes,
  )
  for (const r of rowsNodes) allNodes.set(r.id, r as unknown as BaseNode)
  allNodes.set(table.id, table as unknown as BaseNode)
  doc.body.children.push(table.id)

  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool, table }
}

/** rowspan 表格: row0=[A(rowspan=2), B], row1=[D] */
function makeRowspanTable() {
  const { doc, pool, table } = makeSimpleTable(2, 2)
  // 将 (0,0) 设为 rowspan=2, 删除 (1,0) 单元格
  const row0 = pool.nodes.get(table.children[0]) as unknown as TableRow
  const row1 = pool.nodes.get(table.children[1]) as unknown as TableRow
  const A = pool.nodes.get(row0.children[0]) as unknown as TableCell
  const B = pool.nodes.get(row0.children[1]) as unknown as TableCell
  A.rowspan = 2
  const dCellId = row1.children[0]
  row1.children.splice(0, 1) // 删除列0的 cell (rowspan 下半部分不重复)
  pool.nodes.delete(dCellId)
  const D = pool.nodes.get(row1.children[0]) as unknown as TableCell
  return { doc, pool, table, A, B, D }
}

/** colspan 表格: row0=[M(colspan=2)], row1=[L, R] */
function makeColspanTable() {
  const { doc, pool, table } = makeSimpleTable(2, 2)
  const row0 = pool.nodes.get(table.children[0]) as unknown as TableRow
  const row1 = pool.nodes.get(table.children[1]) as unknown as TableRow
  const M = pool.nodes.get(row0.children[0]) as unknown as TableCell
  const topRight = pool.nodes.get(row0.children[1]) as unknown as TableCell
  M.colspan = 2
  // 合并 M 与右上 cell 的内容, 删除右上 cell
  M.children = [...M.children, ...topRight.children]
  row0.children.splice(1, 1)
  pool.nodes.delete(topRight.id)
  const L = pool.nodes.get(row1.children[0]) as unknown as TableCell
  const R = pool.nodes.get(row1.children[1]) as unknown as TableCell
  return { doc, pool, table, M, L, R }
}

/** 网格单元断言辅助: 返回 {row,col,colspan,rowspan} 列表 */
function gridSummary(pool: NodePool, tableId: string) {
  return buildCellGrid(pool, tableId).cells.map(gc => ({
    cellId: gc.cellId, row: gc.row, col: gc.col, colspan: gc.colspan, rowspan: gc.rowspan,
  }))
}

function cellSpan(pool: NodePool, cellId: string) {
  const c = pool.nodes.get(cellId) as unknown as TableCell
  return { colspan: c.colspan || 1, rowspan: c.rowspan || 1 }
}

describe('TableOps 行列操作', () => {
  // ---- 行插入 ----

  it('insertRow: 普通表格末尾插入完整空行', () => {
    const { pool, table } = makeSimpleTable(2, 2)
    insertRow(pool, table.id, 1)
    expect(table.children.length).toBe(3)
    const newRow = pool.nodes.get(table.children[2]) as unknown as TableRow
    expect(newRow.children.length).toBe(2)
  })

  it('insertRow: 跨界 rowspan 单元格 rowspan+1, 新行跳过占用列', () => {
    const { pool, table, A } = makeRowspanTable()
    insertRow(pool, table.id, 0) // 在 row0 下方插入

    // A 跨过插入点 → rowspan 2 → 3
    expect(cellSpan(pool, A.id).rowspan).toBe(3)
    // 新行 (index 1) 只有列1 一个 cell (列0 被 A 占用)
    const newRow = pool.nodes.get(table.children[1]) as unknown as TableRow
    expect(newRow.children.length).toBe(1)

    const grid = gridSummary(pool, table.id)
    // A 在 col0 跨 3 行; B 在 (0,1); 新 cell 在 (1,1); D 在 (2,1)
    expect(grid).toContainEqual(expect.objectContaining({ cellId: A.id, col: 0, rowspan: 3 }))
    expect(grid.filter(g => g.row === 1).length).toBe(1)
    expect(grid.filter(g => g.row === 1)[0].col).toBe(1)
  })

  // ---- 行删除 ----

  it('deleteRow: 普通表格删除行, 行数减一', () => {
    const { pool, table } = makeSimpleTable(3, 2)
    deleteRow(pool, table.id, 1)
    expect(table.children.length).toBe(2)
  })

  it('deleteRow: 删除 rowspan 起始行, 整个 span 移除', () => {
    const { pool, table } = makeRowspanTable()
    deleteRow(pool, table.id, 0)
    // row0 (含 A rowspan=2) 被删除; 仅剩原 row1 (D)
    expect(table.children.length).toBe(1)
    const row = pool.nodes.get(table.children[0]) as unknown as TableRow
    expect(row.children.length).toBe(1)
    // A 节点已删除
    expect(pool.nodes.has(pool.nodes.get(row.children[0])!.id)).toBe(true)
  })

  it('deleteRow: 删除 rowspan 末行, 跨界 rowspan 单元格 rowspan-1', () => {
    const { pool, table, A } = makeRowspanTable()
    deleteRow(pool, table.id, 1) // 删除 row1 (D 行)
    expect(table.children.length).toBe(1)
    // A 跨过被删行 → rowspan 2 → 1
    expect(cellSpan(pool, A.id).rowspan).toBe(1)
  })

  // ---- 列插入 ----

  it('insertColumn: 普通表格右侧插入空列', () => {
    const { pool, table } = makeSimpleTable(2, 2)
    insertColumn(pool, table.id, 1)
    expect(table.columns.length).toBe(3)
    const grid = gridSummary(pool, table.id)
    expect(grid.length).toBe(6) // 2 行 × 3 列
    expect(grid.filter(g => g.row === 0).length).toBe(3)
  })

  it('insertColumn: 跨界 colspan 单元格 colspan+1', () => {
    const { pool, table, M } = makeColspanTable()
    insertColumn(pool, table.id, 0) // 在 col0 右侧插入

    // M 跨过插入点 → colspan 2 → 3
    expect(cellSpan(pool, M.id).colspan).toBe(3)
    // 每行新增一个 cell
    const grid = gridSummary(pool, table.id)
    expect(grid.filter(g => g.row === 0).length).toBe(1) // M 独占一行
    expect(grid.filter(g => g.row === 1).length).toBe(3) // L + 新 + R
  })

  // ---- 列删除 ----

  it('deleteColumn: 普通表格删除列, 列数减一', () => {
    const { pool, table } = makeSimpleTable(2, 3)
    deleteColumn(pool, table.id, 1)
    expect(table.columns.length).toBe(2)
    const grid = gridSummary(pool, table.id)
    expect(grid.length).toBe(4) // 2 行 × 2 列
  })

  it('deleteColumn: 删除 colspan 起始列, 跨列单元格 colspan-1', () => {
    const { pool, table, M } = makeColspanTable()
    deleteColumn(pool, table.id, 0)
    expect(table.columns.length).toBe(1)
    // M 起始列即被删列且 colspan>1 → colspan 2 → 1
    expect(cellSpan(pool, M.id).colspan).toBe(1)
    // row1 中 L 被删除, 仅剩 R
    const row1 = pool.nodes.get(table.children[1]) as unknown as TableRow
    expect(row1.children.length).toBe(1)
  })

  it('deleteColumn: 删除跨列单元格的末列, colspan-1', () => {
    const { pool, table, M } = makeColspanTable()
    deleteColumn(pool, table.id, 1) // 删除 col1 (M 的末列)
    expect(table.columns.length).toBe(1)
    // M 跨过 col1 → colspan 2 → 1
    expect(cellSpan(pool, M.id).colspan).toBe(1)
  })

  // ---- 定位辅助 ----

  it('getCellGridPosition: row.children 下标 → 网格坐标', () => {
    const { pool, table } = makeRowspanTable()
    // row0 第二个 cell (B) 位于网格 (0,1)
    expect(getCellGridPosition(pool, table.id, 0, 1)).toEqual({ row: 0, col: 1 })
    // row1 第一个 cell (D) 位于网格 (1,0) 但网格列 0 被 rowspan 占用 → 实际网格列 1
    const gp = getCellGridPosition(pool, table.id, 1, 0)
    expect(gp).toEqual({ row: 1, col: 1 })
  })

  // ---- 跨域选区 (Phase 6) ----

  it('normalizeRange: 反向拖拽也归一化为左上/右下', () => {
    expect(normalizeRange({ tableId: 't', startRow: 2, startCol: 3, endRow: 0, endCol: 1 }))
      .toEqual({ r0: 0, r1: 2, c0: 1, c1: 3 })
  })

  it('cellsInRange: rowspan 表格按起始网格坐标判定', () => {
    const { pool, table, A, B, D } = makeRowspanTable()
    // 框选第一行 [0..0]×[0..1] → A(0,0) + B(0,1)
    const row0 = cellsInRange(pool, table.id, { tableId: table.id, startRow: 0, startCol: 0, endRow: 0, endCol: 1 })
    expect(row0.sort()).toEqual([A.id, B.id].sort())
    // 框选整表 [0..1]×[0..1] → A + B + D
    const all = cellsInRange(pool, table.id, { tableId: table.id, startRow: 0, startCol: 0, endRow: 1, endCol: 1 })
    expect(all.sort()).toEqual([A.id, B.id, D.id].sort())
  })

  it('cellsInRange: colspan 表格按起始网格坐标判定', () => {
    const { pool, table, M, L, R } = makeColspanTable()
    // 框选第一行 [0..0]×[0..1] → M(0,0) (colspan=2 左上角在框内)
    const row0 = cellsInRange(pool, table.id, { tableId: table.id, startRow: 0, startCol: 0, endRow: 0, endCol: 1 })
    expect(row0).toEqual([M.id])
    // 框选整表 → M + L + R
    const all = cellsInRange(pool, table.id, { tableId: table.id, startRow: 0, startCol: 0, endRow: 1, endCol: 1 })
    expect(all.sort()).toEqual([M.id, L.id, R.id].sort())
  })
})
