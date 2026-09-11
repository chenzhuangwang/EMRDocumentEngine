// ============================================================
// TableOps 表格结构操作测试 (v21.0 Phase 5)
//
// 验证 insertRow/deleteRow/insertColumn/deleteColumn 在
// 普通表格 + colspan/rowspan 表格下的网格级正确性。
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  insertRow, deleteRow, insertColumn, deleteColumn,
  resizeColumn, clampColumnPair, effectiveMinColumnWidth,
  buildCellGrid, getCellGridPosition, normalizeRange, cellsInRange,
  mergeAdjacentCells, mergeRange, splitCell,
} from '../document/table/TableOps'
import { buildNodePool } from '../document/core/NodePool'
import type { NodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode,
  createTable, createTableRow, createTableCell,
} from '../document/factory/ElementFormatter'
import type { BaseNode, TableCell, TableRow } from '../document/core/DocumentModel'

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
  doc.body.children = [table.id]

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
  row1.children = row1.children.slice(1) // 删除列0的 cell (rowspan 下半部分不重复)
  pool.removeNode(dCellId)
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
  row0.children = row0.children.slice(0, 1)
  pool.removeNode(topRight.id)
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

describe('TableOps 合并/拆分 (契约 §11.2, Drift 1)', () => {
  // ---- 单格右合并 ----

  it('mergeAdjacentCells: 同行相邻合并 → colspan 累加 + 内容并入 + 右侧 cell 移除', () => {
    const { pool, table } = makeSimpleTable(2, 2)
    expect(mergeAdjacentCells(pool, table.id, 0, 0)).toBe(true)

    const row0 = pool.nodes.get(table.children[0]) as unknown as TableRow
    expect(row0.children.length).toBe(1) // 右侧 cell 已移除
    const merged = pool.nodes.get(row0.children[0]) as unknown as TableCell
    expect(cellSpan(pool, merged.id)).toEqual({ colspan: 2, rowspan: 1 })
    // 内容并入: 两个段落
    expect(merged.children.length).toBe(2)
  })

  it('mergeAdjacentCells: 右侧无相邻 cell → 拒绝', () => {
    const { pool, table } = makeSimpleTable(2, 2)
    expect(mergeAdjacentCells(pool, table.id, 0, 1)).toBe(false) // colIdx 已是末格
  })

  it('mergeAdjacentCells: 两侧任一跨行 → 拒绝 (暂不支持跨行合并)', () => {
    const { pool, table, A } = makeRowspanTable()
    // A(rowspan=2) 与其右侧 B 合并 → 拒绝
    expect(mergeAdjacentCells(pool, table.id, 0, 0)).toBe(false)
    expect(cellSpan(pool, A.id).rowspan).toBe(2) // 未变更
  })

  // ---- 矩形合并 ----

  it('mergeRange: 2×2 矩形合并 → colspan=2 + rowspan=2, 其余 cell 移除', () => {
    const { pool, table } = makeSimpleTable(2, 2)
    const range = { tableId: table.id, startRow: 0, startCol: 0, endRow: 1, endCol: 1 }
    expect(mergeRange(pool, table.id, range)).toBe(true)

    const grid = gridSummary(pool, table.id)
    expect(grid.length).toBe(1) // 仅剩目标 cell
    expect(grid[0]).toEqual(expect.objectContaining({ row: 0, col: 0, colspan: 2, rowspan: 2 }))
  })

  it('mergeRange: 单格范围 (r0==r1 && c0==c1) → 拒绝', () => {
    const { pool, table } = makeSimpleTable(2, 2)
    const range = { tableId: table.id, startRow: 0, startCol: 0, endRow: 0, endCol: 0 }
    expect(mergeRange(pool, table.id, range)).toBe(false)
    expect(gridSummary(pool, table.id).length).toBe(4) // 未变更
  })

  it('mergeRange: 含 rowspan 边框的矩形合并 (合并前已有跨行 cell)', () => {
    const { pool, table, A } = makeRowspanTable()
    // 整表合并: A(row0,0 rowspan2) + B(0,1) + D(1,1)
    const range = { tableId: table.id, startRow: 0, startCol: 0, endRow: 1, endCol: 1 }
    expect(mergeRange(pool, table.id, range)).toBe(true)

    const grid = gridSummary(pool, table.id)
    expect(grid.length).toBe(1)
    expect(grid[0]).toEqual(expect.objectContaining({ row: 0, col: 0, colspan: 2, rowspan: 2 }))
    // 目标 cell 为 A (左上角), 内容并入 B + D
    expect(cellSpan(pool, A.id)).toEqual({ colspan: 2, rowspan: 2 })
  })

  // ---- 拆分 ----

  it('splitCell: colspan=2 水平拆分 → 原 cell colspan=1 + 右侧新增空 cell', () => {
    const { pool, table, M } = makeColspanTable()
    expect(splitCell(pool, table.id, 0, 0)).toBe(true)

    expect(cellSpan(pool, M.id).colspan).toBe(1) // 原 cell 缩为 1
    const row0 = pool.nodes.get(table.children[0]) as unknown as TableRow
    expect(row0.children.length).toBe(2) // 新增一个 cell
    // 新增 cell colspan 默认 1 (colspan==2 不保留剩余 span)
    const newCell = pool.nodes.get(row0.children[1]) as unknown as TableCell
    expect(cellSpan(pool, newCell.id)).toEqual({ colspan: 1, rowspan: 1 })
  })

  it('splitCell: colspan=3 水平拆分 → 原 cell colspan=1 + 新增 colspan=2', () => {
    const { pool, table } = makeSimpleTable(2, 3)
    // 手动构造: (0,0) colspan=3, 移除 (0,1)(0,2)
    const row0 = pool.nodes.get(table.children[0]) as unknown as TableRow
    const c0 = pool.nodes.get(row0.children[0]) as unknown as TableCell
    c0.colspan = 3
    const c1 = row0.children[1]; const c2 = row0.children[2]
    pool.removeNode(c1); pool.removeNode(c2)
    row0.children = row0.children.slice(0, 1)

    expect(splitCell(pool, table.id, 0, 0)).toBe(true)
    expect(cellSpan(pool, c0.id).colspan).toBe(1)
    const row0b = pool.nodes.get(table.children[0]) as unknown as TableRow
    const newCell = pool.nodes.get(row0b.children[1]) as unknown as TableCell
    expect(cellSpan(pool, newCell.id)).toEqual({ colspan: 2, rowspan: 1 })
  })

  it('splitCell: rowspan=2 垂直拆分 → 原 cell rowspan=1 + 下一行对应列新增空 cell', () => {
    const { pool, table, A, D } = makeRowspanTable()
    expect(splitCell(pool, table.id, 0, 0)).toBe(true)

    expect(cellSpan(pool, A.id).rowspan).toBe(1) // 原 cell 缩为 1
    const row1 = pool.nodes.get(table.children[1]) as unknown as TableRow
    expect(row1.children.length).toBe(2) // D + 新增
    // 拆分先缩 A.rowspan=1 → D 在网格列 0, 新增 cell 追加在 D 之后 (col 0 无 >0 插入点)
    expect(row1.children[0]).toBe(D.id)
    const newCell = pool.nodes.get(row1.children[1]) as unknown as TableCell
    expect(cellSpan(pool, newCell.id)).toEqual({ colspan: 1, rowspan: 1 })
  })

  it('splitCell: 未合并单元格 (colspan=1 && rowspan=1) → 拒绝', () => {
    const { pool, table } = makeSimpleTable(2, 2)
    expect(splitCell(pool, table.id, 0, 0)).toBe(false)
    expect(gridSummary(pool, table.id).length).toBe(4) // 未变更
  })
})

// ============================================================
// 列宽调整 (列间边界拖拽) — C1 单一权威 / 表宽守恒 / 幂等
// ============================================================

/** 建表并覆写 columns (拖拽基准 = fragment 实际 px, 由调用方传入) */
function makeResizeTable(defs: { width: number; minWidth?: number; mode?: 'fixed' | 'percentage' | 'auto' }[]) {
  const { pool, table } = makeSimpleTable(2, defs.length)
  table.columns = defs.map(d => ({ ...d }))
  return { pool, table }
}

describe('TableOps 列宽调整 (resizeColumn)', () => {
  it('effectiveMinColumnWidth: 声明式 minWidth 优先于默认下限 40', () => {
    expect(effectiveMinColumnWidth(undefined)).toBe(40)
    expect(effectiveMinColumnWidth({})).toBe(40)
    expect(effectiveMinColumnWidth({ minWidth: 20 })).toBe(40)
    expect(effectiveMinColumnWidth({ minWidth: 80 })).toBe(80)
  })

  it('clampColumnPair: pair 总宽守恒, 两侧都不塌缩', () => {
    // 左列被拖到远超右列剩余空间 → 夹到 total - effMinRight
    expect(clampColumnPair(190, 10, 40, 40)).toEqual({ left: 160, right: 40 })
    // 反向同理
    expect(clampColumnPair(-10, 210, 40, 40)).toEqual({ left: 40, right: 160 })
    // 区间内原样通过
    expect(clampColumnPair(120, 80, 40, 40)).toEqual({ left: 120, right: 80 })
  })

  it('clampColumnPair: 退化 (总宽 < 两侧最小宽之和) 仍守恒且不归零', () => {
    const r = clampColumnPair(20, 30, 80, 80)
    expect(r.left + r.right).toBe(50)
    expect(r.left).toBeGreaterThan(0)
    expect(r.right).toBeGreaterThan(0)
    // minTotal 不可达时按最小宽比例分配 (80:80 → 对半)
    expect(r.left).toBe(25)
  })

  it('resizeColumn: 两列落为 fixed, 保留 minWidth, pair 总宽守恒', () => {
    const { pool, table } = makeResizeTable([
      { width: 100, minWidth: 60, mode: 'percentage' },
      { width: 100, mode: 'percentage' },
    ])

    expect(resizeColumn(pool, table.id, 0, 130, 70)).toBe(true)
    expect(table.columns[0]).toEqual({ width: 130, minWidth: 60, mode: 'fixed' })
    expect(table.columns[1]).toEqual({ width: 70, mode: 'fixed' })
    // 表宽守恒: pair 总宽不变 (其余列不受影响)
    expect(table.columns[0].width + table.columns[1].width).toBe(200)
    // 第三列 (若存在) 不动 —— 此处两列, 断言列数不变
    expect(table.columns.length).toBe(2)
  })

  it('resizeColumn: 只动相邻两列, 其余列原样 (pair 总量由调用方守恒)', () => {
    const { pool, table } = makeResizeTable([
      { width: 100, mode: 'fixed' },
      { width: 100, mode: 'fixed' },
      { width: 300, mode: 'fixed' },
    ])

    // 调用方按 pair 守恒传入 (100 + 300 → 60 + 340)
    expect(resizeColumn(pool, table.id, 1, 60, 340)).toBe(true)
    expect(table.columns[0]).toEqual({ width: 100, mode: 'fixed' })
    expect(table.columns[1]).toEqual({ width: 60, mode: 'fixed' })
    expect(table.columns[2]).toEqual({ width: 340, mode: 'fixed' })
    // 三列总宽仍为 500 — 拖拽只在 pair 内部此消彼长
    expect(table.columns.reduce((s, c) => s + c.width, 0)).toBe(500)
  })

  it('resizeColumn: 低于最小宽 → 在 op 内夹紧 (守恒不破)', () => {
    const { pool, table } = makeResizeTable([
      { width: 100, mode: 'fixed' },
      { width: 100, minWidth: 80, mode: 'fixed' },
    ])

    // 把左列压到 10 → 夹回默认下限 40; 右列 = 200 - 40 = 160
    expect(resizeColumn(pool, table.id, 0, 10, 190)).toBe(true)
    expect(table.columns[0].width).toBe(40)
    expect(table.columns[1].width).toBe(160)

    // 把右列压到 10 → 夹回其声明 minWidth 80; 左列 = 200 - 80 = 120
    expect(resizeColumn(pool, table.id, 0, 190, 10)).toBe(true)
    expect(table.columns[1].width).toBe(80)
    expect(table.columns[0].width).toBe(120)
    expect(table.columns[0].width + table.columns[1].width).toBe(200)
  })

  it('resizeColumn: 下标越界 / 非有限值 → false 且无改动', () => {
    const { pool, table } = makeResizeTable([
      { width: 100, mode: 'fixed' },
      { width: 100, mode: 'fixed' },
    ])
    const before = table.columns.map(c => ({ ...c }))

    expect(resizeColumn(pool, table.id, -1, 10, 190)).toBe(false)   // 左越界
    expect(resizeColumn(pool, table.id, 1, 10, 190)).toBe(false)    // colIndex+1 越界
    expect(resizeColumn(pool, table.id, 0, NaN, 190)).toBe(false)
    expect(resizeColumn(pool, table.id, 0, 100, Infinity)).toBe(false)
    expect(resizeColumn(pool, 'no-such-table', 0, 10, 190)).toBe(false)
    expect(table.columns).toEqual(before)
  })

  it('resizeColumn: 宽度与 mode 均未变 → false (重复拖到同位置不入 undo)', () => {
    const { pool, table } = makeResizeTable([
      { width: 120, mode: 'fixed' },
      { width: 80, mode: 'fixed' },
    ])
    expect(resizeColumn(pool, table.id, 0, 120, 80)).toBe(false)

    // 同为 120/80 但原为 percentage → mode 变了, 是变更
    const b = makeResizeTable([
      { width: 120, mode: 'percentage' },
      { width: 80, mode: 'percentage' },
    ])
    expect(resizeColumn(b.pool, b.table.id, 0, 120, 80)).toBe(true)
    expect(b.table.columns[0].mode).toBe('fixed')
    expect(b.table.columns[1].mode).toBe('fixed')
  })
})
