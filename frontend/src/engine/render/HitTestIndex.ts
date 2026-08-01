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
        entries.push({
          nodeId: item.nodeId,
          x: item.x, y: item.y,
          width: item.width, height: item.ascent + item.descent,  // 文字视觉高度
        })
      }
      entries.sort((a, b) => a.y - b.y)
      this.buckets.set(page.pageIndex, entries)
    }
  }

  rebuildPage(pageIndex: number, page: SLIFPage): void {
    const entries: HitEntry[] = []
    for (const item of page.items) {
      entries.push({
        nodeId: item.nodeId,
        x: item.x, y: item.y,
        width: item.width, height: item.ascent + item.descent,
      })
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
