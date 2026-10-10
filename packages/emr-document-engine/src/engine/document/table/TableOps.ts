// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// TableOps — 表格结构操作 (Phase 5, v21.0)
//
// 纯函数, 直接操作文档模型 (NodePool + Table/Row/Cell 节点)。
// 基于 MergeMatrix 的网格占位算法, 正确处理 colspan/rowspan:
//   - insertRow:    在 rowIndex 行下方插入空行, 跨界的 rowspan 单元格 rowspan+1
//   - deleteRow:    删除 rowIndex 行, 跨界的 rowspan 单元格 rowspan-1
//   - insertColumn: 在 colIndex 列右侧插入空列, 跨界的 colspan 单元格 colspan+1
//   - deleteColumn: 删除 colIndex 列, 跨界的 colspan 单元格 colspan-1
//
// 约定:
//   - rowIndex 为 table.children 中的行下标
//   - colIndex 为网格列下标 (grid col, 非 row.children 下标)
// ============================================================

import type { NodePool } from '../core/NodePool'
import type { Table, TableRow, TableCell, BaseNode } from '../core/DocumentModel'
import { createTableCell, createTableRow, createParagraph, createTextNode } from '../factory/ElementFormatter'
import { MergeMatrix, buildMergeMatrix } from './MergeMatrix'

/** 单元格的网格坐标 + span */
export interface GridCell {
  cellId: string
  row: number
  col: number
  colspan: number
  rowspan: number
}

/** 表格网格快照 */
export interface TableGrid {
  rowIds: readonly string[]
  numRows: number
  numCols: number
  cells: GridCell[]
  byId: Map<string, GridCell>
}

function tableNode(pool: NodePool, tableId: string): Table {
  const t = pool.nodes.get(tableId) as unknown as Table | undefined
  if (!t || t.type !== 'table') throw new Error(`Table ${tableId} not found`)
  return t
}

/** 网格列数: 优先 table.columns.length, 否则按各行 sum(colspan) 推算 */
function columnCount(table: Table, pool: NodePool): number {
  if (table.columns?.length) return table.columns.length
  let maxCols = 1
  for (const rowId of table.children) {
    const row = pool.nodes.get(rowId) as unknown as TableRow | undefined
    if (!row) continue
    let sum = 0
    for (const cid of row.children) {
      const cell = pool.nodes.get(cid) as unknown as TableCell | undefined
      sum += cell?.colspan || 1
    }
    maxCols = Math.max(maxCols, sum)
  }
  return maxCols
}

/** 构建表格网格: 运行一次占位算法, 得到每个 cell 的网格坐标 + span */
export function buildCellGrid(pool: NodePool, tableId: string): TableGrid {
  const table = tableNode(pool, tableId)
  const rowIds = table.children
  const numRows = rowIds.length
  const numCols = columnCount(table, pool)
  const matrix = new MergeMatrix(numRows, numCols)
  const cells: GridCell[] = []
  const byId = new Map<string, GridCell>()

  for (let ri = 0; ri < numRows; ri++) {
    const row = pool.nodes.get(rowIds[ri]) as unknown as TableRow | undefined
    if (!row) continue
    let ci = 0
    for (const cellId of row.children) {
      while (ci < numCols && matrix.isOccupied(ri, ci)) ci++
      if (ci >= numCols) break
      const cell = pool.nodes.get(cellId) as unknown as TableCell | undefined
      if (!cell) continue
      const colspan = cell.colspan || 1
      const rowspan = cell.rowspan || 1
      matrix.placeCell(cellId, ri, ci, colspan, rowspan)
      const gc: GridCell = { cellId, row: ri, col: ci, colspan, rowspan }
      cells.push(gc)
      byId.set(cellId, gc)
      ci += colspan
    }
  }
  return { rowIds, numRows, numCols, cells, byId }
}

/** 构建 MergeMatrix (复用 buildMergeMatrix, 显式 numCols 以正确处置 colspan) */
function buildMatrix(pool: NodePool, tableId: string, grid: TableGrid): MergeMatrix {
  const table = tableNode(pool, tableId)
  const rows = table.children.map(rowId => {
    const row = pool.nodes.get(rowId) as unknown as TableRow
    return {
      cells: row.children.map(cid => {
        const cell = pool.nodes.get(cid) as unknown as TableCell | undefined
        return { id: cid, colspan: cell?.colspan, rowspan: cell?.rowspan }
      }),
    }
  })
  return buildMergeMatrix(rows, { numCols: grid.numCols })
}

/** 创建空单元格 (含一个空段落 + 空文本节点), 注册进 pool */
function makeEmptyCell(pool: NodePool): TableCell {
  const text = createTextNode('')
  const para = createParagraph([text.id])
  const cell = createTableCell([para.id])
  pool.addNode(text as unknown as BaseNode)
  pool.addNode(para as unknown as BaseNode)
  pool.addNode(cell as unknown as BaseNode)
  return cell
}

/** 写入 span: <=1 时删除字段, 否则赋值 */
function setSpan(cell: TableCell, key: 'colspan' | 'rowspan', value: number): void {
  if (value <= 1) delete cell[key]
  else cell[key] = value
}

// ============================================================
// 行操作
// ============================================================

/** 在 rowIndex 行下方插入一个空行 (跨界的 rowspan 单元格 rowspan+1) */
export function insertRow(pool: NodePool, tableId: string, rowIndex: number): void {
  const grid = buildCellGrid(pool, tableId)
  const matrix = buildMatrix(pool, tableId, grid)

  // 跨界 rowspan: 跨越 rowIndex 与 rowIndex+1 之间 (同列上下相同 cellId)
  const crossing = new Set<string>()
  for (let c = 0; c < grid.numCols; c++) {
    const above = matrix.getCell(rowIndex, c)
    const below = matrix.getCell(rowIndex + 1, c)
    if (above && above === below) crossing.add(above)
  }
  for (const cellId of crossing) {
    const cell = pool.nodes.get(cellId) as unknown as TableCell
    cell.rowspan = (cell.rowspan || 1) + 1
  }

  // 新行: 为未被跨界 rowspan 占据的列创建空单元格 (按列序, 占位算法自动归位)
  const newCells: TableCell[] = []
  for (let c = 0; c < grid.numCols; c++) {
    const below = matrix.getCell(rowIndex + 1, c)
    if (below && crossing.has(below)) continue
    newCells.push(makeEmptyCell(pool))
  }

  const newRow = createTableRow(newCells)
  pool.addNode(newRow as unknown as BaseNode)
  pool.insertChild(tableId, newRow.id, rowIndex + 1)
}

/** 删除 rowIndex 行 (跨界的 rowspan 单元格 rowspan-1) */
export function deleteRow(pool: NodePool, tableId: string, rowIndex: number): void {
  const grid = buildCellGrid(pool, tableId)

  // 跨界 rowspan: 起始行 < rowIndex 且底行 >= rowIndex → rowspan-1
  for (const gc of grid.cells) {
    if (gc.row < rowIndex && gc.row + gc.rowspan - 1 >= rowIndex) {
      const cell = pool.nodes.get(gc.cellId) as unknown as TableCell
      setSpan(cell, 'rowspan', (cell.rowspan || 1) - 1)
    }
  }

  // 删除行 (连同其 cell + 段落子树)
  pool.removeChild(tableId, rowIndex)
}

// ============================================================
// 列操作
// ============================================================

/** 在 colIndex 列右侧插入一个空列 (跨界的 colspan 单元格 colspan+1) */
export function insertColumn(pool: NodePool, tableId: string, colIndex: number): void {
  const table = tableNode(pool, tableId)
  const grid = buildCellGrid(pool, tableId)
  const matrix = buildMatrix(pool, tableId, grid)

  // 跨界 colspan: 跨越 colIndex 与 colIndex+1 之间 (同行左右相同 cellId)
  const crossing = new Set<string>()
  for (let r = 0; r < grid.numRows; r++) {
    const left = matrix.getCell(r, colIndex)
    const right = matrix.getCell(r, colIndex + 1)
    if (left && left === right) crossing.add(left)
  }
  for (const cellId of crossing) {
    const cell = pool.nodes.get(cellId) as unknown as TableCell
    cell.colspan = (cell.colspan || 1) + 1
  }

  // 每行: 未被跨界 colspan 占据时, 在网格列 colIndex+1 位置插入空单元格
  for (let r = 0; r < grid.numRows; r++) {
    const left = matrix.getCell(r, colIndex)
    const right = matrix.getCell(r, colIndex + 1)
    if (left && left === right) continue

    const row = pool.nodes.get(grid.rowIds[r]) as unknown as TableRow
    const newCell = makeEmptyCell(pool)
    // 插入点: 第一个 grid col > colIndex 的 cell 之前
    let insertIdx = row.children.length
    for (let i = 0; i < row.children.length; i++) {
      const gc = grid.byId.get(row.children[i])
      if (gc && gc.col > colIndex) { insertIdx = i; break }
    }
    pool.insertChild(row.id, newCell.id, insertIdx)
  }

  // 插入列定义 (percentage 均匀分摊)
  const newCount = grid.numCols + 1
  table.columns.splice(colIndex + 1, 0, { width: 100 / newCount, mode: 'percentage' as const })
}

/** 删除 colIndex 列 (跨界的 colspan 单元格 colspan-1) */
export function deleteColumn(pool: NodePool, tableId: string, colIndex: number): void {
  const table = tableNode(pool, tableId)
  const grid = buildCellGrid(pool, tableId)

  // 完全位于被删列的 cell (startCol===colIndex 且 colspan===1) → 删除
  const toRemove: { rowId: string; index: number }[] = []

  for (const gc of grid.cells) {
    if (gc.col === colIndex) {
      if (gc.colspan === 1) {
        const row = pool.nodes.get(grid.rowIds[gc.row]) as unknown as TableRow
        const idx = row.children.indexOf(gc.cellId)
        if (idx >= 0) toRemove.push({ rowId: grid.rowIds[gc.row], index: idx })
      } else {
        // 起始列即被删列但 colspan>1 → 缩进, 保留 cell (移至新列首)
        const cell = pool.nodes.get(gc.cellId) as unknown as TableCell
        setSpan(cell, 'colspan', (cell.colspan || 1) - 1)
      }
    } else if (gc.col < colIndex && gc.col + gc.colspan - 1 >= colIndex) {
      // 跨列 → colspan-1
      const cell = pool.nodes.get(gc.cellId) as unknown as TableCell
      setSpan(cell, 'colspan', (cell.colspan || 1) - 1)
    }
    // gc.col > colIndex 的 cell 不受影响 (网格列隐式左移)
  }

  // 删除 (按 index 降序避免同批删除时的 index 失效; 每行至多一个)
  toRemove.sort((a, b) => b.index - a.index)
  for (const { rowId, index } of toRemove) {
    pool.removeChild(rowId, index)
  }

  // 删除列定义
  if (colIndex >= 0 && colIndex < table.columns.length) {
    table.columns.splice(colIndex, 1)
  }
}

// ============================================================
// 列宽调整 (列间边界拖拽)
//
// 语义: 拖动相邻两列之间的竖线 → 两列此消彼长 (pair 总宽守恒),
//       其余列不受影响, 表格仍铺满版面。
// C1: 列的实际最小宽 = max(MIN_COL_WIDTH, ColumnDefinition.minWidth ?? 0)。
//     拖动预览与最终提交走同一函数, 约束不漂移。
// ============================================================

/** 列宽下限 (与 LayoutEngine.computeColumnWidths.MIN_WIDTH / TableParticle.MIN_CELL_WIDTH 对齐) */
export const MIN_COL_WIDTH = 40

/** C1 唯一权威: 列的实际最小宽 (声明式 minWidth 优先于默认下限) */
export function effectiveMinColumnWidth(def?: { minWidth?: number }): number {
  return Math.max(MIN_COL_WIDTH, def?.minWidth ?? 0)
}

/**
 * 相邻两列的合法宽度 — pair 总宽守恒 (表宽不变), 两侧都不塌缩。
 *
 * 返回值恒满足 left + right === 入参 left + right。仅当 pair 总宽本身
 * 不足以容纳两侧最小宽之和时才退化 (fragment 实际宽小于声明 minWidth,
 * 如 auto 列不读 minWidth): 此时仍守恒, 按最小宽比例分配, 避免单侧归零。
 */
export function clampColumnPair(
  left: number, right: number, effMinLeft: number, effMinRight: number,
): { left: number; right: number } {
  const total = left + right
  const minTotal = effMinLeft + effMinRight
  if (!Number.isFinite(total) || total <= 0) return { left, right }
  if (total < minTotal) {
    const l = total * (effMinLeft / minTotal)
    return { left: l, right: total - l }
  }
  const l = Math.min(Math.max(left, effMinLeft), total - effMinRight)
  return { left: l, right: total - l }
}

/**
 * 拖列间边界 (列 colIndex 与 colIndex+1 之间) → 写入两列宽度。
 *
 * 内部按 C1 自行夹紧 (调用方传越界值会被夹回, 不破坏守恒/最小宽),
 * 两列落为 mode:'fixed' + px 宽 (spread 保留 minWidth 等既有字段)。
 *
 * @returns true = 已变更; false = 无操作 (下标越界 / 非有限值 / 宽度未变)
 *          → 命令 forward 返回 null, 不入 undo 栈
 */
export function resizeColumn(
  pool: NodePool, tableId: string, colIndex: number, leftWidth: number, rightWidth: number,
): boolean {
  const table = pool.nodes.get(tableId) as unknown as Table | undefined
  if (!table || table.type !== 'table') return false
  const cols = table.columns
  if (!cols || colIndex < 0 || colIndex + 1 >= cols.length) return false
  if (!Number.isFinite(leftWidth) || !Number.isFinite(rightWidth)) return false

  const prevL = cols[colIndex]
  const prevR = cols[colIndex + 1]
  if (!prevL || !prevR) return false

  const { left, right } = clampColumnPair(
    leftWidth, rightWidth,
    effectiveMinColumnWidth(prevL), effectiveMinColumnWidth(prevR),
  )
  // 宽度与 mode 均未变 → 无操作 (重复拖到同一位置不产生 undo)
  if (prevL.width === left && prevR.width === right
      && prevL.mode === 'fixed' && prevR.mode === 'fixed') {
    return false
  }

  cols[colIndex] = { ...prevL, width: left, mode: 'fixed' }
  cols[colIndex + 1] = { ...prevR, width: right, mode: 'fixed' }
  return true
}

// ============================================================
// 合并/拆分操作 (契约 §11.2, Drift 1 反转)
// ============================================================

/** 合并同一行内相邻两个单元格 (单格右合并) — 两侧均须未跨行 */
export function mergeAdjacentCells(
  pool: NodePool, tableId: string, rowIdx: number, colIdx: number,
): boolean {
  const table = pool.nodes.get(tableId) as unknown as Table | undefined
  if (!table?.children) return false
  const rowId = table.children[rowIdx]
  if (!rowId) return false
  const row = pool.nodes.get(rowId) as unknown as TableRow | undefined
  if (!row?.children) return false
  const cellId = row.children[colIdx]
  const nextCellId = row.children[colIdx + 1]
  if (!cellId || !nextCellId) return false

  const cell = pool.nodes.get(cellId) as unknown as TableCell | undefined
  const nextCell = pool.nodes.get(nextCellId) as unknown as TableCell | undefined
  if (!cell || !nextCell) return false

  // 仅支持同一行内相邻、且两侧均未跨行的合并 (跨行合并方向复杂, 暂不支持)
  if ((cell.rowspan || 1) > 1 || (nextCell.rowspan || 1) > 1) return false

  // 水平合并: colspan 累加右侧单元格的 colspan
  cell.colspan = (cell.colspan || 1) + (nextCell.colspan || 1)
  // 右侧单元格内容并入当前单元格
  cell.children = [...cell.children, ...nextCell.children]
  pool.removeNode(nextCellId)
  pool.detachChild(rowId, colIdx + 1)
  return true
}

/** 合并框选矩形为一个单元格 (colspan×rowspan) */
export function mergeRange(pool: NodePool, tableId: string, range: CellRange): boolean {
  const { r0, r1, c0, c1 } = normalizeRange(range)
  if (r0 === r1 && c0 === c1) return false

  const grid = buildCellGrid(pool, tableId)
  const boxCells = grid.cells.filter(gc => gc.row >= r0 && gc.row <= r1 && gc.col >= c0 && gc.col <= c1)
  if (boxCells.length < 2) return false

  // 左上角 cell 作为合并目标
  const target = boxCells.find(gc => gc.row === r0 && gc.col === c0)
  if (!target) return false
  const targetCell = pool.nodes.get(target.cellId) as unknown as TableCell | undefined
  if (!targetCell) return false

  // 其余 cell 内容并入目标 cell, 并从各自行移除
  for (const gc of boxCells) {
    if (gc.cellId === target.cellId) continue
    const cell = pool.nodes.get(gc.cellId) as unknown as TableCell | undefined
    if (cell?.children?.length) {
      targetCell.children = [...targetCell.children, ...cell.children]
      // 关键: 清空引用, 防止 removeChild 级联删除已并入目标 cell 的段落
      cell.children = []
    }
    const row = pool.nodes.get(grid.rowIds[gc.row]) as unknown as TableRow | undefined
    const idx = row?.children?.indexOf(gc.cellId)
    if (row && idx !== undefined && idx >= 0) pool.removeChild(row.id, idx)
  }

  // 目标 cell span = 矩形宽×高
  const spanCol = c1 - c0 + 1
  const spanRow = r1 - r0 + 1
  setSpan(targetCell, 'colspan', spanCol)
  setSpan(targetCell, 'rowspan', spanRow)
  return true
}

/** 拆分合并的单元格 (支持 colspan 水平拆分 / rowspan 垂直拆分) */
export function splitCell(pool: NodePool, tableId: string, rowIdx: number, colIdx: number): boolean {
  const table = pool.nodes.get(tableId) as unknown as Table | undefined
  if (!table?.children) return false
  const rowId = table.children[rowIdx]
  if (!rowId) return false
  const row = pool.nodes.get(rowId) as unknown as TableRow | undefined
  if (!row?.children) return false
  const cellId = row.children[colIdx]
  if (!cellId) return false
  const cell = pool.nodes.get(cellId) as unknown as TableCell | undefined
  if (!cell) return false

  const colspan = cell.colspan || 1
  const rowspan = cell.rowspan || 1
  if (colspan <= 1 && rowspan <= 1) return false

  // 新单元格 (含一个空段落)
  const newCell = makeEmptyCell(pool)

  if (colspan > 1) {
    // 水平拆分: 原 cell 缩为 colspan=1, 右侧新增 cell (保留剩余 colspan + 相同 rowspan)
    cell.colspan = 1
    if (colspan > 2) newCell.colspan = colspan - 1
    if (rowspan > 1) newCell.rowspan = rowspan
    pool.insertChild(rowId, newCell.id, colIdx + 1)
  } else {
    // 垂直拆分: 原 cell 缩为 rowspan=1, 下一行对应列新增 cell (保留剩余 rowspan)
    const rowBelowId = table.children[rowIdx + 1]
    const rowBelow = rowBelowId
      ? (pool.nodes.get(rowBelowId) as unknown as TableRow | undefined)
      : undefined
    if (!rowBelow?.children) { pool.removeNode(newCell.id); return false }

    cell.rowspan = 1
    if (rowspan > 2) newCell.rowspan = rowspan - 1
    if (colspan > 1) newCell.colspan = colspan

    // 在下一行中, 找到网格列对应的插入点
    const gp = getCellGridPosition(pool, tableId, rowIdx, colIdx)
    const targetCol = gp?.col ?? colIdx
    const grid = buildCellGrid(pool, tableId)
    let insertIdx = rowBelow.children.length
    for (let i = 0; i < rowBelow.children.length; i++) {
      const gc = grid.byId.get(rowBelow.children[i])
      if (gc && gc.col > targetCol) { insertIdx = i; break }
    }
    pool.insertChild(rowBelowId, newCell.id, insertIdx)
  }
  return true
}

// ============================================================
// 定位辅助
// ============================================================

/** 将 (row.children 下标, cell 下标) 转换为网格坐标 */
export function getCellGridPosition(
  pool: NodePool,
  tableId: string,
  rowIndex: number,
  cellIndex: number,
): { row: number; col: number } | null {
  const grid = buildCellGrid(pool, tableId)
  const row = pool.nodes.get(grid.rowIds[rowIndex]) as unknown as TableRow | undefined
  const cellId = row?.children?.[cellIndex]
  if (!cellId) return null
  const gc = grid.byId.get(cellId)
  return gc ? { row: gc.row, col: gc.col } : null
}

// ============================================================
// 跨域选区 (cell 框选) 辅助
// ============================================================

/** 单元格框选范围 (网格坐标, 含边界, 与 start/end 顺序无关) */
export interface CellRange {
  tableId: string
  startRow: number
  startCol: number
  endRow: number
  endCol: number
}

/** 规范化范围 → 左上/右下边界 (min/max) */
export function normalizeRange(range: CellRange): { r0: number; r1: number; c0: number; c1: number } {
  return {
    r0: Math.min(range.startRow, range.endRow),
    r1: Math.max(range.startRow, range.endRow),
    c0: Math.min(range.startCol, range.endCol),
    c1: Math.max(range.startCol, range.endCol),
  }
}

/**
 * 列出框选范围内的单元格 ID。
 * 判定规则: 单元格的「起始网格坐标」落在矩形内即选中
 * (与 Word 一致 — 合并单元格只要其左上角在框内即整体选中)。
 */
export function cellsInRange(pool: NodePool, tableId: string, range: CellRange): string[] {
  const { r0, r1, c0, c1 } = normalizeRange(range)
  const grid = buildCellGrid(pool, tableId)
  return grid.cells
    .filter(gc => gc.row >= r0 && gc.row <= r1 && gc.col >= c0 && gc.col <= c1)
    .map(gc => gc.cellId)
}
