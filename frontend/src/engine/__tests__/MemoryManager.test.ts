// ============================================================
// MemoryManager + LRUMap 单元测试 (R75)
// ============================================================

import { describe, it, expect } from 'vitest'
import { MemoryManager, LRUMap } from '../layout/viewport/MemoryManager'

describe('LRUMap', () => {
  it('should store and retrieve values', () => {
    const cache = new LRUMap<string, number>(10)
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1)
    expect(cache.get('b')).toBe(2)
  })

  it('should evict least recently used when capacity exceeded', () => {
    const cache = new LRUMap<string, number>(3)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    cache.set('d', 4) // evicts 'a' (oldest)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('d')).toBe(4)
  })

  it('should move accessed item to most recent', () => {
    const cache = new LRUMap<string, number>(3)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    cache.get('a') // access 'a', moves to end
    cache.set('d', 4) // evicts 'b' (now oldest)
    expect(cache.get('a')).toBe(1)
    expect(cache.get('b')).toBeUndefined()
  })

  it('should return undefined for missing key', () => {
    const cache = new LRUMap<string, number>(5)
    expect(cache.get('nonexistent')).toBeUndefined()
  })
})

describe('MemoryManager', () => {
  it('should cache and retrieve values', () => {
    const mm = new MemoryManager<string>(100)
    mm.set('key1', { data: 'value1' })
    expect(mm.get('key1')).toEqual({ data: 'value1' })
    expect(mm.has('key1')).toBe(true)
  })

  it('should track hits and misses', () => {
    const mm = new MemoryManager<string>(100)
    mm.get('missing')
    mm.set('x', 1)
    mm.get('x')
    const stats = mm.getStats()
    expect(stats.misses).toBeGreaterThanOrEqual(1)
    expect(stats.hits).toBeGreaterThanOrEqual(1)
  })

  it('should evict when capacity exceeded', () => {
    const mm = new MemoryManager<number>(5)
    for (let i = 0; i < 10; i++) mm.set(i, `val${i}`)
    expect(mm.size).toBeLessThanOrEqual(5)
    const stats = mm.getStats()
    expect(stats.evictions).toBeGreaterThan(0)
  })

  it('should clear all entries', () => {
    const mm = new MemoryManager<string>(100)
    mm.set('a', 1)
    mm.set('b', 2)
    mm.clear()
    expect(mm.size).toBe(0)
    expect(mm.get('a')).toBeUndefined()
  })

  it('should adjust capacity', () => {
    const mm = new MemoryManager<number>(100)
    for (let i = 0; i < 50; i++) mm.set(i, i)
    mm.setCapacity(10)
    expect(mm.size).toBeLessThanOrEqual(10)
  })
})
