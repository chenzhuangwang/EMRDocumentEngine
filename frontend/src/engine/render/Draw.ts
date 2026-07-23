// ============================================================
// Canvas 渲染器核心 - Draw 类
// 渲染管线: unzip → LineBreaker → PageBreaker → Position → Canvas
// ============================================================

import {
  type IElement,
  type IEditorOption,
  type IPageOffset,
  type IPosition,
  type IPage,
  EditorMode,
  PageMode,
  ZoneType,
  DEFAULT_EDITOR_OPTIONS,
  DEFAULT_PAGE_SETUP,
} from '../document/DocumentModel'
import { unzipElementList } from '../document/ElementFormatter'
import { TextMeasurer } from '../layout/TextMeasurer'
import { LineBreaker } from '../layout/LineBreaker'
import { PageBreaker } from '../layout/PageBreaker'
import { HistoryManager } from '../state/HistoryManager'
import { Position } from '../state/Position'
import { RangeManager } from '../state/RangeManager'
import { EventBus } from '../EventBus'
import {
  KeyboardHandler,
  type KeyboardContext,
} from '../interaction/KeyboardHandler'

export class Draw implements KeyboardContext {
  // Canvas
  private container: HTMLElement
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private dpr: number

  // Subsystems
  private measurer: TextMeasurer
  private lineBreaker: LineBreaker
  private pageBreaker: PageBreaker
  private historyManager: HistoryManager
  private position: Position
  public rangeManager: RangeManager
  private eventBus: EventBus
  private keyboardHandler: KeyboardHandler

  // Config
  public options: IEditorOption
  private mode: EditorMode

  // Data
  private headerElements: IElement[] = []
  private mainElements: IElement[] = []
  private footerElements: IElement[] = []
  private positionList: IPosition[] = []
  private pages: IPage[] = []

  // State
  private scrollTop: number = 0
  private pageCount: number = 1
  cursorIndex: number = 0

  // Event cleanup references
  private boundResize: () => void
  private boundWheel: (e: WheelEvent) => void
  private boundKeyDown: (e: KeyboardEvent) => void
  private boundMouseDown: (e: MouseEvent) => void
  private boundMouseMove: (e: MouseEvent) => void
  private boundMouseUp: (e: MouseEvent) => void

  constructor(container: HTMLElement, options?: Partial<IEditorOption>) {
    this.container = container
    this.options = { ...DEFAULT_EDITOR_OPTIONS, ...options }
    this.mode = this.options.mode || EditorMode.EDIT

    // Canvas
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'emr-editor-canvas'
    this.canvas.style.display = 'block'
    this.canvas.style.position = 'absolute'
    this.canvas.style.top = '0'
    this.canvas.style.left = '50%'
    this.canvas.style.transform = 'translateX(-50%)'
    this.canvas.tabIndex = 0
    container.appendChild(this.canvas)

    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context not available')
    this.ctx = ctx
    this.dpr = window.devicePixelRatio || 1

    // Subsystems
    this.measurer = new TextMeasurer()
    this.lineBreaker = new LineBreaker(this.measurer)
    this.pageBreaker = new PageBreaker()
    this.historyManager = new HistoryManager(this.options.historyMaxRecordCount)
    this.position = new Position(DEFAULT_PAGE_SETUP, this.measurer)
    this.rangeManager = new RangeManager()
    this.eventBus = new EventBus()
    this.keyboardHandler = new KeyboardHandler(this)

    // Event listeners (save bound refs for cleanup)
    this.boundResize = this.onResize.bind(this)
    this.boundWheel = this.onWheel.bind(this)
    this.boundKeyDown = this.onKeyDown.bind(this)
    this.boundMouseDown = this.onMouseDown.bind(this)
    this.boundMouseMove = this.onMouseMove.bind(this)
    this.boundMouseUp = this.onMouseUp.bind(this)

    this.bindEvents()
    this.resize()
  }

  // ---- KeyboardContext implementation ----

  get elements(): IElement[] {
    return this.mainElements
  }

  onElementsChange(
    newElements: IElement[],
    newCursorIndex: number,
    addHistory: boolean
  ): void {
    if (addHistory) {
      this.historyManager.saveState(this.mainElements)
    }
    this.mainElements = newElements
    this.cursorIndex = newCursorIndex
    this.recomputeLayout()
    this.render()
    this.eventBus.emit('contentChange', { type: 'contentChange', elements: newElements })
  }

  // ---- Layout ----

  private recomputeLayout(): void {
    const pageSetup = DEFAULT_PAGE_SETUP
    const contentWidth = pageSetup.width - pageSetup.marginLeft - pageSetup.marginRight

    // 1. Unzip elements
    const headerUnzipped = unzipElementList(this.headerElements)
    const mainUnzipped = unzipElementList(this.mainElements)
    const footerUnzipped = unzipElementList(this.footerElements)

    // 2. Line breaking
    const breakOptions = {
      maxWidth: contentWidth,
      wordBreak: this.options.wordBreak || 'break-all' as const,
      defaultFont: this.options.defaultFont || 'SimSun',
      defaultSize: this.options.defaultSize || 16,
    }

    const headerLines = this.lineBreaker.breakLines(headerUnzipped, breakOptions)
    const mainLines = this.lineBreaker.breakLines(mainUnzipped, breakOptions)
    const footerLines = this.lineBreaker.breakLines(footerUnzipped, breakOptions)

    // 3. Page breaking
    this.pages = this.pageBreaker.breakPages(mainLines, headerLines, footerLines, pageSetup)
    this.pageCount = this.pages.length

    // 4. Position computation
    this.positionList = this.position.computePositions(this.pages, pageSetup)
  }

  // ---- Render ----

  render(): void {
    const pageSetup = DEFAULT_PAGE_SETUP
    const scale = this.options.scale || 1

    const totalHeight = this.pageCount * (pageSetup.height + 20)
    const canvasW = Math.ceil(pageSetup.width * scale * this.dpr)
    const canvasH = Math.ceil(totalHeight * scale * this.dpr)

    if (this.canvas.width !== canvasW) this.canvas.width = canvasW
    if (this.canvas.height !== canvasH) this.canvas.height = canvasH
    this.canvas.style.width = `${pageSetup.width * scale}px`
    this.canvas.style.height = `${totalHeight * scale}px`

    this.ctx.setTransform(this.dpr * scale, 0, 0, this.dpr * scale, 0, -this.scrollTop * scale)

    // Background
    this.ctx.fillStyle = '#E5E7EB'
    this.ctx.fillRect(0, this.scrollTop, pageSetup.width, totalHeight)

    // Draw pages
    for (let i = 0; i < this.pageCount; i++) {
      const pageOffset: IPageOffset = {
        x: 0,
        y: i * (pageSetup.height + 20),
        pageIndex: i,
      }
      this.drawPage(i, pageOffset)
    }

    // Cursor overlay
    this.drawCursor()
  }

  private drawPage(pageIndex: number, offset: IPageOffset): void {
    const pageSetup = DEFAULT_PAGE_SETUP
    const { x, y } = offset

    // Background with shadow
    this.ctx.save()
    this.ctx.shadowColor = 'rgba(0, 0, 0, 0.1)'
    this.ctx.shadowBlur = 8
    this.ctx.shadowOffsetX = 0
    this.ctx.shadowOffsetY = 2
    this.ctx.fillStyle = '#FFFFFF'
    this.ctx.fillRect(x, y, pageSetup.width, pageSetup.height)
    this.ctx.restore()

    // Margin lines in edit/design mode
    if (this.mode === EditorMode.EDIT || this.mode === EditorMode.DESIGN) {
      this.drawMarginLines(x, y, pageSetup)
    }

    // Content using pre-computed positions
    this.drawContentFromPositions(pageIndex, x, y, pageSetup)

    // Header/footer dividers
    this.drawHeaderFooter(x, y, ZoneType.HEADER, pageSetup)
    this.drawHeaderFooter(x, y, ZoneType.FOOTER, pageSetup)

    // Page number
    this.drawPageNumber(pageIndex, x, y, pageSetup)
  }

  private drawMarginLines(
    px: number, py: number, setup: typeof DEFAULT_PAGE_SETUP
  ): void {
    this.ctx.strokeStyle = '#E5E7EB'
    this.ctx.lineWidth = 1
    this.ctx.setLineDash([4, 4])

    const margins = [
      [px, py + setup.marginTop, px + setup.width, py + setup.marginTop],
      [px, py + setup.height - setup.marginBottom, px + setup.width, py + setup.height - setup.marginBottom],
      [px + setup.marginLeft, py, px + setup.marginLeft, py + setup.height],
      [px + setup.width - setup.marginRight, py, px + setup.width - setup.marginRight, py + setup.height],
    ]
    for (const [x1, y1, x2, y2] of margins) {
      this.ctx.beginPath()
      this.ctx.moveTo(x1, y1)
      this.ctx.lineTo(x2, y2)
      this.ctx.stroke()
    }
    this.ctx.setLineDash([])
  }

  /**
   * Render content using pre-computed position list (main pipeline output).
   * Falls back to inline rendering when positions are stale.
   */
  private drawContentFromPositions(
    pageIndex: number,
    pageX: number,
    pageY: number,
    _setup: typeof DEFAULT_PAGE_SETUP
  ): void {
    // Filter positions for current page
    const pagePositions = this.positionList.filter(p => p.pageIndex === pageIndex)
    const mainUnzipped = unzipElementList(this.mainElements)

    if (pagePositions.length === 0 && mainUnzipped.length > 0) {
      // Fallback: no precomputed positions — compute inline from pages
      const page = this.pages[pageIndex]
      if (!page) return
      let cy = pageY + _setup.marginTop + 50
      for (const line of page.lines) {
        let cx = pageX + _setup.marginLeft
        for (const el of line.elements) {
          this.drawElement(el, cx, cy)
          cx += this.measurer.measureWidth(el.value || '', {
            font: el.font || this.options.defaultFont || 'SimSun',
            size: el.size || this.options.defaultSize || 16,
            bold: el.bold,
            italic: el.italic,
          })
        }
        cy += line.height
      }
      return
    }

    // Draw using precomputed positions (global coordinates — pos.x / pos.y
    // already include page offsets, do NOT add pageX / pageY).
    const selStart = this.rangeManager.start
    const selEnd = this.rangeManager.end
    const hasSelection = this.rangeManager.hasRange

    for (const pos of pagePositions) {
      const el = mainUnzipped[pos.index]
      if (!el || el.value === '\n' || el.value === '​') continue

      // Selection highlight
      if (hasSelection && pos.index >= selStart && pos.index < selEnd) {
        this.ctx.fillStyle = 'rgba(59, 130, 246, 0.25)'
        this.ctx.fillRect(pos.x, pos.y, pos.width, pos.height)
      }

      this.drawElement(el, pos.x, pos.y)
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

    // Color (revisions take priority)
    if (el.revision) {
      const revColors: Record<string, string> = {
        insert: '#16A34A', delete: '#DC2626', modify: '#2563EB',
      }
      this.ctx.fillStyle = revColors[el.revision.type] || '#000000'
    } else {
      this.ctx.fillStyle = el.color || this.options.defaultColor || '#000000'
    }

    // Highlight background
    if (el.highlight) {
      const tw = this.ctx.measureText(el.value).width
      this.ctx.fillStyle = el.highlight
      this.ctx.fillRect(x, y - fontSize * 0.8, tw, fontSize * 1.2)
      this.ctx.fillStyle = el.color || '#000000'
    }

    // Draw text (skip zero-width joiner and newline)
    if (el.value && el.value !== '​' && el.value !== '\n') {
      this.ctx.fillText(el.value, x, y + fontSize * 0.8)
    }

    // Underline
    if (el.underline) {
      this.ctx.strokeStyle = el.color || '#000000'
      this.ctx.lineWidth = 1
      const uy = y + fontSize * 0.9
      const tw = this.ctx.measureText(el.value).width
      this.ctx.beginPath()
      this.ctx.moveTo(x, uy)
      this.ctx.lineTo(x + tw, uy)
      if (el.underlineStyle === 'wave') this.ctx.setLineDash([2, 2])
      this.ctx.stroke()
      this.ctx.setLineDash([])
    }

    // Strikethrough
    if (el.strikeout) {
      this.ctx.strokeStyle = el.color || '#000000'
      this.ctx.lineWidth = 1
      const sy = y + fontSize * 0.4
      const tw = this.ctx.measureText(el.value).width
      this.ctx.beginPath()
      this.ctx.moveTo(x, sy)
      this.ctx.lineTo(x + tw, sy)
      this.ctx.stroke()
    }
  }

  private drawHeaderFooter(
    px: number, py: number, zone: ZoneType, setup: typeof DEFAULT_PAGE_SETUP
  ): void {
    this.ctx.strokeStyle = '#E5E7EB'
    this.ctx.lineWidth = 1

    if (zone === ZoneType.HEADER) {
      const bottom = py + setup.marginTop + 50
      this.ctx.beginPath()
      this.ctx.moveTo(px + setup.marginLeft, bottom)
      this.ctx.lineTo(px + setup.width - setup.marginRight, bottom)
      this.ctx.stroke()
    }
    if (zone === ZoneType.FOOTER) {
      const top = py + setup.height - setup.marginBottom - 40
      this.ctx.beginPath()
      this.ctx.moveTo(px + setup.marginLeft, top)
      this.ctx.lineTo(px + setup.width - setup.marginRight, top)
      this.ctx.stroke()
    }
  }

  private drawPageNumber(
    pageIndex: number, px: number, py: number, setup: typeof DEFAULT_PAGE_SETUP
  ): void {
    this.ctx.save()
    this.ctx.font = '12px Inter, sans-serif'
    this.ctx.fillStyle = '#9CA3AF'
    this.ctx.textAlign = 'center'
    const ny = py + setup.height - setup.marginBottom + 24
    this.ctx.fillText(`${pageIndex + 1} / ${this.pageCount}`, px + setup.width / 2, ny)
    this.ctx.restore()
  }

  private drawCursor(): void {
    if (this.mode === EditorMode.READONLY || this.mode === EditorMode.PRINT) return

    let pos = this.positionList[this.cursorIndex]

    if (!pos && this.positionList.length > 0 && this.cursorIndex >= this.positionList.length) {
      const last = this.positionList[this.positionList.length - 1]
      pos = { ...last, x: last.x + last.width }
    }

    if (!pos) {
      const setup = DEFAULT_PAGE_SETUP
      this.ctx.strokeStyle = '#3B82F6'
      this.ctx.lineWidth = 2
      this.ctx.beginPath()
      this.ctx.moveTo(setup.marginLeft, setup.marginTop + 50)
      this.ctx.lineTo(setup.marginLeft, setup.marginTop + 50 + 20)
      this.ctx.stroke()
      return
    }

    this.ctx.strokeStyle = '#3B82F6'
    this.ctx.lineWidth = 2
    this.ctx.beginPath()
    this.ctx.moveTo(pos.x, pos.y)
    this.ctx.lineTo(pos.x, pos.y + pos.height)
    this.ctx.stroke()
  }

  // ---- Events ----

  private bindEvents(): void {
    window.addEventListener('resize', this.boundResize)
    this.canvas.addEventListener('wheel', this.boundWheel, { passive: false })
    this.container.addEventListener('wheel', this.boundWheel, { passive: false })
    this.canvas.addEventListener('keydown', this.boundKeyDown)
    this.canvas.addEventListener('mousedown', this.boundMouseDown)
    window.addEventListener('mousemove', this.boundMouseMove)
    window.addEventListener('mouseup', this.boundMouseUp)
  }

  private onResize(): void {
    const cw = this.container.clientWidth
    this.options.scale = cw > 0 ? Math.min(1, (cw - 40) / DEFAULT_PAGE_SETUP.width) : 1
    this.render()
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault()
    this.scrollTop = Math.max(0, this.scrollTop + e.deltaY)
    this.render()
  }

  private onKeyDown(e: KeyboardEvent): void {
    const handled = this.keyboardHandler.handleKeyDown(e)
    if (handled) {
      e.preventDefault()
    }
  }

  // ---- Mouse Events ----

  private clientToDoc(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    const scale = this.options.scale || 1

    const cssX = clientX - rect.left
    const cssY = clientY - rect.top

    const bufToCssX = rect.width > 0 ? this.canvas.width / rect.width : 1
    const bufToCssY = rect.height > 0 ? this.canvas.height / rect.height : 1

    const bufX = cssX * bufToCssX
    const bufY = cssY * bufToCssY

    const docX = bufX / (this.dpr * scale)
    const docY = bufY / (this.dpr * scale) + this.scrollTop

    return { x: docX, y: docY }
  }

  private onMouseDown(e: MouseEvent): void {
    if (this.mode === EditorMode.READONLY || this.mode === EditorMode.PRINT) return

    const { x, y } = this.clientToDoc(e.clientX, e.clientY)
    const index = this.position.getIndexByCoord(x, y)

    this.rangeManager.startDrag(index)
    this.cursorIndex = index
    this.render()
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.rangeManager.isSelecting) return

    const { x, y } = this.clientToDoc(e.clientX, e.clientY)
    const index = this.position.getIndexByCoord(x, y)

    if (index !== this.cursorIndex) {
      this.rangeManager.extendTo(index)
      this.cursorIndex = index
      this.render()
    }
  }

  private onMouseUp(_e: MouseEvent): void {
    if (!this.rangeManager.isSelecting) return
    this.rangeManager.endDrag()
    this.render()
  }

  // ---- Public API ----

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
    this.recomputeLayout()
    this.render()
  }

  setMode(mode: EditorMode): void {
    this.mode = mode
    this.render()
    this.eventBus.emit('modeChange', { mode })
  }

  setPageMode(_mode: PageMode): void {
    this.render()
  }

  getEventBus(): EventBus { return this.eventBus }

  undo(): void {
    const elems = this.historyManager.undo()
    if (elems) {
      this.mainElements = elems
      this.recomputeLayout()
      this.render()
    }
  }

  redo(): void {
    const elems = this.historyManager.redo()
    if (elems) {
      this.mainElements = elems
      this.recomputeLayout()
      this.render()
    }
  }

  canUndo(): boolean { return this.historyManager.canUndo() }
  canRedo(): boolean { return this.historyManager.canRedo() }

  getPageSetup() {
    return { ...DEFAULT_PAGE_SETUP }
  }

  getScale(): number { return this.options.scale || 1 }

  // ---- Lifecycle ----

  resize(): void { this.onResize() }

  focus(): void { this.canvas.focus() }

  destroy(): void {
    window.removeEventListener('resize', this.boundResize)
    this.canvas.removeEventListener('wheel', this.boundWheel)
    this.container.removeEventListener('wheel', this.boundWheel)
    this.canvas.removeEventListener('keydown', this.boundKeyDown)
    this.canvas.removeEventListener('mousedown', this.boundMouseDown)
    window.removeEventListener('mousemove', this.boundMouseMove)
    window.removeEventListener('mouseup', this.boundMouseUp)
    this.measurer.destroy()
    this.eventBus.removeAll()
    if (this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas)
    }
  }
}
