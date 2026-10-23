// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// VirtualViewport — 可见页范围 (契约 §16.1)
//
// 这组用例锁三件事:
//   1. 页高可以不同 (禁止 i * pageHeight 的假设)
//   2. 判定口径与旧 getVisiblePages 逐字一致 (边界严格不等式)
//   3. overscan 只在两端扩展, 且被页数夹紧
// ============================================================

import { describe, it, expect } from 'vitest'
import { VirtualViewport, computeVisibleRange } from '../layout/viewport/VirtualViewport'

const pages = (...heights: number[]) => heights.map((height) => ({ height }))

describe('computeVisibleRange', () => {
  it('首屏: 返回从第 0 页开始的范围', () => {
    const range = computeVisibleRange(pages(1123, 1123, 1123), 0, 800)
    expect(range.start).toBe(0)
    expect(range.end).toBeGreaterThanOrEqual(0)
  })

  it('中间滚动: 包含与视口相交的页', () => {
    // 页高 1123 + 间隙 20: 第 2 页文档顶部 = 2286
    const range = computeVisibleRange(pages(1123, 1123, 1123, 1123), 2500, 800, { pageVerticalGap: 20 })
    expect(range.start).toBeLessThanOrEqual(2)
    expect(range.end).toBeGreaterThanOrEqual(2)
  })

  it('页高不同: 必须按实测高度累加, 不能按 index × 页高', () => {
    // [500, 500, 2000], scroll 1200: 前两页已完全滚出, 第三页顶在 1020
    const range = computeVisibleRange(pages(500, 500, 2000), 1200, 200, { pageVerticalGap: 20 })
    expect(range).toEqual({ start: 2, end: 2 })
  })

  it('边界: 页顶正好等于视口底部时该页算可见 (严格大于才排除)', () => {
    // 页 1 覆盖 [1000, 2000); scroll=2000, 视口 [2000, 2100]
    const range = computeVisibleRange(pages(1000, 1000, 3000), 2000, 100)
    expect(range).toEqual({ start: 1, end: 2 })
  })

  it('overscan 向两端扩展并按页数夹紧', () => {
    // 视口 [150,190]: 只有第 1 页 (100-200) 与之相交
    const base = computeVisibleRange(pages(100, 100, 100, 100), 150, 40)
    expect(base).toEqual({ start: 1, end: 1 })

    const wide = computeVisibleRange(pages(100, 100, 100, 100), 150, 40, { overscanPages: 1 })
    expect(wide).toEqual({ start: 0, end: 2 })

    const clamped = computeVisibleRange(pages(100, 100), 50, 50, { overscanPages: 5 })
    expect(clamped).toEqual({ start: 0, end: 1 })
  })

  it('空文档: start=0, end=-1 (调用方负责跳过)', () => {
    expect(computeVisibleRange([], 0, 800)).toEqual({ start: 0, end: -1 })
  })

  it('页间间隙参与累加: 间隙大到跨过整段时, 后一页不再算可见', () => {
    // 窗口 [950,1050]: 无间隙时第 1 页顶在 1000, 相交;
    // 有 200 间隙时第 1 页顶在 1200, 已在窗口下方
    const noGap = computeVisibleRange(pages(1000, 1000), 950, 100)
    expect(noGap).toEqual({ start: 0, end: 1 })
    const withGap = computeVisibleRange(pages(1000, 1000), 950, 100, { pageVerticalGap: 200 })
    expect(withGap).toEqual({ start: 0, end: 0 })
  })

  it('overscan=0 时与旧 LayoutEngine 实现逐值一致 (500 组随机输入)', () => {
    // 旧实现 (迁移前 LayoutEngine.getVisiblePages), 原样保留作对照:
    // 判定口径必须逐字一致, 否则这次"只换实现不改行为"的接线条目不成立。
    const legacy = (
      heights: readonly number[], scrollY: number, viewportHeight: number, pageVerticalGap: number,
    ): { start: number; end: number } => {
      let cumulativeY = 0
      let start = 0
      let end = heights.length - 1
      for (let i = 0; i < heights.length; i++) {
        const pageHeight = heights[i]
        const slot = pageHeight + pageVerticalGap
        if (cumulativeY + pageHeight < scrollY) start = i + 1
        if (cumulativeY > scrollY + viewportHeight) { end = i - 1; break }
        cumulativeY += slot
      }
      return { start: Math.max(0, start), end: Math.min(heights.length - 1, end) }
    }

    let seed = 42
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }

    for (let n = 0; n < 500; n++) {
      const count = 1 + Math.floor(rand() * 8)
      const heights = Array.from({ length: count }, () => 200 + Math.floor(rand() * 2000))
      const scrollY = rand() * 12000
      const viewportHeight = 100 + rand() * 1500
      const gap = Math.floor(rand() * 40)
      expect(
        computeVisibleRange(heights.map((height) => ({ height })), scrollY, viewportHeight, { pageVerticalGap: gap }),
      ).toEqual(legacy(heights, scrollY, viewportHeight, gap))
    }
  })
})

describe('VirtualViewport', () => {
  it('屏幕坐标入口按 scale 换算, 与文档坐标入口一致', () => {
    const vp = new VirtualViewport()
    const heights = pages(1000, 1000, 1000)
    const doc = vp.computeVisiblePages(heights, 1500, 400)
    const screen = vp.computeVisible(heights, { scrollTop: 3000, viewportHeight: 800, scale: 2 })
    expect(screen).toEqual(doc)
  })

  it('setOverscan 生效且不接受负数', () => {
    const vp = new VirtualViewport(0)
    const heights = pages(100, 100, 100, 100)
    expect(vp.computeVisiblePages(heights, 150, 40)).toEqual({ start: 1, end: 1 })
    vp.setOverscan(1)
    expect(vp.computeVisiblePages(heights, 150, 40)).toEqual({ start: 0, end: 2 })
    vp.setOverscan(-3)
    expect(vp.overscan).toBe(0)
  })

  it('canvasY 按实测页高累加 (页高不同也不漂)', () => {
    const vp = new VirtualViewport()
    const offsets = vp.getVisiblePageOffsets(
      pages(1000, 2000),
      { scrollTop: 1000, viewportHeight: 500, scale: 1 },
    )
    expect(offsets).toEqual([
      { pageIndex: 0, canvasY: -1000 },
      { pageIndex: 1, canvasY: 0 },
    ])
  })
})
