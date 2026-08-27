// ============================================================
// PageStartTable — 增量分页索引表 (TASK-485, v7.0)
//
// 存储每个段落所在的起始页索引
// 支持: 逐页早停 + blockIndex 二分查找 + 增量更新
// 百页单字符编辑收敛 1~2 页, 第 52 页起复用旧布局
// ============================================================

export interface PageEntry {
  /** 段落 ID */
  paragraphId: string
  /** 段落起始页索引 (0-based) */
  startPage: number
}

export class PageStartTable {
  private entries: PageEntry[] = []
  /** paragraphId → index in entries (快速查找) */
  private index = new Map<string, number>()

  /** 重建整表: 全量布局后调用 */
  rebuild(paragraphs: { id: string; pageIndex: number }[]): void {
    this.entries = paragraphs.map(p => ({ paragraphId: p.id, startPage: p.pageIndex }))
    this.index.clear()
    for (let i = 0; i < this.entries.length; i++) {
      this.index.set(this.entries[i].paragraphId, i)
    }
  }

  /** 查询段落所在页码 (O(1)) */
  getPage(paragraphId: string): number {
    const idx = this.index.get(paragraphId)
    if (idx === undefined) return -1
    return this.entries[idx].startPage
  }

  /**
   * 二分查找指定页的第一个段落
   * @returns 段落 ID 或 null (空表)
   */
  findFirstParagraphOnPage(pageIndex: number): string | null {
    let lo = 0; let hi = this.entries.length - 1
    let result: string | null = null

    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.entries[mid].startPage >= pageIndex) {
        result = this.entries[mid].paragraphId
        hi = mid - 1
      } else {
        lo = mid + 1
      }
    }

    return result
  }

  /**
   * 增量更新: 某个段落后的所有段落可能偏移
   * @param fromIndex 从该 entries 索引开始, 后续段落 +delta 页
   */
  shiftFrom(paragraphId: string, delta: number): void {
    const idx = this.index.get(paragraphId)
    if (idx === undefined) return

    for (let i = idx; i < this.entries.length; i++) {
      this.entries[i].startPage = Math.max(0, this.entries[i].startPage + delta)
    }
  }

  /** 获取表大小 */
  get size(): number { return this.entries.length }

  /** 获取所有条目 */
  getAll(): PageEntry[] { return [...this.entries] }
}
