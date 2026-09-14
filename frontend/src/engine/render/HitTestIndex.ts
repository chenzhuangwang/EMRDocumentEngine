// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// HitTestIndex — 命中检测空间索引 (架构 §7.6, v21.0)
//
// Phase 2: 二级碰撞检测
//   Level 1 — 页分桶 + Y 二分查找, 仅索引顶级块 (paragraph/table/image/separator)
//   Level 2 — 命中 table 外框后, 通过 hitTestTable() 做 cell 内精确定位
//
// 不再消费 getFlatPageItems(), cell 内部文字不进入 Level 1 索引。
//
// 行尾扩展命中: docX 超出文本右边界但 docY 在行高范围内 →
//   返回该行最后一个 item, 由上层 computeOffsetAtX 计算末尾偏移
// ================================================================

import type { SLIFItem, SLIFPage } from '../layout/core/SLIF'
import { tableHeaderRowsHeight, TABLE_ROW_GAP } from '../layout/core/SLIF'
import type { Paragraph, Table } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'
import { cumulativeCharWidths, findCharIndexAtX } from '../layout/text/CharWidthHelper'
import type { TextMeasurer } from '../layout/text/TextMeasurer'
import { calcUniformColWidths } from '../layout/table/TableCoordUtil'
import { buildMergeMatrix } from '../document/table/MergeMatrix'
import { effectiveMinColumnWidth } from '../document/table/TableOps'

interface HitEntry {
  nodeId: string
  x: number; y: number; width: number; height: number
  /** 命中类型: 'paragraph' | 'table' | 'image' | 'separator' | 'text' */
  itemType: string
  /** table 类型时持有原始 SLIFItem 引用 (用于 Level 2 检测) */
  tableItem?: SLIFItem
}

/** hitTestTable Level 2 返回的单元格命中结果 */
export interface TableHitResult {
  paraPath: string[]
  offset: number
}

/**
 * 列间边界命中结果 (表格列宽拖拽)
 *
 * C3 — 自包含: 几何一律取自命中所在页的 table fragment, 不使用整表全局坐标,
 * 跨页表在 page2 fragment 命中时携带的就是 page2 的 x/top/bottom/columnWidths。
 */
export interface ColumnBorderHit {
  /** 命中所在页 (fragment 所在页) */
  pageIndex: number
  tableId: string
  /** 边界位于列 colIndex 与 colIndex+1 之间 (k ∈ [0, n-2] → 外缘不命中) */
  colIndex: number
  /** 页面内 X (= fragment.x + Σ columnWidths[0..colIndex]) */
  x: number
  /** fragment 页面内纵向跨度 (含重复表头) */
  top: number
  bottom: number
  /** fragment 实际列宽 (px) — 拖拽守恒基准 */
  leftWidth: number
  rightWidth: number
  /** C1: 两侧列的实际最小宽 (与提交端同一规则) */
  effMinLeft: number
  effMinRight: number
}

export class HitTestIndex {
  private measurer: TextMeasurer
  private buckets = new Map<number, HitEntry[]>()

  constructor(measurer: TextMeasurer) {
    this.measurer = measurer
  }

  /**
   * 重建全部页面索引 — Phase 2: 仅索引顶级块
   * 表格作为单个外框 entry, cell 内文字不进入索引
   */
  rebuild(pages: SLIFPage[]): void {
    this.buckets.clear()
    for (const page of pages) {
      this.rebuildPage(page.pageIndex, page)
    }
  }

  /**
   * 重建单个页面索引
   */
  rebuildPage(pageIndex: number, page: SLIFPage): void {
    const entries: HitEntry[] = []

    for (const item of page.items) {
      if (item.type === 'table') {
        // 表格作为单个 entry — 外接矩形
        entries.push({
          nodeId: item.nodeId,
          x: item.x, y: item.y,
          width: item.width, height: item.height,
          itemType: 'table',
          tableItem: item,
        })
      } else {
        // 正文段落 / 图片 / 分隔符等 — 顶级块 item
        entries.push({
          nodeId: item.nodeId,
          x: item.x, y: item.y,
          width: item.width,
          height: item.ascent + item.descent,
          itemType: item.type || 'text',
        })
      }
    }

    entries.sort((a, b) => a.y - b.y)
    this.buckets.set(pageIndex, entries)
  }

  /**
   * Level 1 命中检测: 在顶级块索引中查找
   *
   * 命中 table 时返回 table 的 nodeId (由调用方决定是否进入 Level 2)
   * 命中其他类型时返回具体 nodeId (同 v20.35 行为)
   */
  hitTest(docX: number, docY: number, pageIndex: number): string | null {
    const bucket = this.buckets.get(pageIndex)
    if (!bucket || bucket.length === 0) return null

    // 二分 y 定位 (第一个 bottom >= docY 的 entry)
    let lo = 0; let hi = bucket.length - 1; let firstBeyond = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (bucket[mid].y + bucket[mid].height >= docY) {
        firstBeyond = mid; hi = mid - 1
      } else { lo = mid + 1 }
    }
    if (firstBeyond < 0) return null

    // 同一行上最后一个在 y 范围内的 entry (用于行尾扩展命中)
    let lastInRow: HitEntry | null = null

    // 从定位点向后扫描, 直到 item.y > docY (进入下一行)
    for (let i = firstBeyond; i < bucket.length && bucket[i].y <= docY; i++) {
      const e = bucket[i]
      // docY 在 item 垂直范围内
      if (docY <= e.y + e.height) {
        lastInRow = e
        // X 方向精确命中
        if (docX >= e.x && docX <= e.x + e.width) return e.nodeId
      }
    }

    // 行尾扩展命中: docX 超出文本右边界, 但 docY 仍在行内
    if (lastInRow && docX > lastInRow.x + lastInRow.width) {
      return lastInRow.nodeId
    }

    // X 在文本左侧: 返回该行第一个 item (光标放在行首)
    for (let i = firstBeyond; i < bucket.length && bucket[i].y <= docY; i++) {
      const e = bucket[i]
      if (docY <= e.y + e.height && docX < e.x) return e.nodeId
    }

    return null
  }

  /**
   * 获取命中条目的类型信息 (用于 Level 1→2 决策)
   */
  getEntryType(pageIndex: number, nodeId: string): string | null {
    const bucket = this.buckets.get(pageIndex)
    if (!bucket) return null
    for (const e of bucket) {
      if (e.nodeId === nodeId) return e.itemType
    }
    return null
  }

  /**
   * 获取表格 SLIFItem (Level 1 命中 table 后, 提取数据用于 Level 2)
   */
  getTableItem(pageIndex: number, tableId: string): SLIFItem | null {
    const bucket = this.buckets.get(pageIndex)
    if (!bucket) return null
    for (const e of bucket) {
      if (e.nodeId === tableId && e.itemType === 'table') {
        return e.tableItem || null
      }
    }
    return null
  }

  /**
   * Level 2 列间边界命中 (表格列宽拖拽)
   *
   * 只产「内部边界」— 列 k 与 k+1 之间, k ∈ [0, n-2]; 表左右外缘永不命中
   * (整表宽度调整不在本轮范围)。列宽一律读 fragment 派生的 columnWidths
   * (无缓存, 契约 C5), 最小宽经 effectiveMinColumnWidth 与提交端同规则 (C1)。
   *
   * @param pageIndex 页面索引
   * @param docX      页面内 x (已扣除居中偏移)
   * @param localY    页面内 y
   * @param pool      节点池 (读 columns 补齐最小宽, 只读派生)
   * @param tolerance X 方向容差 (页面内逻辑 px — 调用方按 1/scale 折算屏幕容差)
   */
  hitTestColumnBorder(
    pageIndex: number, docX: number, localY: number, pool: NodePool, tolerance: number,
  ): ColumnBorderHit | null {
    const bucket = this.buckets.get(pageIndex)
    if (!bucket || !(tolerance >= 0)) return null

    let best: ColumnBorderHit | null = null
    let bestDist = Infinity

    for (const e of bucket) {
      if (e.itemType !== 'table' || !e.tableItem) continue
      const item = e.tableItem
      // 纵向: localY 落在本 fragment 的行区内 (重复表头已计入 frag.height)
      if (localY < item.y || localY > item.y + item.height) continue

      const widths = item.columnWidths && item.columnWidths.length > 0
        ? item.columnWidths
        : calcUniformColWidths(item.width, HitTestIndex.fallbackColCount(item))
      if (widths.length < 2) continue

      // C1: 声明式 minWidth 从 pool 的 columns 读 (此处只读派生, 不缓存不写)
      const table = pool.nodes.get(item.nodeId) as unknown as Table | undefined
      const cols = table?.type === 'table' ? table.columns : undefined

      let borderX = item.x
      for (let k = 0; k < widths.length - 1; k++) {
        borderX += widths[k]
        const dist = Math.abs(docX - borderX)
        if (dist > tolerance || dist >= bestDist) continue
        bestDist = dist
        best = {
          pageIndex,
          tableId: item.nodeId,
          colIndex: k,
          x: borderX,
          top: item.y,
          // frag.height 含末行 1px 行隙 → 视觉底线回退一个行隙
          bottom: item.y + item.height - TABLE_ROW_GAP,
          leftWidth: widths[k],
          rightWidth: widths[k + 1],
          effMinLeft: effectiveMinColumnWidth(cols?.[k]),
          effMinRight: effectiveMinColumnWidth(cols?.[k + 1]),
        }
      }
    }

    return best
  }

  /** columnWidths 缺省时的列数推算 (与 hitTestTable 同规则: Σ colspan 最大值) */
  private static fallbackColCount(item: SLIFItem): number {
    const rows = item.rows
    if (!rows || rows.length === 0) return 1
    return Math.max(...rows.map(r => r.cells.reduce((s, c) => s + (c.colspan || 1), 0)))
  }

  /**
   * Level 2 表格 cell 内命中检测 (静态方法, 独立于实例索引)
   *
   * 在 SLIFItem.rows 中定位 cell, 然后在 cell.innerItems 上做
   * 局部坐标二分查找字符偏移。
   *
   * @param tableItem  Level 1 命中的表格 SLIFItem
   * @param docX       Level 1 使用的页面内 x (已扣除居中偏移)
   * @param docY       Level 1 使用的页面内 y (已扣除页面顶部)
   * @param pool       节点池 (用于解析 paragraphId → Paragraph)
   * @param docId      文档 ID (用于构造 paraPath)
   * @returns 命中结果 (paragraphPath + offset) 或 null
   */
  hitTestTable(
    tableItem: SLIFItem,
    docX: number,
    docY: number,
    pool: NodePool,
    docId: string,
  ): TableHitResult | null {
    const rows = tableItem.rows
    if (!rows || rows.length === 0) return null

    // 计算列宽: 优先 SLIFItem.columnWidths (buildTableRows 已算好实际列数)
    const colWidths = tableItem.columnWidths && tableItem.columnWidths.length > 0
      ? tableItem.columnWidths
      : calcUniformColWidths(
          tableItem.width,
          Math.max(...rows.map(r => r.cells.reduce((s, c) => s + (c.colspan || 1), 0))),
        )

    // 行高 (含 1px gap, 与 TableParticle 渲染的 rowY 累加一致)
    const rowHeights = rows.map(r => Math.max(r.height || 24, 24) + 1)

    // 重复表头占高 — 命中只认 body rows, 故 body 行区要下移表头高
    const headerH = tableHeaderRowsHeight(tableItem)

    // Level 2a: 空间定位 cell — 走 MergeMatrix (colspan/rowspan 感知)
    // v21.0 Phase 2: 渲染已展开 rowspan, 矩阵与渲染一致
    const matrix = buildMergeMatrix(rows, { numCols: colWidths.length })
    const hit = matrix.findCellAt(docX - tableItem.x, docY - tableItem.y - headerH, colWidths, rowHeights)
    if (!hit) return null

    // 反查命中的 SLIFCell 对象
    let targetCell: import('../layout/core/SLIF').SLIFCell | null = null
    for (const row of rows) {
      for (const cell of row.cells) {
        if (cell.id === hit.cellId) { targetCell = cell; break }
      }
      if (targetCell) break
    }
    if (!targetCell) return null

    // cell 原点: 起始行/列 = span 的起点 (普通 1×1 cell 无 span, 即命中位置)
    const startRow = hit.span ? hit.span.row : hit.row
    const startCol = hit.span ? hit.span.col : hit.col
    let cellX = 0
    for (let c = 0; c < startCol; c++) cellX += colWidths[c] || 40
    let cellY = 0
    for (let r = 0; r < startRow; r++) cellY += rowHeights[r]
    const targetCellX = tableItem.x + cellX
    const targetCellY = tableItem.y + headerH + cellY

    const cellItems = targetCell.items
    const CELL_PAD = 6

    // Level 2b: 空 cell → 返回 cell 内第一个段落的末尾
    if (!cellItems || cellItems.length === 0) {
      // 反向查找 cell 的第一个 paragraph
      const paraId = HitTestIndex.findFirstParagraphInCell(tableItem, targetCell, pool)
      if (paraId) {
        const para = pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
        const totalLen = para?.children
          ? para.children.reduce((sum, cid) => {
              const tn = pool.nodes.get(cid) as { text?: string } | undefined
              return sum + (tn?.text?.length || 0)
            }, 0)
          : 0
        return { paraPath: [docId, paraId], offset: totalLen }
      }
      return null
    }

    // Level 2c: 有内容的 cell — 局部坐标二分查找
    const localX = docX - targetCellX - CELL_PAD
    const localY = docY - targetCellY

    // cellItems 中的文本 item 以 cell 局部坐标 (0,0) 存储
    let accumulated = 0
    let paraId: string | null = null
    // 记录点击命中的段落及其"行尾偏移" — 越过当前行最后一个 item 后回退到该行末尾
    let hitParaId: string | null = null
    let hitParaEnd = 0

    for (const ci of cellItems) {
      const ciText = ci.text || ''
      const ciHeight = ci.ascent + ci.descent
      // 非文本内联节点(控件/图片等)按 1 字符计偏移 (与 NodePool.resolveCharOffset/
      // computeOffsetInItems 一致), 否则控件之后光标会漂。
      const isAtomic = ci.nodeType !== 'text'
      const ciUnit = isAtomic ? 1 : (ciText.length || 0)

      // 先解析当前 item 所属段落 (v21.0 Phase 1: 修复首个 item 命中时 paraId 未赋值 → 返回 null)
      const itemPara = HitTestIndex.findParentParagraph(ci.nodeId, pool)
      // 段落切换 → 重置偏移累计 (offset 相对当前段落起点, Phase 3 多段落)
      if (itemPara && itemPara !== paraId) {
        paraId = itemPara
        accumulated = 0
      }

      // Y 命中检查
      const yHit = localY >= ci.y && localY <= ci.y + ciHeight
      if (yHit) {
        hitParaId = paraId
        if (localX < ci.x) {
          if (paraId) {
            return { paraPath: [docId, paraId], offset: accumulated }
          }
          return null
        }
        const bodyW = ci.markerWidth != null ? ci.width - ci.markerWidth : ci.width
        if (localX <= ci.x + bodyW) {
          const relativeX = localX - ci.x
          if (isAtomic) {
            // 原子节点: 左半=前、右半=后 (与 computeOffsetInItems 一致)
            const offset = accumulated + (relativeX <= bodyW / 2 ? 0 : 1)
            if (paraId) return { paraPath: [docId, paraId], offset: Math.max(0, offset) }
            return null
          }
          const cumWidths = cumulativeCharWidths(ciText, {
            font: ci.font || 'SimSun', size: ci.size || 16,
            bold: ci.bold, italic: ci.italic,
          }, this.measurer)
          const charIdx = findCharIndexAtX(relativeX, cumWidths, ciText.length || 0)
          if (paraId) {
            return { paraPath: [docId, paraId], offset: Math.max(0, accumulated + charIdx) }
          }
          return null
        }
        // 点击越过当前 item 右边界 → 继续检查下一 item (拆分节点后同一行可含多 item),
        // 同时记住该段落当前行的末尾偏移, 供循环结束后回退到行尾。
        hitParaEnd = accumulated + ciUnit
      }

      accumulated += ciUnit
    }

    // 点击命中了某段落行但未落在任何 item 内 (越过行尾) → 回退到该段落行尾
    if (hitParaId) {
      return { paraPath: [docId, hitParaId], offset: Math.max(0, hitParaEnd) }
    }

    // 超出 cell 内所有文本, 返回 cell 最后 paragraph 的末尾
    if (paraId) {
      return { paraPath: [docId, paraId], offset: Math.max(0, accumulated) }
    }

    return null
  }

  /**
   * 在 cell 内查找第一个段落 ID
   */
  private static findFirstParagraphInCell(
    _tableItem: SLIFItem,
    cell: import('../layout/core/SLIF').SLIFCell,
    pool: NodePool,
  ): string | null {
    // 尝试从 cell.items 中推断 paragraph
    for (const ci of cell.items) {
      const paraId = HitTestIndex.findParentParagraph(ci.nodeId, pool)
      if (paraId) return paraId
    }
    return null
  }

  /**
   * 在 pool 中查找 nodeId 所属的 paragraph ID
   */
  private static findParentParagraph(nodeId: string, pool: NodePool): string | null {
    for (const [, node] of pool.nodes) {
      if (node.type === 'paragraph') {
        const para = node as unknown as Paragraph
        if (para.children.includes(nodeId) || node.id === nodeId) return node.id
      }
    }
    return null
  }

  clear(): void { this.buckets.clear() }
}
