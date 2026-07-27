// ============================================================
// Canvas 渲染器核心 - Draw 类
// 渲染管线: unzip → LineBreaker → PageBreaker → Position → Canvas
// ============================================================

import {
  type IElement,
  type ITr,
  type ITd,
  type IEditorOption,
  type IPageOffset,
  type IPosition,
  type IPage,
  EditorMode,
  PageMode,
  ZoneType,
  ElementType,
  DEFAULT_EDITOR_OPTIONS,
  DEFAULT_PAGE_SETUP,
  generateElementId,
  createControlElement,
  ControlType,
} from '../document/DocumentModel'
import { unzipElementList } from '../document/ElementFormatter'
import { TextMeasurer } from '../layout/TextMeasurer'
import { LineBreaker } from '../layout/LineBreaker'
import { PageBreaker } from '../layout/PageBreaker'
import { CommandManager, type ICommandContext, type ZoneSnapshot } from '../command/CommandManager'
import { ZoneEditCommand, ControlEditCommand, TableCellEditCommand } from '../command/commands'
import { TextParticle } from './particles/TextParticle'
import { Position } from '../state/Position'
import { RangeManager } from '../state/RangeManager'
import { EventBus } from '../EventBus'
import {
  KeyboardHandler,
  type KeyboardContext,
} from '../interaction/KeyboardHandler'
import { IMEHandler, type IMEContext } from '../interaction/IMEHandler'
import { MouseHandler, type MouseContext } from '../interaction/MouseHandler'

export class Draw implements KeyboardContext, IMEContext, ICommandContext, MouseContext {
  // Canvas (public for MouseContext interface)
  public container: HTMLElement
  public canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  public dpr: number

  // Subsystems
  private measurer: TextMeasurer
  private lineBreaker: LineBreaker
  private pageBreaker: PageBreaker
  public commandManager: CommandManager
  private position: Position
  public rangeManager: RangeManager
  private eventBus: EventBus
  private keyboardHandler: KeyboardHandler
  private imeHandler: IMEHandler
  private mouseHandler: MouseHandler

  // Config
  public options: IEditorOption
  public mode: EditorMode
  /** Whether the user explicitly set a scale in options — auto-resize won't override. */
  private userScale: boolean

  // Data
  public headerElements: IElement[] = []
  public mainElements: IElement[] = []
  public footerElements: IElement[] = []
  public positionList: IPosition[] = []
  private pages: IPage[] = []

  // State
  public scrollTop: number = 0
  private pageCount: number = 1
  cursorIndex: number = 0
  public activeZone: ZoneType = ZoneType.MAIN

  // IME composition preview text
  private composingText: string = ''

  // Focused form control (null = no control focused)
  private focusedControl: IElement | null = null

  // Focused table cell (null = no cell focused)
  private focusedCell: { tableEl: IElement; td: ITd } | null = null

  // Cache for loaded images to prevent redundant async loads and render loops
  private loadedImages: Map<string, HTMLImageElement> = new Map()

  // Event cleanup references
  private boundResize: () => void
  private boundCopy: (e: ClipboardEvent) => void
  private boundCut: (e: ClipboardEvent) => void
  private boundPaste: (e: ClipboardEvent) => void

  constructor(container: HTMLElement, options?: Partial<IEditorOption>) {
    this.container = container
    this.options = { ...DEFAULT_EDITOR_OPTIONS, ...options }
    this.mode = this.options.mode || EditorMode.EDIT
    // Track whether the user explicitly requested a scale — if so, preserve it across resize.
    this.userScale = options?.scale !== undefined

    // Canvas
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'emr-editor-canvas'
    this.canvas.style.display = 'block'
    this.canvas.style.position = 'absolute'
    this.canvas.style.top = '0'
    this.canvas.style.left = '50%'
    this.canvas.style.transform = 'translateX(-50%)'
    // tabIndex removed — keyboard/IME events go through hidden textarea proxy
    container.appendChild(this.canvas)

    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context not available')
    this.ctx = ctx
    this.dpr = window.devicePixelRatio || 1

    // Subsystems
    this.measurer = new TextMeasurer()
    this.lineBreaker = new LineBreaker(this.measurer)
    this.pageBreaker = new PageBreaker()
    this.commandManager = new CommandManager(this.options.historyMaxRecordCount || 100)
    this.position = new Position(DEFAULT_PAGE_SETUP, this.measurer)
    this.rangeManager = new RangeManager()
    this.eventBus = new EventBus()
    this.keyboardHandler = new KeyboardHandler(this)

    // Event listeners (save bound refs for cleanup)
    this.boundResize = this.onResize.bind(this)
    this.boundCopy = this.onCopy.bind(this)
    this.boundCut = this.onCut.bind(this)
    this.boundPaste = this.onPaste.bind(this)

    // IME handler — hidden textarea proxy for CJK input
    this.imeHandler = new IMEHandler(container, this)

    // Mouse handler — delegates all mouse/wheel events (Spec TASK-205)
    this.mouseHandler = new MouseHandler(this)

    // Compute initial layout so positionList is never empty
    this.recomputeLayout()

    this.bindEvents()
    this.resize()
  }

  // ---- KeyboardContext implementation ----

  private zoneElements(): IElement[] {
    if (this.activeZone === ZoneType.HEADER) return this.headerElements
    if (this.activeZone === ZoneType.FOOTER) return this.footerElements
    return this.mainElements
  }

  get elements(): IElement[] {
    return this.zoneElements()
  }

  onElementsChange(
    newElements: IElement[],
    newCursorIndex: number,
    addHistory: boolean
  ): void {
    const beforeCmd = addHistory ? this.snapshot() : null
    if (this.activeZone === ZoneType.HEADER) {
      this.headerElements = newElements
    } else if (this.activeZone === ZoneType.FOOTER) {
      this.footerElements = newElements
    } else {
      this.mainElements = newElements
    }
    this.cursorIndex = newCursorIndex
    if (beforeCmd) {
      this.commandManager.push(new ZoneEditCommand('text', beforeCmd, this.snapshot()))
    }
    this.recomputeLayout()
    this.render()
    this.eventBus.emit('contentChange', { type: 'contentChange', elements: newElements })
  }

  /** Build a combined flat list of all unzipped elements matching positionList order. */
  private allUnzipped(): IElement[] {
    return [
      ...unzipElementList(this.headerElements),
      ...unzipElementList(this.mainElements),
      ...unzipElementList(this.footerElements),
    ]
  }

  /**
   * Safe element lookup by global position index. For multi-page documents,
   * header/footer positions repeat per page and may exceed the combined
   * unzipped list length — in that case we wrap back to the original element.
   */
  public elementAtGlobal(globalIdx: number): IElement | undefined {
    const all = this.allUnzipped()
    if (globalIdx < all.length) return all[globalIdx]
    // Multi-page wrap: find the position and map back to the zone element
    const pos = this.positionList[globalIdx]
    if (!pos) return undefined
    const pZone = this.zoneFromY(pos.y)
    if (pZone === ZoneType.HEADER) {
      const hEls = unzipElementList(this.headerElements)
      if (hEls.length === 0) return undefined
      return hEls[(globalIdx - 0) % hEls.length]
    }
    if (pZone === ZoneType.FOOTER) {
      const fEls = unzipElementList(this.footerElements)
      if (fEls.length === 0) return undefined
      return fEls[(globalIdx - unzipElementList(this.headerElements).length - unzipElementList(this.mainElements).length) % fEls.length]
    }
    // MAIN zone — shouldn't repeat, fall back to direct lookup
    return all[globalIdx % all.length]
  }

  /** Determine zone from the element at a given global position index. */
  private zoneFromPosition(pos: IPosition): ZoneType {
    const hLen = unzipElementList(this.headerElements).length
    const mLen = unzipElementList(this.mainElements).length
    const total = hLen + mLen + unzipElementList(this.footerElements).length
    // Synthetic positions (e.g. trailing \n line) have indices beyond the
    // element range — fall back to Y-based zone detection.
    if (pos.index >= total) {
      return this.zoneFromY(pos.y)
    }
    if (pos.index < hLen) return ZoneType.HEADER
    if (pos.index < hLen + mLen) return ZoneType.MAIN
    return ZoneType.FOOTER
  }

  /** Determine zone from a document Y coordinate using actual content heights. */
  public zoneFromY(y: number): ZoneType {
    const setup = DEFAULT_PAGE_SETUP
    const pageHeight = setup.height + 20
    const pageIdx = Math.max(0, Math.floor(y / pageHeight))
    const pageY = pageIdx * pageHeight

    // Use the authoritative heights computed by Position (includes min + trailing \n)
    const headerBottom = pageY + setup.marginTop + this.position.headerHeight
    const footerTop = pageY + setup.height - setup.marginBottom - this.position.footerHeight

    if (y >= headerBottom && y < footerTop) return ZoneType.MAIN
    if (y >= footerTop) return ZoneType.FOOTER
    return ZoneType.HEADER
  }

  getNeighborIndex(currentIndex: number, lineDelta: number): number {
    const globalIdx = this.cursorToGlobalIndex(currentIndex)
    const neighborGlobal = this.position.getNeighborIndex(globalIdx, lineDelta)
    return this.globalToCursorIndex(neighborGlobal)
  }

  /**
   * Convert a global position-list index (from getIndexByCoord) to a
   * zone-relative cursor index. Uses modulo wrapping so multi-page
   * documents correctly map clicks on any page to the right zone position.
   * Returns the zone's element count when the click is past the last position.
   */
  public globalToCursorIndex(globalIdx: number): number {
    const hLen = unzipElementList(this.headerElements).length
    const mLen = unzipElementList(this.mainElements).length
    const fLen = unzipElementList(this.footerElements).length
    const total = hLen + mLen + fLen

    // Click past the end of all content → cursor at end of active zone
    if (globalIdx >= this.positionList.length) {
      if (this.activeZone === ZoneType.HEADER) return hLen
      if (this.activeZone === ZoneType.FOOTER) return fLen
      return mLen
    }

    if (total === 0) return 0

    // Wrap multi-page indices to their page-0 equivalent, then apply zone offset.
    // Page layout: [h0..hN][m0..mN][f0..fN] per page, repeated for multi-page.
    if (this.activeZone === ZoneType.HEADER) {
      if (hLen === 0) return 0
      const wrapped = globalIdx % total
      // wrapped is in [0, hLen) for header positions
      return wrapped < hLen ? wrapped : hLen
    }
    if (this.activeZone === ZoneType.FOOTER) {
      if (fLen === 0) return 0
      const wrapped = (globalIdx - hLen - mLen + total) % total
      return wrapped < fLen ? wrapped : fLen
    }
    // MAIN: positions start at hLen each page cycle
    if (mLen === 0) return 0
    const wrapped = (globalIdx - hLen + total) % total
    return wrapped < mLen ? wrapped : mLen
  }

  /**
   * Convert a zone-relative cursor index back to a global position-list index.
   * When zoneIdx equals the zone's element count (cursor at end), returns
   * the total position count so drawCursor can use the trailing-edge fallback.
   */
  private cursorToGlobalIndex(zoneIdx: number): number {
    const hLen = unzipElementList(this.headerElements).length
    const mLen = unzipElementList(this.mainElements).length
    const total = hLen + mLen + unzipElementList(this.footerElements).length

    if (this.activeZone === ZoneType.HEADER) {
      return zoneIdx >= hLen ? total : zoneIdx
    }
    if (this.activeZone === ZoneType.FOOTER) {
      const fLen = unzipElementList(this.footerElements).length
      return zoneIdx >= fLen ? total : hLen + mLen + zoneIdx
    }
    // MAIN
    return zoneIdx >= mLen ? total : hLen + zoneIdx
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

  // ---- MouseContext read-only accessors (Spec TASK-205) ----

  get isSelecting(): boolean { return this.rangeManager.isSelecting }
  get scale(): number { return this.options.scale || 1 }

  getIndexByCoord(x: number, y: number): number { return this.position.getIndexByCoord(x, y) }
  setCursorIndex(idx: number): void { this.cursorIndex = idx }
  setActiveZone(z: ZoneType): void { this.activeZone = z }
  setFocusedControl(el: IElement | null): void { this.focusedControl = el }
  setFocusedCell(c: { tableEl: IElement; td: ITd } | null): void { this.focusedCell = c }
  getFocusedControl(): IElement | null { return this.focusedControl }
  getFocusedCell(): { tableEl: IElement; td: ITd } | null { return this.focusedCell }
  getZoneElements(): IElement[] { return this.zoneElements() }
  startDrag(idx: number): void { this.rangeManager.startDrag(idx) }
  extendTo(idx: number): void { this.rangeManager.extendTo(idx) }
  endDrag(): void { this.rangeManager.endDrag() }
  clearRange(): void { this.rangeManager.clear() }
  requestRender(): void { this.render() }
  focusIME(): void { this.imeHandler.focus() }
  positionProxy(): void { this.imeHandler.positionProxy() }
  emitContentChange(els: IElement[]): void {
    this.eventBus.emit('contentChange', { type: 'contentChange', elements: els })
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

    this.ctx.setTransform(this.dpr * scale, 0, 0, this.dpr * scale, 0, -this.scrollTop * scale * this.dpr)

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

    // Composition preview (IME intermediate text with underline)
    if (this.composingText) {
      this.drawComposingText()
    }
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
    const allUnzipped = this.allUnzipped()

    if (pagePositions.length === 0 && allUnzipped.length > 0) {
      // Fallback: no precomputed positions — compute inline from pages
      const page = this.pages[pageIndex]
      if (!page) return
      let cy = pageY + _setup.marginTop
      for (const line of page.headerLines) {
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
      // Main starts after actual header (use computed height when available)
      cy = Math.max(cy, pageY + _setup.marginTop + (this.position.headerHeight || 50))
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
      // Footer positioned relative to bottom margin (use computed height when available)
      cy = pageY + _setup.height - _setup.marginBottom - (this.position.footerHeight || 40)
      for (const line of page.footerLines) {
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
    const hLen = unzipElementList(this.headerElements).length
    const mLen = unzipElementList(this.mainElements).length
    const fLen = unzipElementList(this.footerElements).length
    const totalUnzipped = hLen + mLen + fLen

    for (const pos of pagePositions) {
      // Sentinel position (index = Number.MAX_SAFE_INTEGER) — synthetic entry
      // for trailing \n cursor positioning only, skip rendering.
      if (pos.index >= 9007199254740990) continue

      const el = this.elementAtGlobal(pos.index)
      if (!el || el.value === '\n' || el.value === '​') continue

      // Selection highlight — convert global pos.index to zone-relative,
      // then compare only when the position's zone matches activeZone.
      // Multi-page: wrap pos.index by totalUnzipped to map page N positions
      // back to their equivalent page-0 indices before zone-relative mapping.
      if (hasSelection) {
        const pZone = this.zoneFromPosition(pos)
        if (pZone === this.activeZone) {
          const wrapped = totalUnzipped > 0 ? pos.index % totalUnzipped : pos.index
          let zoneIdx = wrapped
          if (pZone === ZoneType.MAIN) zoneIdx = wrapped - hLen
          else if (pZone === ZoneType.FOOTER) zoneIdx = wrapped - hLen - mLen
          if (zoneIdx >= 0 && zoneIdx >= selStart && zoneIdx < selEnd) {
            this.ctx.fillStyle = 'rgba(59, 130, 246, 0.25)'
            this.ctx.fillRect(pos.x, pos.y, pos.width, pos.height)
          }
        }
      }

      this.drawElement(el, pos.x, pos.y)
    }
  }

  private drawElement(el: IElement, x: number, y: number): void {
    // Dispatch to specialized renderers
    if (el.type === ElementType.TABLE) {
      this.drawTable(el, x, y)
      return
    }
    if (el.type === ElementType.IMAGE) {
      this.drawImageElement(el, x, y)
      return
    }
    if (el.type === ElementType.CONTROL) {
      this.drawControl(el, x, y)
      return
    }

    // ---- Text / Hyperlink / LaTeX — delegated to TextParticle (Spec TASK-107) ----
    TextParticle.render(this.ctx, el, x, y, this.options)
  }

  private drawHeaderFooter(
    px: number, py: number, zone: ZoneType, setup: typeof DEFAULT_PAGE_SETUP
  ): void {
    this.ctx.strokeStyle = '#CBD5E1'
    this.ctx.lineWidth = 1

    if (zone === ZoneType.HEADER) {
      const bottom = py + setup.marginTop + this.position.headerHeight
      this.ctx.beginPath()
      this.ctx.moveTo(px + setup.marginLeft, bottom)
      this.ctx.lineTo(px + setup.width - setup.marginRight, bottom)
      this.ctx.stroke()
    }
    if (zone === ZoneType.FOOTER) {
      const top = py + setup.height - setup.marginBottom - this.position.footerHeight
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
    // Don't draw document cursor when a table cell or control is focused —
    // the focused element renders its own cursor
    if (this.focusedCell || this.focusedControl) return

    const globalIdx = this.cursorToGlobalIndex(this.cursorIndex)
    let pos = this.positionList[globalIdx]

    // Cursor past the last element in the active zone
    const zoneEls = this.zoneElements()
    if (!pos && this.positionList.length > 0 && this.cursorIndex >= zoneEls.length) {
      // Find the last position belonging to the active zone
      let last: IPosition | null = null
      for (let i = this.positionList.length - 1; i >= 0; i--) {
        const p = this.positionList[i]
        const el = this.elementAtGlobal(p.index)
        if (el && this.zoneFromPosition(p) === this.activeZone) {
          last = p
          break
        }
      }

      // Only compute pos when we actually found a position in the zone.
      // Otherwise fall through to the empty-zone cursor below.
      if (last) {
        const lastEl = this.elementAtGlobal(last.index)
        if (lastEl && lastEl.value === '\n') {
          pos = {
            ...last,
            x: DEFAULT_PAGE_SETUP.marginLeft,
            y: last.y + last.height,
          }
        } else {
          pos = { ...last, x: last.x + last.width }
        }
      }
    }

    if (!pos) {
      const setup = DEFAULT_PAGE_SETUP
      const minFooter = setup.footerHeight || 40
      let cy = setup.marginTop
      if (this.activeZone === ZoneType.HEADER) {
        cy = setup.marginTop
      } else if (this.activeZone === ZoneType.FOOTER) {
        cy = setup.height - setup.marginBottom - minFooter
      } else {
        // MAIN: start at the header's actual bottom (dynamic, follows content)
        cy = setup.marginTop + (this.position.headerHeight || 50)
        for (const p of this.positionList) {
          if (this.zoneFromPosition(p) === ZoneType.HEADER) {
            const bottom = p.y + p.height
            if (bottom > cy) cy = bottom
          }
        }
      }
      this.ctx.strokeStyle = '#3B82F6'
      this.ctx.lineWidth = 2
      this.ctx.beginPath()
      this.ctx.moveTo(setup.marginLeft, cy)
      this.ctx.lineTo(setup.marginLeft, cy + 20)
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

  /** Render IME composition preview text with underline at cursor position. */
  private drawComposingText(): void {
    if (!this.composingText) return

    const globalIdx = this.cursorToGlobalIndex(this.cursorIndex)
    let pos = this.positionList[globalIdx]

    // Fallback: cursor may be past the end — find last position in active zone
    if (!pos && this.positionList.length > 0) {
      for (let i = this.positionList.length - 1; i >= 0; i--) {
        const p = this.positionList[i]
        const el = this.elementAtGlobal(p.index)
        if (el && this.zoneFromPosition(p) === this.activeZone) {
          const lastEl = this.elementAtGlobal(p.index)
          if (lastEl && lastEl.value === '\n') {
            pos = { ...p, x: DEFAULT_PAGE_SETUP.marginLeft, y: p.y + p.height }
          } else {
            pos = { ...p, x: p.x + p.width }
          }
          break
        }
      }
    }

    if (!pos) {
      // Empty zone fallback
      const setup = DEFAULT_PAGE_SETUP
      let cy = setup.marginTop
      if (this.activeZone === ZoneType.HEADER) {
        cy = setup.marginTop
      } else if (this.activeZone === ZoneType.FOOTER) {
        cy = setup.height - setup.marginBottom - (this.position.footerHeight || 40)
      } else {
        cy = setup.marginTop + (this.position.headerHeight || 50)
      }
      pos = { index: 0, pageIndex: 0, rowIndex: 0, x: setup.marginLeft, y: cy, width: 0, height: 20, ascent: 16, descent: 4 }
    }

    const styleEl = this.getCursorStyle()
    const fontSize = styleEl.size || 16
    const fontFamily = styleEl.font || 'SimSun'

    const fontParts: string[] = []
    if (styleEl.bold) fontParts.push('bold')
    if (styleEl.italic) fontParts.push('italic')
    fontParts.push(`${fontSize}px`)
    fontParts.push(`"${fontFamily}"`)
    this.ctx.font = fontParts.join(' ')
    this.ctx.fillStyle = styleEl.color || '#000000'

    const tx = pos.x
    const ty = pos.y + fontSize * 0.8
    this.ctx.fillText(this.composingText, tx, ty)

    // Underline to visually indicate it's composition (not committed)
    const tw = this.ctx.measureText(this.composingText).width
    this.ctx.strokeStyle = '#9CA3AF'
    this.ctx.lineWidth = 1
    this.ctx.setLineDash([2, 2])
    this.ctx.beginPath()
    this.ctx.moveTo(tx, ty + 2)
    this.ctx.lineTo(tx + tw, ty + 2)
    this.ctx.stroke()
    this.ctx.setLineDash([])
  }

  // ---- Table / Image / Control renderers ----

  private drawTable(el: IElement, x: number, y: number): void {
    const trList = el.trList
    if (!trList || trList.length === 0) return

    this.ctx.save()

    // ---- Pass 1: compute column widths (stretch to fill content area) ----
    let maxCols = 0
    for (const tr of trList) {
      let colCount = 0
      for (const td of tr.tdList) {
        colCount += td.colspan || 1
      }
      if (colCount > maxCols) maxCols = colCount
    }

    const contentW = DEFAULT_PAGE_SETUP.width - DEFAULT_PAGE_SETUP.marginLeft - DEFAULT_PAGE_SETUP.marginRight
    const defaultColW = Math.round(contentW / maxCols)
    const colWidths: number[] = new Array(maxCols).fill(defaultColW)

    // ---- Pass 2: build cell layout grid ----
    interface CellSlot { td: ITd; cx: number; cy: number; cw: number; ch: number }
    const grid: (CellSlot | null)[][] = trList.map(() => new Array(maxCols).fill(null))

    let rowY = y
    for (let ri = 0; ri < trList.length; ri++) {
      const tr = trList[ri]
      const rowHeight = tr.height || 30
      let ci = 0

      for (const td of tr.tdList) {
        // Skip columns covered by rowspan from previous rows
        while (ci < maxCols && grid[ri][ci] !== null) {
          ci++
        }
        if (ci >= maxCols) break

        // Compute cellX from current column position
        let cellX = x
        for (let c = 0; c < ci; c++) {
          cellX += colWidths[c]
        }

        const colspan = td.colspan || 1
        const rowspan = td.rowspan || 1

        // Compute cell width: sum of spanned columns
        let cellW = 0
        for (let s = 0; s < colspan && ci + s < maxCols; s++) {
          cellW += colWidths[ci + s]
        }
        // Compute cell height: sum of spanned rows
        let cellH = 0
        for (let s = 0; s < rowspan && ri + s < trList.length; s++) {
          cellH += trList[ri + s]?.height || 30
        }

        const slot: CellSlot = { td, cx: cellX, cy: rowY, cw: cellW, ch: cellH }

        // Mark all grid positions covered by this cell
        for (let rs = 0; rs < rowspan && ri + rs < trList.length; rs++) {
          for (let cs = 0; cs < colspan && ci + cs < maxCols; cs++) {
            grid[ri + rs][ci + cs] = slot
          }
        }

        cellX += cellW
        ci += colspan
      }

      rowY += rowHeight
    }

    // ---- Pass 3: render unique cells (dedupe by reference) ----
    const rendered = new Set<CellSlot>()
    const totalTableW = colWidths.reduce((a, b) => a + b, 0)
    const totalTableH = trList.reduce((h, tr) => h + (tr.height || 30), 0) + 2

    // Outer border
    this.ctx.strokeStyle = '#9CA3AF'
    this.ctx.lineWidth = 1
    this.ctx.strokeRect(x, y, totalTableW, totalTableH)

    for (let ri = 0; ri < grid.length; ri++) {
      for (let ci = 0; ci < maxCols; ci++) {
        const slot = grid[ri][ci]
        if (!slot || rendered.has(slot)) continue
        rendered.add(slot)

        const { td, cx, cy, cw, ch } = slot

        // Cell background
        if (td.backgroundColor) {
          this.ctx.fillStyle = td.backgroundColor
        } else if (td.isHeader) {
          this.ctx.fillStyle = '#F3F4F6'
        } else {
          this.ctx.fillStyle = '#FFFFFF'
        }
        this.ctx.fillRect(cx, cy, cw, ch)

        // Cell border
        const isFocused = this.focusedCell && this.focusedCell.tableEl.id === el.id && this.focusedCell.td === td
        this.ctx.strokeStyle = isFocused ? '#3B82F6' : (td.borderColor || '#D1D5DB')
        this.ctx.lineWidth = isFocused ? 2 : 0.5
        this.ctx.strokeRect(cx, cy, cw, ch)

        // Cell content — clipped to cell bounds to prevent overflow into adjacent cells
        const paddingX = 4
        const paddingY = 4
        let contentX = cx + paddingX
        const cellFontSize = el.size || 14

        this.ctx.save()
        this.ctx.beginPath()
        this.ctx.rect(cx + 1, cy + 1, cw - 2, ch - 2)
        this.ctx.clip()

        for (const childEl of td.value) {
          const childFontSize = childEl.size || cellFontSize
          const childFontFamily = childEl.font || el.font || 'SimSun'

          this.ctx.save()
          const fontParts: string[] = []
          if (childEl.bold || td.isHeader) fontParts.push('bold')
          if (childEl.italic) fontParts.push('italic')
          fontParts.push(`${childFontSize}px`)
          fontParts.push(`"${childFontFamily}"`)
          this.ctx.font = fontParts.join(' ')
          this.ctx.fillStyle = childEl.color || '#000000'

          const textY = td.verticalAlign === 'middle'
            ? cy + ch / 2 + childFontSize * 0.3
            : td.verticalAlign === 'bottom'
              ? cy + ch - paddingY
              : cy + paddingY + childFontSize * 0.8

          if (childEl.value && childEl.value !== '​' && childEl.value !== '\n') {
            this.ctx.fillText(childEl.value, contentX, textY)
            contentX += this.ctx.measureText(childEl.value).width
          }
          this.ctx.restore()
        }

        this.ctx.restore() // end cell content clip

        // Draw cursor in focused cell
        if (isFocused) {
          const curFontSize = el.size || 14
          let curBaseY: number
          if (td.verticalAlign === 'middle') {
            curBaseY = cy + ch / 2 + curFontSize * 0.3
          } else if (td.verticalAlign === 'bottom') {
            curBaseY = cy + ch - paddingY - curFontSize * 0.2
          } else {
            curBaseY = cy + paddingY + curFontSize * 0.8
          }
          this.ctx.strokeStyle = '#3B82F6'
          this.ctx.lineWidth = 1.5
          this.ctx.beginPath()
          this.ctx.moveTo(contentX, curBaseY - curFontSize * 0.8)
          this.ctx.lineTo(contentX, curBaseY + curFontSize * 0.2)
          this.ctx.stroke()
        }
      }
    }

    this.ctx.restore()
  }

  private drawImageElement(el: IElement, x: number, y: number): void {
    const img = el.imageData
    if (!img) return

    const w = img.width || 100
    const h = img.height || 100

    this.ctx.save()

    // Check cache first — draw cached image synchronously (no async trigger)
    if (img.src && this.loadedImages.has(img.src)) {
      const cached = this.loadedImages.get(img.src)!
      this.ctx.drawImage(cached, x, y, w, h)
      this.ctx.restore()
      return
    }

    // Placeholder frame while image loads
    this.ctx.fillStyle = '#F3F4F6'
    this.ctx.fillRect(x, y, w, h)
    this.ctx.strokeStyle = '#D1D5DB'
    this.ctx.lineWidth = 1
    this.ctx.setLineDash([4, 4])
    this.ctx.strokeRect(x, y, w, h)
    this.ctx.setLineDash([])

    // Placeholder text
    this.ctx.font = `12px Inter, sans-serif`
    this.ctx.fillStyle = '#9CA3AF'
    this.ctx.textAlign = 'center'
    this.ctx.fillText('[Image]', x + w / 2, y + h / 2 + 4)
    this.ctx.textAlign = 'start'

    // Async load and render (only once — onload caches and triggers a single re-render)
    if (img.src) {
      const image = new Image()
      image.onload = () => {
        // Cache the loaded image so subsequent renders draw synchronously
        this.loadedImages.set(img.src!, image)
        // Trigger a single re-render to replace the placeholder with the real image
        this.render()
      }
      image.onerror = () => {
        // On error, still mark as handled so we don't keep retrying
        this.loadedImages.set(img.src!, image)
      }
      image.src = img.src
    }

    this.ctx.restore()
  }

  private drawControl(el: IElement, x: number, y: number): void {
    const ctrl = el.control
    if (!ctrl) return

    const fontSize = el.size || 16
    const ctrlWidth = ctrl.width || 120
    // Match control height to text line height so it doesn't overflow
    const ctrlHeight = Math.round(fontSize * 1.15)

    this.ctx.save()

    // Checkbox — square box with checkmark
    // Radio — circle with filled dot
    if (ctrl.controlType === 'checkbox' || ctrl.controlType === 'radio') {
      const isRadio = ctrl.controlType === 'radio'
      const boxSize = Math.min(14, ctrlHeight - 2)
      const boxY = y + (ctrlHeight - boxSize) / 2

      this.ctx.fillStyle = '#FFFFFF'
      this.ctx.strokeStyle = '#6B7280'
      this.ctx.lineWidth = 1.5
      this.ctx.setLineDash([])

      if (isRadio) {
        // Circle outline + filled dot when checked
        const cx = x + 2 + boxSize / 2
        const cy = boxY + boxSize / 2
        const r = boxSize / 2
        this.ctx.beginPath()
        this.ctx.arc(cx, cy, r, 0, Math.PI * 2)
        this.ctx.fill()
        this.ctx.stroke()
        if (ctrl.checked) {
          this.ctx.fillStyle = '#2563EB'
          this.ctx.beginPath()
          this.ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2)
          this.ctx.fill()
        }
      } else {
        // Checkbox square + checkmark when checked
        this.ctx.fillRect(x + 2, boxY, boxSize, boxSize)
        this.ctx.strokeRect(x + 2, boxY, boxSize, boxSize)
        if (ctrl.checked) {
          this.ctx.strokeStyle = '#2563EB'
          this.ctx.lineWidth = 2
          this.ctx.beginPath()
          this.ctx.moveTo(x + 4, boxY + boxSize / 2)
          this.ctx.lineTo(x + boxSize / 2 + 2, boxY + boxSize - 3)
          this.ctx.lineTo(x + boxSize + 2, boxY + 2)
          this.ctx.stroke()
        }
      }
      // Label sits next to checkbox, aligned with text baseline
      const labelX = x + boxSize + 8
      this.ctx.font = `${fontSize}px "${el.font || 'SimSun'}"`
      this.ctx.fillStyle = '#374151'
      const textBaseY = y + fontSize * 0.8
      this.ctx.fillText(ctrl.placeholder || '', labelX, textBaseY)
      this.ctx.restore()
      return
    }

    // Input-like controls — inline with text
    const isFocused = this.focusedControl === el
    this.ctx.fillStyle = isFocused ? '#EFF6FF' : '#FFFFFF'
    this.ctx.fillRect(x, y, ctrlWidth, ctrlHeight)
    this.ctx.strokeStyle = isFocused ? '#3B82F6' : '#9CA3AF'
    this.ctx.lineWidth = isFocused ? 2 : 1
    this.ctx.setLineDash([])
    this.ctx.strokeRect(x, y, ctrlWidth, ctrlHeight)

    // Text inside control — align baseline with surrounding text, clipped to bounds
    this.ctx.save()
    this.ctx.beginPath()
    this.ctx.rect(x + 3, y, ctrlWidth - 6, ctrlHeight)
    this.ctx.clip()
    const textBaseY = y + fontSize * 0.8
    const displayValue = ctrl.value || ctrl.placeholder || ctrl.controlType || ''
    this.ctx.font = `${fontSize}px "${el.font || 'SimSun'}"`
    this.ctx.fillStyle = ctrl.value ? '#374151' : '#9CA3AF'
    this.ctx.fillText(displayValue, x + 4, textBaseY)
    this.ctx.restore()

    this.ctx.restore()
  }

  /** Find and update an element by reference in the current zone array. */
  public updateElementInZone(el: IElement): void {
    const zone = this.activeZone === ZoneType.HEADER
      ? this.headerElements : this.activeZone === ZoneType.FOOTER
        ? this.footerElements : this.mainElements
    const idx = zone.indexOf(el)
    if (idx >= 0) {
      zone[idx] = el
    }
  }

  /** Handle keyboard input when a form control is focused. */
  private handleControlKeyDown(e: KeyboardEvent): boolean {
    const ctrl = this.focusedControl!.control!
    const ctrlKey = e.ctrlKey || e.metaKey

    // Ctrl+Z/Y — global undo/redo, always work
    if (ctrlKey && e.key === 'z') { this.undo(); return true }
    if (ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { this.redo(); return true }

    switch (e.key) {
      case 'Escape':
        this.focusedControl = null
        this.render()
        return true
      case 'Enter':
      case 'Tab':
        this.focusedControl = null
        this.render()
        return true
      case 'Backspace':
        if (ctrl.value) {
          const _b = this.saveBefore()
          ctrl.value = ctrl.value.slice(0, -1)
          this.updateElementInZone(this.focusedControl!)
          this.render()
          this.eventBus.emit('contentChange', { type: 'contentChange', elements: this.zoneElements() })
          this.commitControlEdit('control backspace', _b)
        }
        return true
      case 'Delete':
        if (ctrl.value) {
          const _b = this.saveBefore()
          ctrl.value = ''
          this.updateElementInZone(this.focusedControl!)
          this.render()
          this.eventBus.emit('contentChange', { type: 'contentChange', elements: this.zoneElements() })
          this.commitControlEdit('control delete', _b)
        }
        return true
      default: {
        // Printable characters
        if (e.key.length === 1 && !ctrlKey && !e.altKey) {
          const _b = this.saveBefore()
          ctrl.value = (ctrl.value || '') + e.key
          this.updateElementInZone(this.focusedControl!)
          this.render()
          this.eventBus.emit('contentChange', { type: 'contentChange', elements: this.zoneElements() })
          this.commitControlEdit('control input', _b)
          return true
        }
        return false
      }
    }
  }

  /** Handle keyboard input when a table cell is focused. */
  private handleCellKeyDown(e: KeyboardEvent): boolean {
    const td = this.focusedCell!.td
    const ctrlKey = e.ctrlKey || e.metaKey

    if (ctrlKey && e.key === 'z') { this.undo(); return true }
    if (ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { this.redo(); return true }

    switch (e.key) {
      case 'Escape':
      case 'Tab':
      case 'Enter':
        this.focusedCell = null
        this.render()
        return true
      case 'Backspace': {
        const lastEl = td.value[td.value.length - 1]
        if (lastEl && lastEl.value && lastEl.value.length > 0) {
          const _b = this.saveBefore()
          lastEl.value = lastEl.value.slice(0, -1)
          if (lastEl.value === '') td.value.pop()
          this.recomputeLayout()
          this.render()
          this.eventBus.emit('contentChange', { type: 'contentChange', elements: this.zoneElements() })
          this.commitCellEdit('cell backspace', _b)
        } else if (lastEl && lastEl.value === '') {
          // Empty text element — remove it
          const _b = this.saveBefore()
          td.value.pop()
          this.recomputeLayout()
          this.render()
          this.eventBus.emit('contentChange', { type: 'contentChange', elements: this.zoneElements() })
          this.commitCellEdit('cell remove empty', _b)
        }
        return true
      }
      case 'Delete': {
        // Delete acts like clearing the cell: remove all content
        if (td.value.length > 0) {
          const _b = this.saveBefore()
          td.value = []
          this.recomputeLayout()
          this.render()
          this.eventBus.emit('contentChange', { type: 'contentChange', elements: this.zoneElements() })
          this.commitCellEdit('cell delete', _b)
        }
        return true
      }
      default: {
        if (e.key.length === 1 && !ctrlKey && !e.altKey) {
          const _b = this.saveBefore()
          const lastEl = td.value[td.value.length - 1]
          if (lastEl && lastEl.type === 'text' && !lastEl.bold && !lastEl.italic) {
            lastEl.value += e.key
          } else {
            td.value.push({
              id: generateElementId(),
              type: ElementType.TEXT,
              value: e.key,
              size: 14,
            })
          }
          this.recomputeLayout()
          this.render()
          this.eventBus.emit('contentChange', { type: 'contentChange', elements: this.zoneElements() })
          this.commitCellEdit('cell input', _b)
          return true
        }
        return false
      }
    }
  }

  // ---- Events ----

  private bindEvents(): void {
    window.addEventListener('resize', this.boundResize)
    // Mouse/wheel events delegated to MouseHandler (Spec TASK-205)
    this.mouseHandler.bind()
    // Keyboard / IME / input events are handled by IMEHandler's hidden textarea
    this.canvas.addEventListener('copy', this.boundCopy)
    this.canvas.addEventListener('cut', this.boundCut)
    this.canvas.addEventListener('paste', this.boundPaste)
  }

  private onResize(): void {
    if (!this.userScale) {
      const cw = this.container.clientWidth
      this.options.scale = cw > 0 ? Math.min(1, (cw - 40) / DEFAULT_PAGE_SETUP.width) : 1
    }
    this.render()
  }

  // ---- IMEContext implementation ----

  getCursorScreenPosition(): { x: number; y: number; height: number } | null {
    const scale = this.options.scale || 1
    const setup = DEFAULT_PAGE_SETUP

    // Canvas is centered within the container:
    //   canvas.style.left = '50%'
    //   canvas.style.transform = 'translateX(-50%)'
    // So its left edge relative to container:
    const containerWidth = this.container.clientWidth
    const canvasCSSWidth = setup.width * scale
    const canvasLeft = Math.max(0, (containerWidth - canvasCSSWidth) / 2)

    // Helper: doc coords → container-relative CSS coords
    const toContainer = (docX: number, docY: number) => ({
      x: canvasLeft + docX * scale,
      y: (docY - this.scrollTop) * scale,
    })

    if (this.positionList.length === 0) {
      const { x, y } = toContainer(setup.marginLeft, setup.marginTop)
      return { x, y, height: 20 * scale }
    }

    const globalIdx = this.cursorToGlobalIndex(this.cursorIndex)

    // Cursor past last element — use trailing edge of the last position
    if (globalIdx >= this.positionList.length) {
      const last = this.positionList[this.positionList.length - 1]
      const { x, y } = toContainer(last.x + last.width, last.y)
      return { x, y, height: last.height * scale }
    }

    const pos = this.positionList[globalIdx]
    if (!pos) return null

    const { x, y } = toContainer(pos.x, pos.y)
    return { x, y, height: pos.height * scale }
  }

  getCursorStyle(): Partial<IElement> {
    const elements = this.zoneElements()
    const idx = this.cursorIndex
    if (idx > 0 && idx <= elements.length) {
      return elements[idx - 1]
    }
    return elements.length > 0 ? elements[0] : {}
  }

  // insertText is called by IMEHandler on compositionend
  insertText(text: string, addHistory: boolean): void {
    // Route IME text to focused control
    if (this.focusedControl && this.focusedControl.control) {
      const _b = addHistory ? this.saveBefore() : null
      const ctrl = this.focusedControl.control
      ctrl.value = (ctrl.value || '') + text
      this.updateElementInZone(this.focusedControl)
      this.recomputeLayout()
      this.render()
      this.eventBus.emit('contentChange', { type: 'contentChange', elements: this.zoneElements() })
      if (_b) this.commitControlEdit('ime control', _b)
      return
    }

    // Route IME text to focused table cell
    if (this.focusedCell) {
      const _b = addHistory ? this.saveBefore() : null
      const td = this.focusedCell.td
      const lastEl = td.value[td.value.length - 1]
      if (lastEl && lastEl.type === 'text' && !lastEl.bold && !lastEl.italic) {
        lastEl.value += text
      } else {
        td.value.push({
          id: generateElementId(),
          type: ElementType.TEXT,
          value: text,
          size: 14,
        })
      }
      this.recomputeLayout()
      this.render()
      this.eventBus.emit('contentChange', { type: 'contentChange', elements: this.zoneElements() })
      if (_b) this.commitCellEdit('ime cell', _b)
      return
    }

    // Save history BEFORE mutation so undo can revert to pre-IME state
    const _b = addHistory ? this.saveBefore() : null

    if (this.rangeManager.hasRange) {
      // Delete selected range first, then insert
      const elements = this.zoneElements()
      const start = this.rangeManager.start
      const end = this.rangeManager.end
      this.rangeManager.clear()
      const before = elements.slice(0, start)
      const after = elements.slice(end)
      const insertIdx = start

      const newElements: IElement[] = []
      const styleEl = insertIdx > 0 ? elements[insertIdx - 1] : elements[0]
      for (const char of [...text]) {
        newElements.push({
          id: generateElementId(),
          type: ElementType.TEXT,
          value: char,
          font: styleEl?.font,
          size: styleEl?.size,
          bold: styleEl?.bold,
          italic: styleEl?.italic,
          underline: styleEl?.underline,
          color: styleEl?.color,
        })
      }

      const updated = [...before, ...newElements, ...after]
      if (this.activeZone === ZoneType.HEADER) {
        this.headerElements = updated
      } else if (this.activeZone === ZoneType.FOOTER) {
        this.footerElements = updated
      } else {
        this.mainElements = updated
      }
      this.cursorIndex = insertIdx + newElements.length
    } else {
      // Just insert at cursor
      const elements = [...this.zoneElements()]
      const idx = this.cursorIndex
      const newElements: IElement[] = []
      const styleEl = idx > 0 && idx <= elements.length ? elements[idx - 1] : elements[0]
      for (const char of [...text]) {
        newElements.push({
          id: generateElementId(),
          type: ElementType.TEXT,
          value: char,
          font: styleEl?.font,
          size: styleEl?.size,
          bold: styleEl?.bold,
          italic: styleEl?.italic,
          underline: styleEl?.underline,
          color: styleEl?.color,
        })
      }

      const before = elements.slice(0, idx)
      const after = elements.slice(idx)
      const updated = [...before, ...newElements, ...after]
      if (this.activeZone === ZoneType.HEADER) {
        this.headerElements = updated
      } else if (this.activeZone === ZoneType.FOOTER) {
        this.footerElements = updated
      } else {
        this.mainElements = updated
      }
      this.cursorIndex = idx + newElements.length
    }

    if (_b) this.commitZoneEdit('ime text', _b)

    this.recomputeLayout()
    this.render()
    this.eventBus.emit('contentChange', { type: 'contentChange', elements: this.zoneElements() })
  }

  getComposingText(): string {
    return this.composingText
  }

  setComposingText(text: string): void {
    this.composingText = text
  }

  isComposing(): boolean {
    return this.imeHandler.isComposing
  }

  focusCanvas(): void {
    this.canvas.focus()
  }

  /** IMEContext.forwardKeyDown — called by IMEHandler.textarea for non-IME keydown */
  forwardKeyDown(e: KeyboardEvent): boolean {
    return this.onKeyDownInternal(e)
  }

  // ---- Keyboard (now proxied through IMEHandler.textarea) ----

  private onKeyDownInternal(e: KeyboardEvent): boolean {
    // Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z → undo/redo
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl && !e.shiftKey && e.key === 'z') {
      this.undo()
      return true
    }
    if (ctrl && ((e.shiftKey && e.key === 'z') || e.key === 'y')) {
      this.redo()
      return true
    }

    // Skip normal keyboard handling during IME composition
    if (this.imeHandler.isComposing) return false

    // Route input to focused form control
    if (this.focusedControl && this.focusedControl.control) {
      return this.handleControlKeyDown(e)
    }

    // Route input to focused table cell
    if (this.focusedCell) {
      return this.handleCellKeyDown(e)
    }

    const handled = this.keyboardHandler.handleKeyDown(e)
    if (handled) {
      // Cursor may have moved — reposition the hidden textarea for IME
      this.imeHandler.positionProxy()
    }
    return handled
  }

  // ---- Clipboard ----

  private getSelectedText(): string {
    if (!this.rangeManager.hasRange) return ''
    const elements = this.zoneElements()
    const start = this.rangeManager.start
    const end = this.rangeManager.end
    let text = ''
    for (let i = start; i < end && i < elements.length; i++) {
      const el = elements[i]
      if (el.value && el.value !== '​') {
        text += el.value
      }
    }
    return text
  }

  private onCopy(e: ClipboardEvent): void {
    const text = this.getSelectedText()
    if (text) {
      e.preventDefault()
      e.clipboardData?.setData('text/plain', text)
    }
  }

  private onCut(e: ClipboardEvent): void {
    if (!this.rangeManager.hasRange) return
    const text = this.getSelectedText()
    if (text) {
      e.preventDefault()
      e.clipboardData?.setData('text/plain', text)

      const start = this.rangeManager.start
      const end = this.rangeManager.end
      this.rangeManager.clear()
      const _b = this.saveBefore()

      const elements = this.zoneElements()
      const before = elements.slice(0, start)
      const after = elements.slice(end)
      const updated = [...before, ...after]
      if (this.activeZone === ZoneType.HEADER) {
        this.headerElements = updated
      } else if (this.activeZone === ZoneType.FOOTER) {
        this.footerElements = updated
      } else {
        this.mainElements = updated
      }
      this.cursorIndex = start
      this.recomputeLayout()
      this.render()
      this.eventBus.emit('contentChange', { type: 'contentChange', elements: updated })
      this.commitZoneEdit('cut', _b)
    }
  }

  private onPaste(e: ClipboardEvent): void {
    const text = e.clipboardData?.getData('text/plain')
    if (!text) return

    e.preventDefault()

    const elements = [...this.zoneElements()]
    const _b = this.saveBefore()

    let insertIdx = this.cursorIndex
    if (this.rangeManager.hasRange) {
      const start = this.rangeManager.start
      const end = this.rangeManager.end
      const before = elements.slice(0, start)
      const after = elements.slice(end)
      elements.length = 0
      elements.push(...before, ...after)
      insertIdx = start
      this.rangeManager.clear()
    }

    // Inherit style from cursor position in the active zone.
    // Falls back to editor defaults when the zone is empty.
    const zoneEls = this.zoneElements()
    const styleEl: Partial<IElement> = insertIdx > 0 && insertIdx <= zoneEls.length
      ? zoneEls[insertIdx - 1]
      : zoneEls[0] || {}

    const newElements: IElement[] = []
    for (const char of [...text]) {
      newElements.push({
        id: generateElementId(),
        type: ElementType.TEXT,
        value: char,
        font: styleEl.font || this.options.defaultFont,
        size: styleEl.size || this.options.defaultSize,
        bold: styleEl.bold,
        italic: styleEl.italic,
        underline: styleEl.underline,
        color: styleEl.color || this.options.defaultColor,
      })
    }

    const updated = [...elements.slice(0, insertIdx), ...newElements, ...elements.slice(insertIdx)]
    if (this.activeZone === ZoneType.HEADER) {
      this.headerElements = updated
    } else if (this.activeZone === ZoneType.FOOTER) {
      this.footerElements = updated
    } else {
      this.mainElements = updated
    }
    this.cursorIndex = insertIdx + newElements.length
    this.recomputeLayout()
    this.render()
    this.eventBus.emit('contentChange', { type: 'contentChange', elements: updated })
    this.commitZoneEdit('paste', _b)
  }

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
    // Reset all editor state for the new document
    this.cursorIndex = 0
    this.scrollTop = 0
    this.activeZone = ZoneType.MAIN
    this.focusedControl = null
    this.focusedCell = null
    this.rangeManager.clear()
    this.commandManager.clear()
    this.recomputeLayout()
    this.render()
    // Reposition textarea to initial cursor position
    this.imeHandler.positionProxy()
    this.eventBus.emit('contentChange', { type: 'contentChange', elements: main })
  }

  setMode(mode: EditorMode): void {
    this.mode = mode
    this.render()
    this.eventBus.emit('modeChange', { mode })
  }

  setPageMode(_mode: PageMode): void {
    this.render()
  }

  // ---- Formatting API (called by Toolbar) ----

  toggleBold(): void { this.toggleElementProperty('bold') }
  toggleItalic(): void { this.toggleElementProperty('italic') }
  toggleUnderline(): void { this.toggleElementProperty('underline') }
  toggleStrikeout(): void { this.toggleElementProperty('strikeout') }
  toggleSuperscript(): void { this.toggleElementProperty('superscript') }
  toggleSubscript(): void { this.toggleElementProperty('subscript') }

  /** Apply a font family to the selected range or the element at cursor. */
  setFont(fontFamily: string): void {
    this.setElementProperty('font', fontFamily)
  }

  /** Apply a font size to the selected range or the element at cursor. */
  setFontSize(size: number): void {
    this.setElementProperty('size', size)
  }

  /** Apply a text color to the selected range or the element at cursor. */
  setTextColor(color: string): void {
    this.setElementProperty('color', color)
  }

  /**
   * Apply a scalar property value to the selected range or element at cursor.
   * Follows the same selection/no-selection branching as toggleElementProperty.
   */
  private setElementProperty(property: string, value: unknown): void {
    const elements = [...this.zoneElements()]
    const _b = this.saveBefore()

    if (this.rangeManager.hasRange) {
      const start = this.rangeManager.start
      const end = this.rangeManager.end
      const before = elements.slice(0, start)
      const selected = elements.slice(start, end)
      const after = elements.slice(end)

      const key = property as keyof IElement
      const formatted = selected.map(el => ({ ...el, [key]: value }))
      const updated = [...before, ...formatted, ...after]

      this.updateZoneElements(updated)
      this.cursorIndex = end
      this.rangeManager.setSelectionPoint(end)
      this.recomputeLayout()
      this.render()
      this.eventBus.emit('contentChange', { type: 'contentChange', elements: updated })
      return
    }

    // No selection — apply to element before cursor
    const idx = this.cursorIndex
    if (idx <= 0 || idx > elements.length) return

    const el = elements[idx - 1]
    const key = property as keyof IElement
    const newEl = { ...el, [key]: value }
    const updated = [...elements.slice(0, idx - 1), newEl, ...elements.slice(idx)]

    this.updateZoneElements(updated)
    // Font and size changes affect layout; color only needs re-render
    if (property === 'color') {
      this.render()
    } else {
      this.recomputeLayout()
      this.render()
    }
    this.eventBus.emit('contentChange', { type: 'contentChange', elements: updated })
    this.commitZoneEdit('set ' + property, _b)
  }

  /** Toggle a bullet (unordered list) marker at the start of the current paragraph. */
  toggleUnorderedList(): void {
    this.toggleListMarker('• ') // bullet character
  }

  /** Toggle a number (ordered list) marker at the start of the current paragraph. */
  toggleOrderedList(): void {
    this.toggleListMarker('1. ')
  }

  /** Insert or remove a list marker at the beginning of the current paragraph. */
  private toggleListMarker(marker: string): void {
    const elements = this.zoneElements()
    const { start } = this.getParagraphRange()
    const _b = this.saveBefore()

    // Check if the paragraph already starts with this marker
    const firstEl = elements[start]
    if (firstEl && firstEl.value?.startsWith(marker)) {
      // Remove marker
      const stripped = { ...firstEl, value: firstEl.value.slice(marker.length) }
      const updated = [...elements.slice(0, start), stripped, ...elements.slice(start + 1)]
      this.updateZoneElements(updated)
    } else {
      // Insert marker — prepend to the first text element at paragraph start
      if (firstEl && firstEl.type === ElementType.TEXT) {
        const marked = { ...firstEl, value: marker + (firstEl.value || '') }
        const updated = [...elements.slice(0, start), marked, ...elements.slice(start + 1)]
        this.updateZoneElements(updated)
      } else {
      // No text element at paragraph start — insert a new one.
      // Inherit style from the cursor position for visual consistency.
      const styleEl = this.getCursorStyle()
      const markerEl: IElement = {
        id: generateElementId(),
        type: ElementType.TEXT,
        value: marker,
        font: styleEl.font || this.options.defaultFont,
        size: styleEl.size || this.options.defaultSize,
        color: styleEl.color,
      }
      const updated = [...elements.slice(0, start), markerEl, ...elements.slice(start)]
      this.updateZoneElements(updated)
    }
    }

    this.commitZoneEdit('toggle list', _b)

    this.recomputeLayout()
    this.render()
    this.eventBus.emit('contentChange', { type: 'contentChange', elements: this.zoneElements() })
  }

  /** Increase indent of the current paragraph. */
  increaseIndent(): void {
    this.adjustIndent(24)
  }

  /** Decrease indent of the current paragraph. */
  decreaseIndent(): void {
    this.adjustIndent(-24)
  }

  private adjustIndent(delta: number): void {
    const elements = this.zoneElements()
    const { start, end } = this.getParagraphRange()
    const _b = this.saveBefore()

    const before = elements.slice(0, start)
    const paragraph = elements.slice(start, end)
    const after = elements.slice(end)
    const adjusted = paragraph.map(el => ({
      ...el,
      indent: Math.max(0, (el.indent || 0) + delta),
    }))
    const updated = [...before, ...adjusted, ...after]

    this.updateZoneElements(updated)
    this.commitZoneEdit('indent', _b)
    this.recomputeLayout()
    this.render()
    this.eventBus.emit('contentChange', { type: 'contentChange', elements: updated })
  }

  /** Replace the active zone's elements array with the given updated list. */
  private updateZoneElements(updated: IElement[]): void {
    if (this.activeZone === ZoneType.HEADER) {
      this.headerElements = updated
    } else if (this.activeZone === ZoneType.FOOTER) {
      this.footerElements = updated
    } else {
      this.mainElements = updated
    }
  }

  /**
   * Get the start/end indices of the paragraph containing the cursor.
   * A paragraph is delimited by \n elements (or zone boundaries).
   */
  private getParagraphRange(): { start: number; end: number } {
    const elements = this.zoneElements()
    const len = elements.length
    let start = 0
    let end = len

    // Search backwards for the nearest \n before the cursor
    for (let i = this.cursorIndex - 1; i >= 0; i--) {
      if (elements[i]?.value === '\n') { start = i + 1; break }
    }
    // Search forwards for the nearest \n at or after the cursor
    for (let i = this.cursorIndex; i < len; i++) {
      if (elements[i]?.value === '\n') { end = i; break }
    }

    return { start, end }
  }

  setAlignment(alignment: string): void {
    const elements = [...this.zoneElements()]
    if (elements.length === 0) return

    const rowFlexMap: Record<string, string> = {
      alignLeft: 'LEFT', alignCenter: 'CENTER',
      alignRight: 'RIGHT', alignJustify: 'JUSTIFY',
    }
    const rowFlex = rowFlexMap[alignment]
    if (!rowFlex) return

    // Scope to the paragraph containing the cursor (delimited by \n)
    const { start, end } = this.getParagraphRange()

    const _b = this.saveBefore()

    // Only mutate elements in the current paragraph
    const before = elements.slice(0, start)
    const paragraph = elements.slice(start, end)
    const after = elements.slice(end)
    const formatted = paragraph.map(el => ({ ...el, rowFlex: rowFlex as IElement['rowFlex'] }))
    const updated = [...before, ...formatted, ...after]
    if (this.activeZone === ZoneType.HEADER) {
      this.headerElements = updated
    } else if (this.activeZone === ZoneType.FOOTER) {
      this.footerElements = updated
    } else {
      this.mainElements = updated
    }
    this.commitZoneEdit('align ' + alignment, _b)
    this.recomputeLayout()
    this.render()
    this.eventBus.emit('contentChange', { type: 'contentChange', elements: updated })
  }
  // Skipping recomputeLayout for these avoids a full unzip→linebreak→pagebreak→position pipeline.
  private static readonly STYLE_ONLY_PROPERTIES = new Set<string>([
    'underline', 'strikeout', 'superscript', 'subscript',
  ])

  private toggleElementProperty(property: string): void {
    const elements = [...this.zoneElements()]

    // Save history before any mutation
    const _b = this.saveBefore()

    // Format selected range — apply to all elements in the selection
    if (this.rangeManager.hasRange) {
      const start = this.rangeManager.start
      const end = this.rangeManager.end
      const before = elements.slice(0, start)
      const selected = elements.slice(start, end)
      const after = elements.slice(end)

      const key = property as keyof IElement
      const formatted = selected.map(el => ({ ...el, [key]: !el[key] }))
      const updated = [...before, ...formatted, ...after]

      if (this.activeZone === ZoneType.HEADER) {
        this.headerElements = updated
      } else if (this.activeZone === ZoneType.FOOTER) {
        this.footerElements = updated
      } else {
        this.mainElements = updated
      }

      // Keep cursor at end of formatted range; clear selection on next interaction
      this.cursorIndex = end
      this.rangeManager.setSelectionPoint(end)
      // Style-only changes (underline, strikeout, etc.) don't need full relayout
      if (Draw.STYLE_ONLY_PROPERTIES.has(property)) {
        this.render()
      } else {
        this.recomputeLayout()
        this.render()
      }
      this.eventBus.emit('contentChange', { type: 'contentChange', elements: updated })
      this.commitZoneEdit('toggle ' + property, _b)
      return
    }
    const idx = this.cursorIndex
    if (idx <= 0 || idx > elements.length) return

    const el = elements[idx - 1]
    const key = property as keyof IElement
    const newEl = { ...el, [key]: !el[key] }

    const before = elements.slice(0, idx - 1)
    const after = elements.slice(idx)
    const updated = [...before, newEl, ...after]
    if (this.activeZone === ZoneType.HEADER) {
      this.headerElements = updated
    } else if (this.activeZone === ZoneType.FOOTER) {
      this.footerElements = updated
    } else {
      this.mainElements = updated
    }
    if (Draw.STYLE_ONLY_PROPERTIES.has(property)) {
      this.render()
    } else {
      this.recomputeLayout()
      this.render()
    }
    this.eventBus.emit('contentChange', { type: 'contentChange', elements: updated })
    this.commitZoneEdit('toggle ' + property, _b)
  }

  /** Insert a table at the current cursor position. */
  insertTable(rows: number, cols: number): void {
    const style = this.getCursorStyle()
    const cellFontSize = style.size || 14
    const trList: ITr[] = []
    for (let r = 0; r < rows; r++) {
      const tdList: ITd[] = []
      for (let c = 0; c < cols; c++) {
        tdList.push({
          width: 120,
          value: [{ id: generateElementId(), type: ElementType.TEXT, value: '', size: cellFontSize }],
          isHeader: false,
        })
      }
      trList.push({ height: 30, tdList })
    }

    const tableEl: IElement = {
      id: generateElementId(),
      type: ElementType.TABLE,
      value: '',
      trList,
      font: style.font,
      size: style.size,
    }

    this._insertElement(tableEl)
  }

  /** Insert a form control at the current cursor position. */
  insertControl(controlType: string): void {
    const style = this.getCursorStyle()
    const ctrlEl = createControlElement(
      controlType as ControlType,
      { size: style.size || 16, font: style.font || 'SimSun' }
    )
    this._insertElement(ctrlEl)
  }

  /** Insert an image at the current cursor position. */
  insertImage(src: string, width: number, height: number): void {
    const imgEl: IElement = {
      id: generateElementId(),
      type: ElementType.IMAGE,
      value: '',
      imageData: { src, width, height, originalWidth: width, originalHeight: height },
    }
    this._insertElement(imgEl)
  }

  /** Shared logic for inserting an element at cursor. */
  private _insertElement(el: IElement): void {
    const _b = this.saveBefore()
    const elements = [...this.zoneElements()]
    const idx = this.cursorIndex
    const updated = [...elements.slice(0, idx), el, ...elements.slice(idx)]

    if (this.activeZone === ZoneType.HEADER) {
      this.headerElements = updated
    } else if (this.activeZone === ZoneType.FOOTER) {
      this.footerElements = updated
    } else {
      this.mainElements = updated
    }
    this.cursorIndex = idx + 1
    this.recomputeLayout()
    this.render()
    this.imeHandler.positionProxy()
    this.eventBus.emit('contentChange', { type: 'contentChange', elements: updated })
    this.commitZoneEdit('insert element', _b)
  }

  getEventBus(): EventBus { return this.eventBus }

  undo(): void {
    const cmd = this.commandManager.undo(this)
    if (cmd) {
      this.recomputeLayout()
      this.render()
      this.imeHandler.positionProxy()
      this.eventBus.emit('contentChange', { type: 'contentChange', elements: this.zoneElements() })
    }
  }

  redo(): void {
    const cmd = this.commandManager.redo(this)
    if (cmd) {
      this.recomputeLayout()
      this.render()
      this.imeHandler.positionProxy()
      this.eventBus.emit('contentChange', { type: 'contentChange', elements: this.zoneElements() })
    }
  }

  canUndo(): boolean { return this.commandManager.canUndo() }
  canRedo(): boolean { return this.commandManager.canRedo() }

  // ---- ICommandContext implementation ----
  clearFocused(): void {
    this.focusedControl = null
    this.focusedCell = null
  }

  /**
   * Convenience: capture a snapshot of the current state.
   * Used by commands to record before/after state.
   */
  private snapshot(): ZoneSnapshot {
    return {
      header: this.headerElements,
      main: this.mainElements,
      footer: this.footerElements,
      cursorIndex: this.cursorIndex,
      activeZone: this.activeZone,
    }
  }

  /** Record pre-mutation state. Call before mutating. */
  public saveBefore(): ZoneSnapshot { return this.snapshot() }

  /** Create & push a ZoneEditCommand after mutation completed. */
  public commitZoneEdit(desc: string, before: ZoneSnapshot): void {
    this.commandManager.push(new ZoneEditCommand(desc, before, this.snapshot()))
  }

  /** Create & push a ControlEditCommand after mutation completed. */
  private commitControlEdit(desc: string, before: ZoneSnapshot): void {
    this.commandManager.push(new ControlEditCommand(desc, before, this.snapshot()))
  }

  /** Create & push a TableCellEditCommand after mutation completed. */
  private commitCellEdit(desc: string, before: ZoneSnapshot): void {
    this.commandManager.push(new TableCellEditCommand(desc, before, this.snapshot()))
  }

  getPageSetup() {
    return { ...DEFAULT_PAGE_SETUP }
  }

  getScale(): number { return this.options.scale || 1 }

  // ---- Lifecycle ----

  resize(): void { this.onResize() }

  focus(): void {
    // Focus the hidden textarea (IME proxy) so it can receive keyboard + IME events
    this.imeHandler.focus()
  }

  destroy(): void {
    window.removeEventListener('resize', this.boundResize)
    this.mouseHandler.unbind()
    this.canvas.removeEventListener('copy', this.boundCopy)
    this.canvas.removeEventListener('cut', this.boundCut)
    this.canvas.removeEventListener('paste', this.boundPaste)
    this.imeHandler.destroy()
    this.measurer.destroy()
    this.eventBus.removeAll()
    if (this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas)
    }
  }
}
