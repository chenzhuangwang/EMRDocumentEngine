// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

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

import type { NodePool } from '../document/core/NodePool'
import type { DocumentTree } from '../document/core/DocumentModel'
import {
  resolveHfParagraphLocation, hfParagraphsForPage,
  type HeaderFooterBand, type HeaderFooterVariant,
} from '../document/core/HeaderFooterRegions'
import { paragraphTextLength } from '../document/selection/SelectionCollector'

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
  const table = pool.nodes.get(tableId) as { children?: readonly string[] } | undefined
  if (!table?.children) return []
  const result: TableCellRef[] = []
  for (let ri = 0; ri < table.children.length; ri++) {
    const row = pool.nodes.get(table.children[ri]) as { children?: readonly string[] } | undefined
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
  const table = pool.nodes.get(tableId) as { children?: readonly string[] } | undefined
  const rowNode = pool.nodes.get(table?.children?.[row] || '') as { children?: readonly string[] } | undefined
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
    const cell = node as unknown as { id: string; children?: readonly string[] }
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
    const row = node as unknown as { id: string; children?: readonly string[] }
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
    const table = node as unknown as { id: string; children?: readonly string[] }
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

// ---- 段落区域解析 (body / cell / header / footer) ----

/**
 * 段落所在区域 + 可直接操作的兄弟数组。
 *
 * 与 getCaretScope 不同: 此处把 header/footer 视为独立区域 (而非 body),
 * 供结构编辑命令 (拆段/并段/删除) 确定正确的兄弟容器, 避免误写入 body。
 *
 * @returns 区域 + 兄弟数组 (可变引用) + 段落在其中的下标; 未找到返回 null
 */
export type ParagraphRegion =
  | { type: 'body'; siblings: readonly string[]; containerId: string; index: number }
  | { type: 'cell'; siblings: readonly string[]; containerId: string; index: number }
  | { type: 'header'; siblings: string[]; index: number; variant: HeaderFooterVariant }
  | { type: 'footer'; siblings: string[]; index: number; variant: HeaderFooterVariant }

export function resolveParagraphRegion(
  paraId: string,
  doc: DocumentTree,
  pool: NodePool,
): ParagraphRegion | null {
  // 1. 正文段落 (doc.body.children — children 数组, 经 containerId=doc.id 走 NodePool)
  const bi = doc.body.children.indexOf(paraId)
  if (bi >= 0) return { type: 'body', siblings: doc.body.children, containerId: doc.id, index: bi }

  // 2. 单元格内段落 (cell.children — children 数组, 经 containerId=cell.id 走 NodePool)
  const cellPos = resolveCellPosition(paraId, pool)
  if (cellPos) {
    const table = pool.nodes.get(cellPos.tableId) as { children?: readonly string[] } | undefined
    const row = pool.nodes.get(table?.children?.[cellPos.row] || '') as { children?: readonly string[] } | undefined
    const cell = pool.nodes.get(row?.children?.[cellPos.col] || '') as { id: string; children?: readonly string[] } | undefined
    if (cell?.children) {
      const ci = cell.children.indexOf(paraId)
      if (ci >= 0) return { type: 'cell', siblings: cell.children, containerId: cell.id, index: ci }
    }
  }

  // 3. 页眉/页脚段落 (6 个变体数组 — 非 children 数组, 不在 PROBLEM B choke point 范围)
  //    归属解析唯一经 HeaderFooterRegions (契约 §7.9): 变体不同 → 兄弟数组不同。
  const loc = resolveHfParagraphLocation(doc, paraId)
  if (loc) {
    if (loc.band === 'header') {
      return { type: 'header', siblings: loc.ids, index: loc.index, variant: loc.variant }
    }
    return { type: 'footer', siblings: loc.ids, index: loc.index, variant: loc.variant }
  }

  return null
}

/**
 * 双击进入页眉/页脚编辑时的初始光标落点 —— 该区域内容的末尾 (不是开头)。
 *
 * 页眉/页脚段落每页都有副本, 故必须先把「页码」解析成变体再取该变体的段落数组;
 * 变体 → 数组的唯一映射在 HeaderFooterRegions (契约 §7.9), 此处不重复。
 *
 * 末尾偏移与点击命中共用同一 offset 语义: 段落内非文本内联节点 (控件 / 图片)
 * 按「原子 = 1 字符」计 (与 interaction/hitTestHeaderFooter 的 computeOffsetInItems
 * 一致), 故用 paragraphTextLength 即得到合法的末位偏移。
 *
 * 区域为空 → null (调用方负责先建段落, 见 Editor.ensureHeaderFooterParagraph)。
 */
export function hfBandEndCaret(
  doc: DocumentTree,
  pool: NodePool,
  band: HeaderFooterBand,
  pageNumber: number,
): { paraPath: string[]; offset: number } | null {
  const ids = hfParagraphsForPage(doc, band, pageNumber)
  const paraId = ids[ids.length - 1]
  if (!paraId) return null
  return { paraPath: [doc.id, paraId], offset: paragraphTextLength(pool, paraId) }
}

/** 选区两段是否同容器 + 其兄弟/下标 (删除/并段跨段用, region 感知) */
export interface SiblingRange {
  regionType: 'body' | 'cell' | 'header' | 'footer'
  siblings: readonly string[]
  aIdx: number
  fIdx: number
  isCell: boolean
}

/** anchor/focus 必须落在同一区域容器 (body / header / footer / 同一 cell), 否则 null */
export function resolveSiblingRange(
  doc: DocumentTree,
  pool: NodePool,
  anchorParaId: string,
  focusParaId: string,
): SiblingRange | null {
  const ra = resolveParagraphRegion(anchorParaId, doc, pool)
  const rf = resolveParagraphRegion(focusParaId, doc, pool)
  if (!ra || !rf) return null
  if (ra.type === 'cell' || rf.type === 'cell') {
    if (ra.type !== 'cell' || rf.type !== 'cell') return null // body/cell 混选
    if (ra.containerId !== rf.containerId) return null          // 不同 cell
  } else if (ra.type !== rf.type) {
    return null // body↔header / header↔footer 混选
  } else if ((ra.type === 'header' || ra.type === 'footer') &&
             (rf.type === 'header' || rf.type === 'footer') &&
             ra.variant !== rf.variant) {
    return null // 同带不同变体 (header ↔ header:first) 混选: 兄弟数组不同, 不得混排
  }
  return {
    regionType: ra.type,
    siblings: ra.siblings,
    aIdx: ra.index,
    fIdx: rf.index,
    isCell: ra.type === 'cell',
  }
}
