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
  /** 图片水印 URL (type='image' 或 'tile-image' 时) */
  imageUrl?: string
  /** 图片水印缩放比例 */
  imageScale?: number
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
  private watermarkConfig: WatermarkConfig | null = null
  private watermarkImage: HTMLImageElement | null = null
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
    const scale = this.coordSystem.transform.scale
    // 视口在文档坐标中的可视范围
    const docViewportH = viewportH / scale
    const pagesInView = Math.ceil(docViewportH / pageHeight) + this.OVERSCAN_PAGES * 2
    const canvasHDoc = Math.min(pagesInView * pageHeight, totalPages * pageHeight)

    for (const key of ['static', 'content', 'interact'] as const) {
      const canvas = this.layers[key]!
      canvas.width = Math.ceil(viewportW * dpr)
      canvas.height = Math.ceil(canvasHDoc * scale * dpr)
      canvas.style.width = `${viewportW}px`
      canvas.style.height = `${canvasHDoc * scale}px`
    }

    // 更新滚动占位高度 = 全文档高度 × 缩放
    if (this.spacer) {
      this.spacer.style.height = `${totalPages * pageHeight * scale}px`
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

  private prepareImageWatermark(wm: WatermarkConfig): void {
    const img = new Image()
    img.src = wm.imageUrl!
    img.onload = () => { this.watermarkImage = img }
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
    ctx.drawImage(this.watermarkImage, ix, iy, iw, ih)
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
    this.blinkTimer = window.setInterval(() => {
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
