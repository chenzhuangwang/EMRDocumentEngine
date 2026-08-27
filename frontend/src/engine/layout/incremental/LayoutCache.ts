// ================================================================
// LayoutCache — 三级布局缓存 (架构 §7.4, v20.34)
//
// 缓存键 = 节点 ID, 通过 NodePool.getNodeVersion 判断失效
// inline → block → page 三级
// ================================================================

import type { SLIFItem } from '../core/SLIF'

interface InlineCacheEntry {
  width: number; height: number; ascent: number; descent: number
  version: number
}

interface BlockCacheEntry {
  lineCount: number; totalHeight: number
  lines: SLIFItem[]
  version: number
}

interface PageCacheEntry {
  pageItems: SLIFItem[]
  totalHeight: number
  version: number
}

export class LayoutCache {
  private inlineCache = new Map<string, InlineCacheEntry>()
  private blockCache = new Map<string, BlockCacheEntry>()
  private pageCache = new Map<number, PageCacheEntry>()

  isValid(nodeId: string, version: number, level: 'inline' | 'block' | 'page'): boolean {
    if (level === 'page') {
      const entry = this.pageCache.get(Number(nodeId))
      return entry !== undefined && entry.version === version
    }
    const cache = level === 'inline' ? this.inlineCache : this.blockCache
    const entry = cache.get(nodeId)
    return entry !== undefined && entry.version === version
  }

  setInline(nodeId: string, data: Omit<InlineCacheEntry, 'version'>, version: number): void {
    this.inlineCache.set(nodeId, { ...data, version })
  }

  setBlock(nodeId: string, data: Omit<BlockCacheEntry, 'version'>, version: number): void {
    this.blockCache.set(nodeId, { ...data, version })
  }

  setPage(pageIndex: number, data: Omit<PageCacheEntry, 'version'>, version: number): void {
    this.pageCache.set(pageIndex, { ...data, version })
  }

  getInline(nodeId: string): InlineCacheEntry | undefined { return this.inlineCache.get(nodeId) }
  getBlock(nodeId: string): BlockCacheEntry | undefined { return this.blockCache.get(nodeId) }
  getPage(pageIndex: number): PageCacheEntry | undefined { return this.pageCache.get(pageIndex) }

  invalidate(nodeId: string): void {
    this.inlineCache.delete(nodeId)
    this.blockCache.delete(nodeId)
  }

  invalidatePage(pageIndex: number): void {
    this.pageCache.delete(pageIndex)
  }

  clearAll(): void {
    this.inlineCache.clear()
    this.blockCache.clear()
    this.pageCache.clear()
  }
}
