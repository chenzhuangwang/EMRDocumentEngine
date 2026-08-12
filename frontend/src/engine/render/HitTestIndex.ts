// ================================================================
// HitTestIndex — 命中检测空间索引 (架构 §7.6, v20.34)
//
// 页分桶 + 页内 y 二分查找
// 复杂度: O(log m + k), m = 页内 item 数, k = y 范围内候选数 (通常 < 5)
//
// 行尾扩展命中: docX 超出文本右边界但 docY 在行高范围内 →
//   返回该行最后一个 item, 由上层 computeOffsetAtX 计算末尾偏移
// ================================================================

import type { SLIFPage } from '../layout/SLIF'

interface HitEntry {
  nodeId: string
  x: number; y: number; width: number; height: number
}

export class HitTestIndex {
  private buckets = new Map<number, HitEntry[]>()

  rebuild(pages: SLIFPage[]): void {
    this.buckets.clear()
    for (const page of pages) {
      const entries: HitEntry[] = []
      for (const item of page.items) {
        // 表格: 展开 cell 内的 SLIFItem 到条目列表, 使单元格文字可点击
        if (item.type === 'table' && item.rows) {
          this.expandTableEntries(item, entries)
        } else {
          entries.push({
            nodeId: item.nodeId,
            x: item.x, y: item.y,
            width: item.width, height: item.ascent + item.descent,
          })
        }
      }
      entries.sort((a, b) => a.y - b.y)
      this.buckets.set(page.pageIndex, entries)
    }
  }

  /** 展开表格内的 cell items 到 hit-test 条目列表, 坐标转换为绝对位置 */
  private expandTableEntries(tableItem: import('../layout/SLIF').SLIFItem, entries: HitEntry[]): void {
    const rows = tableItem.rows
    if (!rows || rows.length === 0) {
      // 空表: 至少保留表本身的条目
      entries.push({
        nodeId: tableItem.nodeId,
        x: tableItem.x, y: tableItem.y,
        width: tableItem.width, height: tableItem.ascent + tableItem.descent,
      })
      return
    }

    const maxCols = Math.max(...rows.map(r => r.cells.length))
    const colWidths = tableItem.columnWidths && tableItem.columnWidths.length === maxCols
      ? tableItem.columnWidths
      : calculateColumnWidths(tableItem.width, maxCols)

    let rowY = tableItem.y
    for (const row of rows) {
      const rowHeight = Math.max(row.height || 24, 24)
      let cellX = tableItem.x

      for (let ci = 0; ci < row.cells.length; ci++) {
        const cell = row.cells[ci]
        const cw = colWidths[ci] || 40
        const cellPadding = 6

        // 展开 cell 内的每个 SLIFItem
        for (const cellItem of cell.items) {
          const itemH = (cellItem.ascent || 14) + (cellItem.descent || 6)
          entries.push({
            nodeId: cellItem.nodeId,
            x: cellX + cellPadding + (cellItem.x || 0),
            y: rowY + (cellItem.y || 0),
            width: Math.max(cellItem.width || (cw - cellPadding * 2), 1),
            height: Math.max(itemH, 1),
          })
        }

        // 空单元格: 为其段落创建可点击区域
        if (cell.items.length === 0) {
          // 查找 cell 对应的段落 nodeId (通过 buildTableRows 结构: cell.children[0] = paraId)
          // 回退: 使用 cell nodeId 本身, 由 findParagraphContaining 搜索
          entries.push({
            nodeId: tableItem.nodeId,  // 回退到 tableId, 触发空段落查找
            x: cellX + cellPadding, y: rowY,
            width: Math.max(cw - cellPadding * 2, 1), height: rowHeight,
          })
        }

        cellX += cw
      }
      rowY += rowHeight + 1  // 1px row gap
    }
  }

  rebuildPage(pageIndex: number, page: SLIFPage): void {
    const entries: HitEntry[] = []
    for (const item of page.items) {
      // 表格: 展开 cell 内的 SLIFItem (与 rebuild 保持一致)
      if (item.type === 'table' && item.rows) {
        this.expandTableEntries(item, entries)
      } else {
        entries.push({
          nodeId: item.nodeId,
          x: item.x, y: item.y,
          width: item.width, height: item.ascent + item.descent,
        })
      }
    }
    entries.sort((a, b) => a.y - b.y)
    this.buckets.set(pageIndex, entries)
  }

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
    // 返回该行最后一个 item, 由上层 computeOffsetAtX 计算末尾偏移
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

  clear(): void { this.buckets.clear() }
}

/** 计算表格列宽 (与 TableParticle 保持一致) */
function calculateColumnWidths(totalWidth: number, numCols: number): number[] {
  if (numCols === 0) return []
  const width = Math.max(Math.floor(totalWidth / numCols), 40)
  return Array.from({ length: numCols }, () => width)
}
