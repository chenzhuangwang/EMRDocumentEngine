// ============================================================
// IncrementalLayout — 增量布局引擎 (TASK-482, v7.0)
//
// 仅重算脏段落, 非脏段落复用旧布局
// 配合 DirtyTracker + PageStartTable 实现 O(脏段落数) 布局
// ============================================================

import type { DirtyTracker } from './DirtyTracker'
import type { LineElement } from './LineBreaker'

export interface CachedParagraphLayout {
  paragraphId: string
  lines: { elements: LineElement[]; width: number; height: number; maxAscent: number; maxDescent: number; indent?: number }[]
  /** 段落总高度 */
  totalHeight: number
}

export class IncrementalLayout {
  private cache = new Map<string, CachedParagraphLayout>()

  /** 检查段落布局是否已缓存且未变脏 */
  isValid(paragraphId: string, dirty: DirtyTracker): boolean {
    return this.cache.has(paragraphId) && !dirty.isParagraphDirty(paragraphId)
  }

  /** 获取缓存的段落布局 */
  get(paragraphId: string): CachedParagraphLayout | undefined {
    return this.cache.get(paragraphId)
  }

  /** 缓存段落布局 */
  set(paragraphId: string, layout: CachedParagraphLayout): void {
    this.cache.set(paragraphId, layout)
  }

  /** 使指定段落的缓存失效 */
  invalidate(paragraphId: string): void {
    this.cache.delete(paragraphId)
  }

  /** 使所有缓存失效 */
  invalidateAll(): void {
    this.cache.clear()
  }

  /** 获取缓存大小 */
  get size(): number { return this.cache.size }

  /**
   * 增量布局: 对 body children 中脏段落重新计算, 干净段落复用缓存
   *
   * @returns { reused: number; recomputed: number } 复用/重算计数
   */
  computeStats(bodyChildren: string[], dirty: DirtyTracker): { reused: number; recomputed: number } {
    let reused = 0; let recomputed = 0
    for (const paraId of bodyChildren) {
      if (this.isValid(paraId, dirty)) reused++
      else recomputed++
    }
    return { reused, recomputed }
  }
}
