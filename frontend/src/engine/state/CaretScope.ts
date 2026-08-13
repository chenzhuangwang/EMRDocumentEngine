// ================================================================
// CaretScope — 光标域定义与解析 (Phase 0, v21.0)
//
// 光标域是光标在文档树中所处的上下文类型:
//   'body' — 正文区域的段落 (doc.body.children)
//   'cell' — 表格单元格内的段落
//
// scope 从 paragraphPath + NodePool 实时派生, 不另存状态。
// 每次光标移动后通过 getCaretScope() 重新计算。
//
// Word 对齐规则 (Phase 3-4 实施):
//   - 同域内允许自由选区
//   - 跨域选区禁止 (初级阶段) 或转为 cell 框选
//   - cell 内回车不跳出表格
//   - ArrowUp/Down 边界跳转到相邻域
// ================================================================

import type { NodePool } from '../document/NodePool'

// ---- 域类型 ----

/**
 * 光标域 — 光标当前所在的文档上下文
 *
 * 由 paragraphPath + NodePool 实时计算, 不持久化。
 */
export type CaretScope =
  | { type: 'body' }
  | { type: 'cell'; tableId: string; row: number; col: number }

/**
 * 两个 CaretScope 是否在同一个域内。
 * 用于选区扩展时的域边界校验。
 */
export function isSameScope(a: CaretScope, b: CaretScope): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'body') return true
  // 同 cell 或至少同 table (宽松匹配)
  return (a as { tableId: string }).tableId === (b as { tableId: string }).tableId
}

/**
 * 判断 scope 是否为 'cell' 类型 (类型收窄 guard)
 */
export function isCellScope(scope: CaretScope): scope is { type: 'cell'; tableId: string; row: number; col: number } {
  return scope.type === 'cell'
}

// ---- 域解析 ----

/** resolveCellPosition 返回的单元格位置 */
export interface CellPosition {
  tableId: string
  row: number
  col: number
}

/** 表格单元格引用 (含 cellId) — 用于 Tab 导航的阅读顺序列表 */
export interface TableCellRef {
  cellId: string
  row: number
  col: number
}

/**
 * 列出表格中所有单元格的阅读顺序 (行优先, 行内自左向右)。
 *
 * 表格文档模型中, 每行 children 只包含「从该行起始」的单元格 (rowspan 的
 * 下半部分不重复出现), 因此简单展平即为正确的阅读顺序:
 *   row0: [A(rowspan=2), B] + row1: [D]  →  [A, B, D]
 * 与 Word 的 Tab 遍历顺序一致。
 *
 * @returns 单元格引用列表 (row/col 为 row.children 中的下标, 非网格列)
 */
export function listTableCells(pool: NodePool, tableId: string): TableCellRef[] {
  const table = pool.nodes.get(tableId) as { children?: string[] } | undefined
  if (!table?.children) return []
  const result: TableCellRef[] = []
  for (let ri = 0; ri < table.children.length; ri++) {
    const row = pool.nodes.get(table.children[ri]) as { children?: string[] } | undefined
    if (!row?.children) continue
    for (let ci = 0; ci < row.children.length; ci++) {
      result.push({ cellId: row.children[ci], row: ri, col: ci })
    }
  }
  return result
}

/**
 * 获取相邻单元格 (阅读顺序上的下一个/上一个)。
 *
 * @param direction 1 = 下一个 (Tab), -1 = 上一个 (Shift+Tab)
 * @returns 相邻单元格引用, 越界返回 null
 */
export function getAdjacentCell(
  pool: NodePool,
  tableId: string,
  row: number,
  col: number,
  direction: 1 | -1,
): TableCellRef | null {
  const table = pool.nodes.get(tableId) as { children?: string[] } | undefined
  const rowNode = pool.nodes.get(table?.children?.[row] || '') as { children?: string[] } | undefined
  const currentCellId = rowNode?.children?.[col]
  if (!currentCellId) return null

  const cells = listTableCells(pool, tableId)
  const idx = cells.findIndex(c => c.cellId === currentCellId)
  if (idx < 0) return null
  return cells[idx + direction] ?? null
}

/**
 * 从段落 ID 解析其所属的单元格位置。
 *
 * 算法: 沿 NodePool 反向查找
 *   1. 遍历全部 pool.nodes, 找 type='cell' 且 children 包含 paraId 的节点
 *   2. 找到 cell 后, 遍历找 type='row' 且 children 包含 cellId 的节点
 *   3. 找到 row 后, 遍历找 type='table' 且 children 包含 rowId 的节点
 *   4. 计算 row/col 索引
 *
 * O(n) 线性扫描 pool.nodes, n 为节点总数。
 * 实际场景中 n 通常 < 500, 且此函数仅在光标移动时调用, 性能可接受。
 *
 * @param paraId 段落节点 ID
 * @param pool   节点池
 * @returns 单元格位置, 或 null (段落不在表格内)
 */
export function resolveCellPosition(
  paraId: string,
  pool: NodePool,
): CellPosition | null {
  // Step 1: 查找包含 paraId 的 cell 节点
  let cellId: string | null = null
  for (const [, node] of pool.nodes) {
    if (node.type !== 'cell') continue
    const cell = node as unknown as { id: string; children?: string[] }
    if (!cell.children?.includes(paraId)) continue
    cellId = cell.id
    break
  }
  if (!cellId) return null

  // Step 2: 查找包含 cellId 的 row 节点 + 列索引
  let rowId: string | null = null
  let colIdx = -1
  for (const [, node] of pool.nodes) {
    if (node.type !== 'row') continue
    const row = node as unknown as { id: string; children?: string[] }
    const idx = row.children?.indexOf(cellId)
    if (idx === undefined || idx < 0) continue
    rowId = row.id
    colIdx = idx
    break
  }
  if (!rowId) return null

  // Step 3: 查找包含 rowId 的 table 节点 + 行索引
  for (const [, node] of pool.nodes) {
    if (node.type !== 'table') continue
    const table = node as unknown as { id: string; children?: string[] }
    const rowIdx = table.children?.indexOf(rowId)
    if (rowIdx !== undefined && rowIdx >= 0) {
      return { tableId: table.id, row: rowIdx, col: colIdx }
    }
  }

  return null
}

/**
 * 从段落路径计算当前光标域。
 *
 * paragraphPath 格式: [documentRootId, paragraphId]
 * 末段是段落 ID, 沿 NodePool 反向查找其容器。
 *
 * @param paragraphPath 光标段落路径 (CursorState.paragraphPath)
 * @param pool          节点池
 * @returns 光标域: body 或 cell(tableId, row, col)
 */
export function getCaretScope(
  paragraphPath: string[],
  pool: NodePool,
): CaretScope {
  if (paragraphPath.length === 0) return { type: 'body' }

  const paraId = paragraphPath[paragraphPath.length - 1]
  const cellPos = resolveCellPosition(paraId, pool)

  if (cellPos) {
    return {
      type: 'cell',
      tableId: cellPos.tableId,
      row: cellPos.row,
      col: cellPos.col,
    }
  }

  return { type: 'body' }
}
