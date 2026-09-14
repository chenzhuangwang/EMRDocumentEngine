// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// LayeredRenderer — 3层 Canvas 渲染 (架构 §7.5, v20.34)
//
// static: 页面背景/阴影/边距线/页码/水印
// content: 文本/表格/SmartTextNode/ImageNode
// interact: 光标/选区高亮/IME 预览
//
// Canvas 尺寸 = 视口 + overscan 1页 (非全文档)
// 水印离屏 pattern 预渲染
// 光标闪烁统一 setInterval (非 rAF)
//
// Canvas 生命周期经 SurfaceHost 委托 (契约 §27.2): 本模块不创建 canvas,
// 只通过 host.surface 拿注入的 ctx / 离屏表面 / 占位元素。
// ================================================================

import type { CoordinateSystem } from '../state/CoordinateSystem'
import type { SLIFPage } from '../layout/core/SLIF'
import type { EditorRuntimeState } from '../state/EditorRuntimeState'
import type { WatermarkConfig } from '../document/core/DocumentModel'
import { accumulatedHeightTo, getTotalDocHeight } from '../layout/table/TableCoordUtil'
import type { CanvasSurface, EditorHost } from '../host/EditorHost'

export class LayeredRenderer {
  private layers = {
    static: null as CanvasSurface | null,
    content: null as CanvasSurface | null,
    interact: null as CanvasSurface | null,
  }
  private ctxs = {
    static: null as CanvasRenderingContext2D | null,
    content: null as CanvasRenderingContext2D | null,
    interact: null as CanvasRenderingContext2D | null,
  }
  private spacer: { setHeight(cssHeightPx: number): void; remove(): void } | null = null
  private blinkTimer: number | null = null
  private host: EditorHost
  private coordSystem: CoordinateSystem
  private watermarkPattern: CanvasPattern | null = null
  private watermarkConfig: WatermarkConfig | null = null
  private watermarkImage: { width: number; height: number; source: CanvasImageSource } | null = null
  private cursorVisible = true

  /**
   * 相邻分页之间的渲染垂直间隙 (文档逻辑 px)。
   *
   * 约束 (来自设计要求):
   *   1. 仅影响渲染视口偏移 — 不修改 SLIFPage.height, 不修改 SLIFItem.y, 不影响 hitTest / 命中检测。
   *   2. 文档数据模型 / 存储坐标完全不变, 仅 spacer 撑高 + 每页 canvas Y 偏移。
   *   3. 默认 0 — 与历史行为完全一致。
   *
   * 通过 setPageVerticalGap() 调整, 调整后 Draw.render() 自动使用新值。
   */
  private pageVerticalGap = 0

  private readonly OVERSCAN_PAGES = 1

  constructor(host: EditorHost, coordSystem: CoordinateSystem) {
    this.host = host
    this.coordSystem = coordSystem

    const surface = this.host.surface
    for (const key of ['static', 'content', 'interact'] as const) {
      const layer = surface.createLayer(key)
      this.layers[key] = layer
      this.ctxs[key] = layer.ctx
    }

    // 滚动占位 spacer: 撑开容器产生原生滚动条
    this.spacer = surface.createSpacer()
  }

  getStaticCtx(): CanvasRenderingContext2D | null { return this.ctxs.static }
  getContentCtx(): CanvasRenderingContext2D | null { return this.ctxs.content }
  getInteractCtx(): CanvasRenderingContext2D | null { return this.ctxs.interact }
  getInteractSurface(): CanvasSurface | null { return this.layers.interact }

  /**
   * 获取当前分页垂直间隙 (文档逻辑 px)。
   * 供 Draw.findPageByDocY / MouseHandler / Editor 等调用方在
   * 命中检测时把 docY 反查到正确的 pageIndex + localY。
   */
  getPageVerticalGap(): number { return this.pageVerticalGap }

  /**
   * 设置分页垂直间隙 — 仅作用于渲染阶段的视口偏移, 不改动存储数据。
   * 调用方应在调整后触发 Draw.render() 重绘。
   *
   * @returns 是否发生变更 — 便于调用方按需触发 syncSizes + render。
   */
  setPageVerticalGap(gap: number): boolean {
    const clamped = Math.max(0, gap)
    if (clamped === this.pageVerticalGap) return false
    this.pageVerticalGap = clamped
    return true
  }

  /** 滚动反偏移: 保持绝对定位画布固定于可视区顶部 */
  fixCanvasScrollOffset(scrollTop: number): void {
    for (const key of ['static', 'content', 'interact'] as const) {
      this.layers[key]?.setTop(scrollTop)
    }
  }

  // ---- 尺寸管理 ----

  syncSizes(
    viewportW: number, viewportH: number, dpr: number,
    pages: SLIFPage[],
  ): void {
    const scale = this.coordSystem.transform.scale
    const totalPages = pages.length
    // 文档总高度 = 所有页面高度之和 + (N-1) * pageVerticalGap
    // (gap=0 时退化为 sum(pageHeight), 与历史行为一致)
    const totalDocHeight = getTotalDocHeight(pages, this.pageVerticalGap)
    const totalDocHeightScaled = totalDocHeight * scale
    // 视口在文档坐标中的可视范围
    const docViewportH = viewportH / scale
    // 视口内可见页数估算 — 用累计高度步长 (含间隙) 而非单一 pageHeight,
    // 以保证 OVERSCAN 在多页 / 大间距场景下不漏页。
    const avgSlot = totalPages > 0 ? totalDocHeight / totalPages : 1123
    const pagesInView = Math.ceil(docViewportH / avgSlot) + this.OVERSCAN_PAGES * 2
    const canvasHDoc = Math.min(pagesInView * avgSlot, totalDocHeight)

    const physicalW = Math.ceil(viewportW * dpr)
    const physicalH = Math.ceil(canvasHDoc * scale * dpr)

    for (const key of ['static', 'content', 'interact'] as const) {
      this.layers[key]!.resize(physicalW, physicalH, viewportW, canvasHDoc * scale)
    }

    // 更新滚动占位高度 = 全文档高度 × 缩放
    this.spacer?.setHeight(totalDocHeightScaled)
  }

  // ---- 滚动平移 ----

  setScrollOffset(scrollY: number, firstVisiblePage: number, pageHeight: number): void {
    const offsetY = -(scrollY - firstVisiblePage * pageHeight)
    const dpr = this.coordSystem.transform.dpr
    for (const ctx of [this.ctxs.static, this.ctxs.content, this.ctxs.interact]) {
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, offsetY * dpr)
    }
  }

  // ---- 静态层 ----

  /** 渲染静态层 — ctx 变换由调用方 (Draw.render) 控制 */
  renderStatic(pages: SLIFPage[], visibleRange: { start: number; end: number }, scrollOffset: number = 0): void {
    const ctx = this.ctxs.static!
    const dpr = this.coordSystem.transform.dpr
    ctx.clearRect(0, 0, this.layers.static!.width / dpr, this.layers.static!.height / dpr)
    ctx.save()

    // 可见首页在文档坐标中的累加顶部 (含 pageVerticalGap)
    const baseY = accumulatedHeightTo(visibleRange.start, pages, this.pageVerticalGap)
    for (let i = visibleRange.start; i <= visibleRange.end; i++) {
      const page = pages[i]
      if (!page) continue
      // 每页 canvas Y = 自身累加顶部 - 滚动偏移
      // (scrollOffset = scrollY - baseY, 因此 pageY = accY(i) - baseY - scrollOffset + baseY
      //  但更直观写法 = accY(i) - (scrollY) — 即该页在文档逻辑坐标里的 Y 减去当前滚动)
      // 这里保留与 Draw.render 同公式: accY(i) - scrollY, scrollY = baseY + scrollOffset
      const pageY = accumulatedHeightTo(i, pages, this.pageVerticalGap) - (baseY + scrollOffset)

      // 页面背景
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, pageY, page.width, page.height)

      // 水印
      if (this.watermarkConfig) {
        const wm = this.watermarkConfig
        if (wm.type === 'tile' && this.watermarkPattern) {
          ctx.fillStyle = this.watermarkPattern
          ctx.fillRect(0, pageY, page.width, page.height)
        } else if (wm.type === 'text') {
          this.drawTextWatermark(ctx, pageY, page.width, page.height, wm)
        } else if (wm.type === 'image' && this.watermarkImage) {
          this.drawImageWatermark(ctx, pageY, page.width, page.height, wm)
        }
      }

      // 页面四角L标记 — 统一常量, 右上/右下用镜像变换
      drawPageCornerMarks(ctx, pageY, page.width, page.height)
    }
    ctx.restore()
  }

  // ---- 水印 ----

  prepareWatermark(wm: WatermarkConfig): void {
    this.watermarkConfig = wm
    this.watermarkPattern = null
    this.watermarkImage = null

    if (wm.type === 'tile') {
      this.prepareTileWatermark(wm)
    } else if (wm.type === 'image' && wm.imageUrl) {
      this.prepareImageWatermark(wm)
    }
  }

  private prepareTileWatermark(wm: WatermarkConfig): void {
    const size = wm.spacing || 200
    const offscreen = this.host.surface.createOffscreen(size, size)
    const octx = offscreen.ctx
    octx.globalAlpha = wm.opacity ?? 0.08
    octx.font = `${wm.fontSize || 48}px "SimSun"`
    octx.fillStyle = wm.color || '#000000'
    octx.textAlign = 'center'; octx.textBaseline = 'middle'
    octx.translate(size / 2, size / 2)
    octx.rotate(((wm.rotation ?? 45) * Math.PI) / 180)
    octx.fillText(wm.text || '', 0, 0)
    this.watermarkPattern = this.ctxs.static!.createPattern(offscreen.imageSource, 'repeat')
  }

  private prepareImageWatermark(wm: WatermarkConfig): void {
    this.host.surface.loadImage(wm.imageUrl!).then((img) => {
      this.watermarkImage = img
    })
  }

  /** 绘制单条居中文本水印 */
  private drawTextWatermark(
    ctx: CanvasRenderingContext2D,
    pageY: number, pageW: number, pageH: number,
    wm: WatermarkConfig,
  ): void {
    ctx.save()
    ctx.globalAlpha = wm.opacity ?? 0.08
    ctx.fillStyle = wm.color || '#000000'
    ctx.font = `${wm.fontSize || 56}px "SimSun"`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.translate(pageW / 2, pageY + pageH / 2)
    ctx.rotate(((wm.rotation ?? 45) * Math.PI) / 180)
    ctx.fillText(wm.text || '', 0, 0)
    ctx.restore()
  }

  /** 绘制居中图片水印 */
  private drawImageWatermark(
    ctx: CanvasRenderingContext2D,
    pageY: number, pageW: number, pageH: number,
    wm: WatermarkConfig,
  ): void {
    if (!this.watermarkImage) return
    ctx.save()
    ctx.globalAlpha = wm.opacity ?? 0.15
    const scale = wm.imageScale || 0.4
    const iw = this.watermarkImage.width * scale
    const ih = this.watermarkImage.height * scale
    const ix = (pageW - iw) / 2
    const iy = pageY + (pageH - ih) / 2
    ctx.drawImage(this.watermarkImage.source, ix, iy, iw, ih)
    ctx.restore()
  }

  // ---- 光标闪烁 ----

  private _renderCallback: (() => void) | null = null

  /** 注册渲染回调 — 由 Draw 调用, 用于 blink 触发重绘 */
  setRenderCallback(fn: () => void): void {
    this._renderCallback = fn
  }

  startCursorBlink(state: EditorRuntimeState): void {
    this.stopCursorBlink()
    this.cursorVisible = true
    this.blinkTimer = setInterval(() => {
      this.cursorVisible = !this.cursorVisible
      // 同步可见性到运行时状态, 触发 Draw 重绘
      state.cursor.visible = this.cursorVisible
      if (this._renderCallback) this._renderCallback()
    }, 530)
  }

  stopCursorBlink(): void {
    if (this.blinkTimer) { clearInterval(this.blinkTimer); this.blinkTimer = null }
  }

  // ---- rAF 渲染调度 ----

  private renderPending = false
  requestRender(): void {
    if (this.renderPending) return
    this.renderPending = true
    this.host.surface.requestFrame(() => {
      this.renderPending = false
      // content 和 interact 层的具体渲染由外部 Draw/LayoutEngine 驱动
    })
  }

  // ---- 清理 ----

  destroy(): void {
    this.stopCursorBlink()
    for (const key of ['static', 'content', 'interact'] as const) {
      this.layers[key]?.remove()
      this.layers[key] = null
      this.ctxs[key] = null
    }
    this.spacer?.remove()
    this.spacer = null
    this.watermarkPattern = null
  }
}

// ================================================================
// 页面四角L标记 — 统一常量, 右角用坐标镜像
// ================================================================

const L_ARM_LENGTH = 12   // 横/纵向段长度 (px)
const L_LINE_WIDTH = 0.5  // 线宽 0.5px
const L_COLOR = '#CCCCCC' // 浅灰
const L_OFFSET_X = 24     // 距页面左右边缘
const L_ALPHA = 0.7       // 透明度

/** 绘制L角 — 横纵独立方向, 保证四角开口朝页面内侧 */
function drawLMark(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  hLen: number, vLen: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + hLen, y)    // 水平: 正=右 负=左
  ctx.moveTo(x, y)
  ctx.lineTo(x, y + vLen)    // 垂直: 正=下 负=上
  ctx.stroke()
}

/** 绘制单页四角L标记 */
function drawPageCornerMarks(
  ctx: CanvasRenderingContext2D,
  pageY: number,
  pageW: number,
  pageH: number,
): void {
  ctx.save()
  ctx.lineWidth = L_LINE_WIDTH
  ctx.strokeStyle = L_COLOR
  ctx.globalAlpha = L_ALPHA

  const sepY = 42 // 分隔线Y位置
  const gap = 6    // 距分隔线间距

  // 左上角: 左+上 → ┘
  drawLMark(ctx, L_OFFSET_X, pageY + sepY - gap, -L_ARM_LENGTH, -L_ARM_LENGTH)

  // 右上角: 镜像 → └
  ctx.save()
  ctx.translate(pageW, pageY)
  ctx.scale(-1, 1)
  drawLMark(ctx, L_OFFSET_X, sepY - gap, -L_ARM_LENGTH, -L_ARM_LENGTH)
  ctx.restore()

  // 左下角: 左+下 → ┐
  drawLMark(ctx, L_OFFSET_X, pageY + pageH - sepY + gap, -L_ARM_LENGTH, +L_ARM_LENGTH)

  // 右下角: 镜像 → ┌
  ctx.save()
  ctx.translate(pageW, pageY + pageH)
  ctx.scale(-1, 1)
  drawLMark(ctx, L_OFFSET_X, -(sepY - gap), -L_ARM_LENGTH, +L_ARM_LENGTH)
  ctx.restore()

  ctx.restore()
}
