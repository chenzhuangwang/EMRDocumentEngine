// ============================================================
// Particles + VirtualViewport 综合测试 (R80-R81)
// ============================================================

import { describe, it, expect } from 'vitest'
import { VirtualViewport } from '../layout/VirtualViewport'

// ---- VirtualViewport ----

describe('VirtualViewport', () => {
  it('should compute visible range for first page', () => {
    const vp = new VirtualViewport()
    vp.setPageHeight(1123)
    const range = vp.computeVisible({ scrollTop: 0, viewportHeight: 800, scale: 1 }, 10)
    expect(range.start).toBe(0)
    expect(range.end).toBeGreaterThanOrEqual(0)
  })

  it('should compute visible range for middle pages', () => {
    const vp = new VirtualViewport()
    vp.setPageHeight(1123)
    const range = vp.computeVisible({ scrollTop: 2500, viewportHeight: 800, scale: 1 }, 10)
    // Page 2 starts at 2246, should be visible
    expect(range.start).toBeLessThanOrEqual(2)
    expect(range.end).toBeGreaterThanOrEqual(2)
  })

  it('should respect scale factor', () => {
    const vp = new VirtualViewport()
    vp.setPageHeight(1123)
    const range = vp.computeVisible({ scrollTop: 500, viewportHeight: 800, scale: 2 }, 5)
    expect(range.end).toBeGreaterThanOrEqual(range.start)
  })

  it('should clamp range to total pages', () => {
    const vp = new VirtualViewport()
    vp.setPageHeight(1123)
    const range = vp.computeVisible({ scrollTop: 0, viewportHeight: 800, scale: 1 }, 3)
    expect(range.end).toBeLessThanOrEqual(2) // 0-indexed, total 3 pages = 0,1,2
  })

  it('should generate page offsets', () => {
    const vp = new VirtualViewport()
    vp.setPageHeight(1123)
    const offsets = vp.getVisiblePageOffsets(5, 0, 1)
    expect(offsets.length).toBeGreaterThan(0)
    expect(offsets[0].pageIndex).toBe(0)
  })
})
