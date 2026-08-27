import { describe, it, expect } from 'vitest'
import { IncrementalLayout } from '../layout/incremental/IncrementalLayout'
import { PageStartTable } from '../layout/page/PageStartTable'
import { DirtyTracker } from '../layout/incremental/DirtyTracker'

// ---- IncrementalLayout ----

describe('IncrementalLayout', () => {
  it('should not be valid when dirty', () => {
    const il = new IncrementalLayout()
    const dt = new DirtyTracker()
    dt.markParagraphDirty('p1')
    expect(il.isValid('p1', dt)).toBe(false)
  })

  it('should be valid when cached and clean', () => {
    const il = new IncrementalLayout()
    const dt = new DirtyTracker()
    il.set('p1', { paragraphId: 'p1', lines: [], totalHeight: 0 })
    expect(il.isValid('p1', dt)).toBe(true)
  })

  it('should invalidate cached paragraph', () => {
    const il = new IncrementalLayout()
    il.set('p1', { paragraphId: 'p1', lines: [], totalHeight: 0 })
    il.invalidate('p1')
    expect(il.get('p1')).toBeUndefined()
  })

  it('should invalidate all', () => {
    const il = new IncrementalLayout()
    il.set('a', { paragraphId: 'a', lines: [], totalHeight: 0 })
    il.set('b', { paragraphId: 'b', lines: [], totalHeight: 0 })
    il.invalidateAll()
    expect(il.size).toBe(0)
  })

  it('should compute reuse stats', () => {
    const il = new IncrementalLayout()
    const dt = new DirtyTracker()
    il.set('p1', { paragraphId: 'p1', lines: [], totalHeight: 0 })
    dt.markParagraphDirty('p2')
    const stats = il.computeStats(['p1', 'p2'], dt)
    expect(stats.reused).toBe(1)
    expect(stats.recomputed).toBe(1)
  })
})

// ---- PageStartTable ----

describe('PageStartTable', () => {
  it('should rebuild and query pages', () => {
    const t = new PageStartTable()
    t.rebuild([{ id: 'p1', pageIndex: 0 }, { id: 'p2', pageIndex: 0 }, { id: 'p3', pageIndex: 1 }])
    expect(t.getPage('p1')).toBe(0)
    expect(t.getPage('p3')).toBe(1)
  })

  it('should find first paragraph on page via binary search', () => {
    const t = new PageStartTable()
    t.rebuild([{ id: 'p1', pageIndex: 0 }, { id: 'p2', pageIndex: 1 }, { id: 'p3', pageIndex: 2 }])
    expect(t.findFirstParagraphOnPage(1)).toBe('p2')
    expect(t.findFirstParagraphOnPage(0)).toBe('p1')
  })

  it('should return -1 for unknown paragraph', () => {
    const t = new PageStartTable()
    expect(t.getPage('unknown')).toBe(-1)
  })

  it('should shift pages from a given paragraph', () => {
    const t = new PageStartTable()
    t.rebuild([{ id: 'a', pageIndex: 0 }, { id: 'b', pageIndex: 1 }, { id: 'c', pageIndex: 2 }])
    t.shiftFrom('b', 1) // b and c shift +1
    expect(t.getPage('a')).toBe(0)
    expect(t.getPage('b')).toBe(2)
    expect(t.getPage('c')).toBe(3)
  })
})
