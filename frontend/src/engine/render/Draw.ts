// ============================================================
// Canvas 渲染器核心 - Draw 类
// 中心渲染编排器，协调所有子系统
// ============================================================

import {
  type IElement,
  type IEditorOption,
  type IDrawPayload,
  type IPageOffset,
  EditorMode,
  PageMode,
  ElementType,
  ZoneType,
  DEFAULT_EDITOR_OPTIONS,
  DEFAULT_PAGE_SETUP,
} from '../document/DocumentModel'
import { unzipElementList } from '../document/ElementFormatter'
import { TextMeasurer } from '../layout/TextMeasurer'
import { HistoryManager } from '../state/HistoryManager'
import { Position } from '../state/Position'
import { EventBus } from '../EventBus'

export class Draw {
  // Canvas 相关
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private dpr: number

  // 子系统
  private measurer: TextMeasurer
  private historyManager: HistoryManager
  private position: Position
  private eventBus: EventBus

  // 配置与状态
  public options: IEditorOption
  private mode: EditorMode

  // 数据
  private headerElements: IElement[] = []
  private mainElements: IElement[] = []
  private footerElements: IElement[] = []
  private computeElements: IElement[] = []

  // 渲染状态
  private scrollTop: number = 0
  private pageCount: number = 1
  private cursorIndex: number = 0

  constructor(container: HTMLElement, options?: Partial<IEditorOption>) {
    this.options = { ...DEFAULT_EDITOR_OPTIONS, ...options }
    this.mode = this.options.mode || EditorMode.EDIT

    // 创建 Canvas
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'emr-editor-canvas'
    this.canvas.style.display = 'block'
    this.canvas.style.position = 'absolute'
    this.canvas.style.top = '0'
    this.canvas.style.left = '0'
    container.appendChild(this.canvas)

    this.ctx = this.canvas.getContext('2d')!
    this.dpr = window.devicePixelRatio || 1

    // 初始化子系统
    this.measurer = new TextMeasurer()
    this.historyManager = new HistoryManager(this.options.historyMaxRecordCount)
    this.position = new Position(DEFAULT_PAGE_SETUP)
    this.eventBus = new EventBus()

    // 绑定事件
    this.bindEvents()
    this.resize()
  }

  // ==================== 公共方法 ====================

  render(payload: IDrawPayload = {}): void {
    const {
      isCompute = true,
      isSetCursor = false,
      isSubmitHistory = true,
    } = payload

    try {
      if (isCompute) {
        this.computeLayout()
      }
      this.drawPages()

      if (isSetCursor) {
        this.setCursor()
      }

      if (isSubmitHistory) {
        this.historyManager.saveState(this.mainElements)
      }
    } catch (err) {
      console.error('[Draw.render] render error:', err)
    }
  }

  private computeLayout(): void {
    this.computeElements = [
      ...unzipElementList(this.headerElements),
      ...unzipElementList(this.mainElements),
      ...unzipElementList(this.footerElements),
    ]
    this.pageCount = Math.max(1, Math.ceil(this.computeElements.length / 50))
  }

  private drawPages(): void {
    const pageSetup = DEFAULT_PAGE_SETUP
    const scale = this.options.scale || 1

    const totalHeight = this.pageCount * (pageSetup.height + 20)
    this.canvas.width = pageSetup.width * scale * this.dpr
    this.canvas.height = totalHeight * scale * this.dpr
    this.canvas.style.width = `${pageSetup.width * scale}px`
    this.canvas.style.height = `${totalHeight * scale}px`

    this.ctx.setTransform(this.dpr * scale, 0, 0, this.dpr * scale, 0, -this.scrollTop * scale)

    this.ctx.fillStyle = '#E5E7EB'
    this.ctx.fillRect(0, this.scrollTop, pageSetup.width, totalHeight)

    for (let i = 0; i < this.pageCount; i++) {
      const pageOffset: IPageOffset = {
        x: 0,
        y: i * (pageSetup.height + 20),
        pageIndex: i,
      }
      this.drawPage(i, pageOffset)
    }

    this.drawCursor()
  }

  private drawPage(pageIndex: number, offset: IPageOffset): void {
    const pageSetup = DEFAULT_PAGE_SETUP
    const { x, y } = offset

    // 页面阴影
    this.ctx.shadowColor = 'rgba(0, 0, 0, 0.1)'
    this.ctx.shadowBlur = 8
    this.ctx.shadowOffsetX = 0
    this.ctx.shadowOffsetY = 2

    this.ctx.fillStyle = '#FFFFFF'
    this.ctx.fillRect(x, y, pageSetup.width, pageSetup.height)

    this.ctx.shadowColor = 'transparent'
    this.ctx.shadowBlur = 0
    this.ctx.shadowOffsetY = 0

    if (this.mode === EditorMode.EDIT || this.mode === EditorMode.DESIGN) {
      this.drawMarginLines(x, y)
    }

    this.drawContentArea(pageIndex, x, y)
    this.drawHeaderFooter(x, y, ZoneType.HEADER)
    this.drawHeaderFooter(x, y, ZoneType.FOOTER)
    this.drawPageNumber(pageIndex, x, y)
  }

  private drawMarginLines(pageX: number, pageY: number): void {
    const setup = DEFAULT_PAGE_SETUP
    this.ctx.strokeStyle = '#E5E7EB'
    this.ctx.lineWidth = 1
    this.ctx.setLineDash([4, 4])

    // Top
    this.ctx.beginPath()
    this.ctx.moveTo(pageX, pageY + setup.marginTop)
    this.ctx.lineTo(pageX + setup.width, pageY + setup.marginTop)
    this.ctx.stroke()
    // Bottom
    this.ctx.beginPath()
    this.ctx.moveTo(pageX, pageY + setup.height - setup.marginBottom)
    this.ctx.lineTo(pageX + setup.width, pageY + setup.height - setup.marginBottom)
    this.ctx.stroke()
    // Left
    this.ctx.beginPath()
    this.ctx.moveTo(pageX + setup.marginLeft, pageY)
    this.ctx.lineTo(pageX + setup.marginLeft, pageY + setup.height)
    this.ctx.stroke()
    // Right
    this.ctx.beginPath()
    this.ctx.moveTo(pageX + setup.width - setup.marginRight, pageY)
    this.ctx.lineTo(pageX + setup.width - setup.marginRight, pageY + setup.height)
    this.ctx.stroke()

    this.ctx.setLineDash([])
  }

  private drawContentArea(pageIndex: number, pageX: number, pageY: number): void {
    const setup = DEFAULT_PAGE_SETUP
    const startX = pageX + setup.marginLeft
    const startY = pageY + setup.marginTop + 50 // header height
    const maxWidth = setup.width - setup.marginLeft - setup.marginRight

    let currentX = startX
    let currentY = startY
    let currentLineHeight = 20
    const elementsPerPage = 50

    const startIndex = pageIndex * elementsPerPage
    const endIndex = Math.min(startIndex + elementsPerPage, this.computeElements.length)

    for (let i = startIndex; i < endIndex; i++) {
      const el = this.computeElements[i]
      if (!el) continue

      if (el.type === ElementType.PAGE_BREAK) {
        currentY += currentLineHeight
        continue
      }

      const charWidth = this.measurer.measureWidth(el.value || ' ', {
        font: el.font || 'SimSun',
        size: el.size || 16,
        bold: el.bold,
        italic: el.italic,
      })

      if (currentX + charWidth > startX + maxWidth && el.value !== '​') {
        currentX = startX
        currentY += currentLineHeight
      }

      this.drawElement(el, currentX, currentY)
      currentX += charWidth
      currentLineHeight = (el.lineHeight || 1.5) * (el.size || 16)
    }
  }

  private drawElement(el: IElement, x: number, y: number): void {
    const fontSize = el.size || 16
    const fontFamily = el.font || 'SimSun'

    const fontParts: string[] = []
    if (el.bold) fontParts.push('bold')
    if (el.italic) fontParts.push('italic')
    fontParts.push(`${fontSize}px`)
    fontParts.push(`"${fontFamily}"`)
    this.ctx.font = fontParts.join(' ')

    if (el.revision) {
      switch (el.revision.type) {
        case 'insert': this.ctx.fillStyle = '#16A34A'; break
        case 'delete': this.ctx.fillStyle = '#DC2626'; break
        case 'modify': this.ctx.fillStyle = '#2563EB'; break
      }
    } else {
      this.ctx.fillStyle = el.color || '#000000'
    }

    if (el.highlight) {
      const textWidth = this.ctx.measureText(el.value).width
      this.ctx.fillStyle = el.highlight
      this.ctx.fillRect(x, y - fontSize * 0.8, textWidth, fontSize * 1.2)
      this.ctx.fillStyle = el.color || '#000000'
    }

    if (el.value && el.value !== '​') {
      this.ctx.fillText(el.value, x, y + fontSize * 0.8)
    }

    if (el.underline) {
      this.ctx.strokeStyle = el.color || '#000000'
      this.ctx.lineWidth = 1
      const underlineY = y + fontSize * 0.9
      const textWidth = this.ctx.measureText(el.value).width
      this.ctx.beginPath()
      this.ctx.moveTo(x, underlineY)
      this.ctx.lineTo(x + textWidth, underlineY)
      if (el.underlineStyle === 'wave') {
        this.ctx.setLineDash([2, 2])
      }
      this.ctx.stroke()
      this.ctx.setLineDash([])
    }

    if (el.strikeout) {
      this.ctx.strokeStyle = el.color || '#000000'
      this.ctx.lineWidth = 1
      const strikeY = y + fontSize * 0.4
      const textWidth = this.ctx.measureText(el.value).width
      this.ctx.beginPath()
      this.ctx.moveTo(x, strikeY)
      this.ctx.lineTo(x + textWidth, strikeY)
      this.ctx.stroke()
    }
  }

  private drawHeaderFooter(pageX: number, pageY: number, zone: ZoneType): void {
    const setup = DEFAULT_PAGE_SETUP
    this.ctx.strokeStyle = '#E5E7EB'
    this.ctx.lineWidth = 1

    if (zone === ZoneType.HEADER) {
      const headerBottom = pageY + setup.marginTop + 50
      this.ctx.beginPath()
      this.ctx.moveTo(pageX + setup.marginLeft, headerBottom)
      this.ctx.lineTo(pageX + setup.width - setup.marginRight, headerBottom)
      this.ctx.stroke()
    }

    if (zone === ZoneType.FOOTER) {
      const footerTop = pageY + setup.height - setup.marginBottom - 40
      this.ctx.beginPath()
      this.ctx.moveTo(pageX + setup.marginLeft, footerTop)
      this.ctx.lineTo(pageX + setup.width - setup.marginRight, footerTop)
      this.ctx.stroke()
    }
  }

  private drawPageNumber(pageIndex: number, pageX: number, pageY: number): void {
    const setup = DEFAULT_PAGE_SETUP
    const pageNum = `${pageIndex + 1} / ${this.pageCount}`
    this.ctx.font = '12px Inter, sans-serif'
    this.ctx.fillStyle = '#9CA3AF'
    this.ctx.textAlign = 'center'
    const numY = pageY + setup.height - setup.marginBottom + 24
    this.ctx.fillText(pageNum, pageX + setup.width / 2, numY)
    this.ctx.textAlign = 'left'
  }

  private drawCursor(): void {
    if (this.mode === EditorMode.READONLY || this.mode === EditorMode.PRINT) return

    const cursorPos = this.position.getPositionByIndex(this.cursorIndex)
    if (!cursorPos) return

    this.ctx.strokeStyle = '#3B82F6'
    this.ctx.lineWidth = 2
    this.ctx.beginPath()
    this.ctx.moveTo(cursorPos.x, cursorPos.y)
    this.ctx.lineTo(cursorPos.x, cursorPos.y + (cursorPos.height || 20))
    this.ctx.stroke()
  }

  private setCursor(): void {
    // TODO: Update cursor position based on current edit operation
  }

  // ==================== 公共 API ====================

  getValue(): { header: IElement[]; main: IElement[]; footer: IElement[] } {
    return {
      header: this.headerElements,
      main: this.mainElements,
      footer: this.footerElements,
    }
  }

  setValue(header: IElement[], main: IElement[], footer: IElement[]): void {
    this.headerElements = header
    this.mainElements = main
    this.footerElements = footer
    this.render({ isCompute: true, isSubmitHistory: false })
  }

  setMode(mode: EditorMode): void {
    this.mode = mode
    this.render({ isCompute: false, isSubmitHistory: false })
    this.eventBus.emit('modeChange', { mode })
  }

  setPageMode(_mode: PageMode): void {
    this.render({ isCompute: false, isSubmitHistory: false })
  }

  getEventBus(): EventBus {
    return this.eventBus
  }

  undo(): void {
    const elements = this.historyManager.undo()
    if (elements) {
      this.mainElements = elements
      this.render({ isCompute: true, isSubmitHistory: false })
    }
  }

  redo(): void {
    const elements = this.historyManager.redo()
    if (elements) {
      this.mainElements = elements
      this.render({ isCompute: true, isSubmitHistory: false })
    }
  }

  canUndo(): boolean {
    return this.historyManager.canUndo()
  }

  canRedo(): boolean {
    return this.historyManager.canRedo()
  }

  // ==================== 窗口事件 ====================

  private bindEvents(): void {
    window.addEventListener('resize', this.resize.bind(this))
    this.canvas.addEventListener('wheel', this.onWheel.bind(this))
  }

  private resize(): void {
    const containerWidth = (this.canvas.parentElement as HTMLElement)?.clientWidth || 1200
    if (containerWidth > 0) {
      this.options.scale = 1
      this.render({ isCompute: false, isSubmitHistory: false })
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault()
    this.scrollTop = Math.max(0, this.scrollTop + e.deltaY)
    this.render({ isCompute: false, isSubmitHistory: false })
  }

  // ==================== 生命周期 ====================

  destroy(): void {
    window.removeEventListener('resize', this.resize.bind(this))
    this.measurer.destroy()
    this.eventBus.removeAll()
    if (this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas)
    }
  }
}
