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
// ================================================================

import type { CoordinateSystem } from '../state/CoordinateSystem'
import type { SLIFPage } from '../layout/SLIF'
import type { EditorRuntimeState } from '../state/EditorRuntimeState'

export interface WatermarkConfig {
  type: 'text' | 'image' | 'tile'
  text?: string
  fontSize?: number
  color?: string
  opacity?: number
  rotation?: number
  spacing?: number
}

export class LayeredRenderer {
  private layers = {
    static: null as HTMLCanvasElement | null,
    content: null as HTMLCanvasElement | null,
    interact: null as HTMLCanvasElement | null,
  }
  private ctxs = {
    static: null as CanvasRenderingContext2D | null,
    content: null as CanvasRenderingContext2D | null,
    interact: null as CanvasRenderingContext2D | null,
  }
  private spacer: HTMLDivElement | null = null
  private blinkTimer: number | null = null
  private coordSystem: CoordinateSystem
  private watermarkPattern: CanvasPattern | null = null
  private cursorVisible = true

  private readonly OVERSCAN_PAGES = 1

  constructor(container: HTMLElement, coordSystem: CoordinateSystem) {
    this.coordSystem = coordSystem

    for (const key of ['static', 'content', 'interact'] as const) {
      const canvas = document.createElement('canvas')
      canvas.style.position = 'absolute'
      canvas.style.top = '0'
      canvas.style.left = '0'
      canvas.style.pointerEvents = key === 'interact' ? 'none' : 'auto'
      container.appendChild(canvas)
      this.layers[key] = canvas
      this.ctxs[key] = canvas.getContext('2d')
    }
    // interact 层在最上接受 DOM 事件, 但 Canvas 绘制不响应 pointer
    if (this.layers.interact) {
      this.layers.interact.style.pointerEvents = 'auto'
      this.layers.interact.style.zIndex = '3'
    }
    if (this.layers.content) this.layers.content.style.zIndex = '2'
    if (this.layers.static) this.layers.static.style.zIndex = '1'

    // 滚动占位 spacer: 撑开容器产生原生滚动条
    this.spacer = document.createElement('div')
    this.spacer.style.pointerEvents = 'none'
    this.spacer.style.width = '1px'
    container.appendChild(this.spacer)
  }

  getStaticCtx(): CanvasRenderingContext2D | null { return this.ctxs.static }
  getContentCtx(): CanvasRenderingContext2D | null { return this.ctxs.content }
  getInteractCtx(): CanvasRenderingContext2D | null { return this.ctxs.interact }
  getInteractCanvas(): HTMLCanvasElement | null { return this.layers.interact }

  /** 滚动反偏移: 保持绝对定位画布固定于可视区顶部 */
  fixCanvasScrollOffset(scrollTop: number): void {
    const topPx = `${scrollTop}px`
    for (const key of ['static', 'content', 'interact'] as const) {
      const c = this.layers[key]
      if (c) c.style.top = topPx
    }
  }

  // ---- 尺寸管理 ----

  syncSizes(
    viewportW: number, viewportH: number, dpr: number,
    pageHeight: number, totalPages: number,
  ): void {
    const pagesInView = Math.ceil(viewportH / pageHeight) + this.OVERSCAN_PAGES * 2
    const canvasH = Math.min(pagesInView * pageHeight, totalPages * pageHeight)

    for (const key of ['static', 'content', 'interact'] as const) {
      const canvas = this.layers[key]!
      canvas.width = Math.ceil(viewportW * dpr)
      canvas.height = Math.ceil(canvasH * dpr)
      canvas.style.width = `${viewportW}px`
      canvas.style.height = `${canvasH}px`
    }

    // 更新滚动占位高度 = 全文档高度
    if (this.spacer) {
      this.spacer.style.height = `${totalPages * pageHeight}px`
    }
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

    for (let i = visibleRange.start; i <= visibleRange.end; i++) {
      const page = pages[i]
      if (!page) continue
      const pageY = (i - visibleRange.start) * page.height - scrollOffset

      // 页面背景
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, pageY, page.width, page.height)

      // 水印
      if (this.watermarkPattern) {
        ctx.fillStyle = this.watermarkPattern
        ctx.fillRect(0, pageY, page.width, page.height)
      }
    }
    ctx.restore()
  }

  // ---- 水印 ----

  prepareWatermark(wm: WatermarkConfig): void {
    if (wm.type !== 'tile') { this.watermarkPattern = null; return }
    const size = wm.spacing || 200
    const offscreen = document.createElement('canvas')
    offscreen.width = size; offscreen.height = size
    const octx = offscreen.getContext('2d')!
    octx.globalAlpha = wm.opacity ?? 0.08
    octx.font = `${wm.fontSize || 48}px "SimSun"`
    octx.fillStyle = wm.color || '#000000'
    octx.textAlign = 'center'; octx.textBaseline = 'middle'
    octx.translate(size / 2, size / 2)
    octx.rotate(((wm.rotation ?? 45) * Math.PI) / 180)
    octx.fillText(wm.text || '', 0, 0)
    this.watermarkPattern = this.ctxs.static!.createPattern(offscreen, 'repeat')
  }

  // ---- 光标闪烁 ----

  startCursorBlink(state: EditorRuntimeState): void {
    this.stopCursorBlink()
    this.blinkTimer = window.setInterval(() => {
      this.cursorVisible = !this.cursorVisible
      const ctx = this.ctxs.interact!
      const canvas = this.layers.interact!
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // 仅当光标可见且有有效位置时绘制
      if (this.cursorVisible && state.cursor.paragraphPath.length > 0) {
        // 光标位置由 Draw/LayoutEngine 提供的坐标来渲染
        // 此处仅管理闪烁状态和 clearing
      }

      // 选区始终绘制
      if (state.selection.active) {
        // 选区渲染
      }
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
    requestAnimationFrame(() => {
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
