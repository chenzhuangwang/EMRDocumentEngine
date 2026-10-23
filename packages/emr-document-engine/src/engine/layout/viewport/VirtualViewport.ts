// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// VirtualViewport — 可见页范围 (契约 §16.1)
//
// 唯一实现: 按 SLIF 实测页高计算, **不得假设页高一致** ——
// 同一文档里页面设置、纸张方向、分节都可能让页高不同。
// LayoutEngine.getVisiblePages 委托本模块; Draw 是唯一消费者。
//
// 两个入口:
//   computeVisiblePages — 文档坐标 (LayoutEngine 用这个)
//   computeVisible      — 屏幕坐标, 内部除以 scale (外部集成方用)
// ============================================================

/** 只依赖页高的结构 —— SLIFPage 直接满足, 不需要额外投影 */
export interface PageHeightLike {
  readonly height: number
}

export interface VisibleRange {
  /** 第一个可见页索引 */
  start: number
  /** 最后一个可见页索引 */
  end: number
}

/** 屏幕坐标下的视口状态 (scale 由本模块负责换算) */
export interface ViewportState {
  /** 视口顶部 (scrollTop, CSS px) */
  scrollTop: number
  /** 视口高度 (CSS px) */
  viewportHeight: number
  /** 屏幕像素 → 文档像素的缩放系数 */
  scale: number
}

export interface VisibleRangeOptions {
  /** 页间渲染间隙 (文档像素) — 必须与 Draw/PageBreaker 用的是同一个值 */
  pageVerticalGap?: number
  /** 视口上下各多取的页数 */
  overscanPages?: number
}

/**
 * 纯函数: 计算可见页范围 (文档坐标)。
 *
 * 判定口径与旧 `LayoutEngine.getVisiblePages` 逐字一致 (严格不等式)，
 * 额外支持 overscan。DOM 读取、缩放换算都不在这里 —— 调用方负责。
 */
export function computeVisibleRange(
  pages: readonly PageHeightLike[],
  scrollTop: number,
  viewportHeight: number,
  options: VisibleRangeOptions = {},
): VisibleRange {
  const gap = Math.max(0, options.pageVerticalGap ?? 0)
  const overscan = Math.max(0, options.overscanPages ?? 0)
  const last = pages.length - 1

  let cumulativeY = 0
  let start = 0
  let end = last

  for (let i = 0; i < pages.length; i++) {
    const pageHeight = pages[i].height
    // 整页都在视口上方 → 起点右移
    if (cumulativeY + pageHeight < scrollTop) start = i + 1
    // 页顶已在视口下方 → 终点定在前一页
    if (cumulativeY > scrollTop + viewportHeight) { end = i - 1; break }
    cumulativeY += pageHeight + gap
  }

  return {
    start: Math.max(0, start - overscan),
    end: Math.min(last, end + overscan),
  }
}

export class VirtualViewport {
  private overscanPages: number

  constructor(overscanPages = 0) {
    this.overscanPages = Math.max(0, overscanPages)
  }

  /** 设置 overscan 页数 (前后各多取几页) */
  setOverscan(pages: number): void { this.overscanPages = Math.max(0, pages) }

  get overscan(): number { return this.overscanPages }

  /** 文档坐标入口 — LayoutEngine 委托此方法 */
  computeVisiblePages(
    pages: readonly PageHeightLike[],
    scrollTop: number,
    viewportHeight: number,
    pageVerticalGap = 0,
  ): VisibleRange {
    return computeVisibleRange(pages, scrollTop, viewportHeight, {
      pageVerticalGap,
      overscanPages: this.overscanPages,
    })
  }

  /** 屏幕坐标入口 — 按 scale 换算成文档坐标后计算 */
  computeVisible(
    pages: readonly PageHeightLike[],
    viewport: ViewportState,
    pageVerticalGap = 0,
  ): VisibleRange {
    const scale = viewport.scale > 0 ? viewport.scale : 1
    return this.computeVisiblePages(
      pages,
      viewport.scrollTop / scale,
      viewport.viewportHeight / scale,
      pageVerticalGap,
    )
  }

  /**
   * 可见页在画布上的 Y 偏移 (含 scale)。
   *
   * 逐页累加实测页高 —— 旧实现用 `i * pageHeight` 的前提是页高一致,
   * 那正是契约 §16.1 禁止的假设。
   */
  getVisiblePageOffsets(
    pages: readonly PageHeightLike[],
    viewport: ViewportState,
    pageVerticalGap = 0,
  ): { pageIndex: number; canvasY: number }[] {
    const range = this.computeVisible(pages, viewport, pageVerticalGap)
    const scale = viewport.scale > 0 ? viewport.scale : 1
    const gap = Math.max(0, pageVerticalGap)
    const offsets: { pageIndex: number; canvasY: number }[] = []

    let docTop = 0
    for (let i = 0; i <= range.end && i < pages.length; i++) {
      if (i >= range.start) {
        offsets.push({ pageIndex: i, canvasY: docTop * scale - viewport.scrollTop })
      }
      docTop += pages[i].height + gap
    }
    return offsets
  }
}
