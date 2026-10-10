// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// MemoryManager — 内存管理器 (R56, v6.0)
//
// 缓存容量限制 + LRU 淘汰 + 统计
// TextMeasurer / FontManager / LayoutCache 共享此策略
// ============================================================

export interface MemoryStats {
  /** 缓存条目数 */
  size: number
  /** 容量上限 */
  capacity: number
  /** 使用率 (0-1) */
  usage: number
  /** 命中次数 */
  hits: number
  /** 未命中次数 */
  misses: number
  /** 淘汰次数 */
  evictions: number
}

export class MemoryManager<K> {
  private capacity: number
  private cache = new Map<K, { value: unknown; lastAccess: number }>()
  private _hits = 0
  private _misses = 0
  private _evictions = 0

  constructor(capacity = 10000) {
    this.capacity = capacity
  }

  /** 从缓存读取 */
  get<T>(key: K): T | undefined {
    const entry = this.cache.get(key)
    if (entry) {
      entry.lastAccess = Date.now()
      this._hits++
      return entry.value as T
    }
    this._misses++
    return undefined
  }

  /** 写入缓存 (容量满时淘汰最久未访问) */
  set(key: K, value: unknown): void {
    if (this.cache.size >= this.capacity) {
      this.evict()
    }
    this.cache.set(key, { value, lastAccess: Date.now() })
  }

  /** 检查是否存在 */
  has(key: K): boolean {
    const exists = this.cache.has(key)
    if (exists) {
      const entry = this.cache.get(key)!
      entry.lastAccess = Date.now()
      this._hits++
    } else {
      this._misses++
    }
    return exists
  }

  /** 删除条目 */
  delete(key: K): boolean {
    return this.cache.delete(key)
  }

  /** 清空 */
  clear(): void {
    this.cache.clear()
  }

  /** 调整容量 (可能触发淘汰) */
  setCapacity(capacity: number): void {
    this.capacity = Math.max(1, capacity)
    while (this.cache.size > this.capacity) {
      this.evict()
    }
  }

  getCapacity(): number { return this.capacity }

  /** 获取统计信息 */
  getStats(): MemoryStats {
    return {
      size: this.cache.size,
      capacity: this.capacity,
      usage: this.capacity > 0 ? this.cache.size / this.capacity : 0,
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
    }
  }

  /** 重置统计计数器 */
  resetStats(): void {
    this._hits = 0
    this._misses = 0
    this._evictions = 0
  }

  get size(): number { return this.cache.size }

  // ---- 内部 ----

  /** LRU 淘汰: 找到最久未访问的条目并删除 */
  private evict(): void {
    let oldestKey: K | null = null
    let oldestTime = Infinity

    for (const [key, entry] of this.cache) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess
        oldestKey = key
      }
    }

    if (oldestKey !== null) {
      this.cache.delete(oldestKey)
      this._evictions++
    }
  }
}

/**
 * 轻量 LRU Map (基于 Map 插入顺序)
 * 适用于中小容量缓存, 淘汰和读写均为 O(1)
 */
export class LRUMap<K, V> {
  private map = new Map<K, V>()
  private maxSize: number

  constructor(maxSize = 1000) {
    this.maxSize = maxSize
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined
    // 移动到末尾 (最近使用)
    const value = this.map.get(key)!
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key)
    } else if (this.map.size >= this.maxSize) {
      // 删除最久未使用 (Map 第一个)
      const first = this.map.keys().next().value
      if (first !== undefined) this.map.delete(first)
    }
    this.map.set(key, value)
  }

  has(key: K): boolean { return this.map.has(key) }
  delete(key: K): boolean { return this.map.delete(key) }
  clear(): void { this.map.clear() }
  get size(): number { return this.map.size }
}
