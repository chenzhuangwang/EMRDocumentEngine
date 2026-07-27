// ============================================================
// MouseHandler — 鼠标事件处理器 (Spec TASK-205)
//
// 从 Draw.ts 抽离全部鼠标监听、坐标换算、元素命中检测、
// 拖拽选区、控件交互代码。Draw.ts 通过 MouseContext 接口
// 提供数据访问和状态修改能力，MouseHandler 不直接操作 Canvas。
// ============================================================

import type { IElement, ITd, IPosition } from '../document/DocumentModel'
import { DEFAULT_PAGE_SETUP, ElementType, EditorMode, ZoneType } from '../document/DocumentModel'
import type { ZoneSnapshot } from '../command/CommandManager'

// ============================================================
// MouseContext — MouseHandler 与 Draw 的通信接口
// ============================================================

export interface MouseContext {
  // ---- 坐标/尺寸 ----
  readonly canvas: HTMLCanvasElement
  readonly container: HTMLElement
  readonly dpr: number
  readonly scale: number
  readonly mode: string

  // ---- 滚动/位置 ----
  scrollTop: number
  readonly positionList: IPosition[]

  // ---- 方法：坐标与查表 ----
  getIndexByCoord(x: number, y: number): number
  elementAtGlobal(idx: number): IElement | undefined
  zoneFromY(y: number): ZoneType
  globalToCursorIndex(globalIdx: number): number
  getZoneElements(): IElement[]

  // ---- 方法：状态修改 ----
  setCursorIndex(idx: number): void
  setActiveZone(zone: ZoneType): void
  setFocusedControl(el: IElement | null): void
  setFocusedCell(cell: { tableEl: IElement; td: ITd } | null): void
  getFocusedControl(): IElement | null
  getFocusedCell(): { tableEl: IElement; td: ITd } | null

  // ---- 选区 ----
  readonly isSelecting: boolean
  startDrag(idx: number): void
  extendTo(idx: number): void
  endDrag(): void
  clearRange(): void

  // ---- 命令/历史 ----
  saveBefore(): ZoneSnapshot
  commitZoneEdit(desc: string, before: ZoneSnapshot): void
  updateElementInZone(el: IElement): void

  // ---- 渲染与 IME ----
  requestRender(): void
  positionProxy(): void
  focusIME(): void
  emitContentChange(els: IElement[]): void
}

// ============================================================
// MouseHandler
// ============================================================

export class MouseHandler {
  private ctx: MouseContext

  // Bound event handlers for add/remove
  private boundWheel: (e: WheelEvent) => void
  private boundMouseDown: (e: MouseEvent) => void
  private boundMouseMove: (e: MouseEvent) => void
  private boundMouseUp: (e: MouseEvent) => void
  private boundDoubleClick: (e: MouseEvent) => void

  // Scroll/tracking
  private prevIdx: number | undefined

  constructor(ctx: MouseContext) {
    this.ctx = ctx
    this.boundWheel = this.onWheel.bind(this)
    this.boundMouseDown = this.onMouseDown.bind(this)
    this.boundMouseMove = this.onMouseMove.bind(this)
    this.boundMouseUp = this.onMouseUp.bind(this)
    this.boundDoubleClick = this.onDoubleClick.bind(this)
  }

  /** Attach all mouse/wheel listeners. Call once after construction. */
  bind(): void {
    this.ctx.canvas.addEventListener('wheel', this.boundWheel, { passive: false })
    this.ctx.canvas.addEventListener('mousedown', this.boundMouseDown)
    this.ctx.canvas.addEventListener('dblclick', this.boundDoubleClick)
    window.addEventListener('mousemove', this.boundMouseMove)
    window.addEventListener('mouseup', this.boundMouseUp)
  }

  /** Remove all listeners. Call on destroy. */
  unbind(): void {
    this.ctx.canvas.removeEventListener('wheel', this.boundWheel)
    this.ctx.canvas.removeEventListener('mousedown', this.boundMouseDown)
    this.ctx.canvas.removeEventListener('dblclick', this.boundDoubleClick)
    window.removeEventListener('mousemove', this.boundMouseMove)
    window.removeEventListener('mouseup', this.boundMouseUp)
  }

  // ---- Coordinate conversion ----

  /** Convert client (viewport) coordinates to document coordinates. */
  clientToDoc(clientX: number, clientY: number): { x: number; y: number } {
    const { canvas, dpr, scale, scrollTop } = this.ctx
    const rect = canvas.getBoundingClientRect()

    const cssX = clientX - rect.left
    const cssY = clientY - rect.top

    const bufToCssX = rect.width > 0 ? canvas.width / rect.width : 1
    const bufToCssY = rect.height > 0 ? canvas.height / rect.height : 1

    const bufX = cssX * bufToCssX
    const bufY = cssY * bufToCssY

    const docX = bufX / (dpr * scale)
    const docY = bufY / (dpr * scale) + scrollTop

    return { x: docX, y: docY }
  }

  // ---- Wheel ----

  onWheel(e: WheelEvent): void {
    e.preventDefault()
    const setup = DEFAULT_PAGE_SETUP
    const { scale, container, positionList, scrollTop } = this.ctx
    // Derive pageCount from the last position's pageIndex (avoid reading Draw's private field)
    let pageCount = 1
    if (positionList.length > 0) {
      pageCount = (positionList[positionList.length - 1]?.pageIndex ?? 0) + 1
    }
    const totalHeight = pageCount * (setup.height + 20)
    const maxScroll = Math.max(0, totalHeight - container.clientHeight / (scale || 1))
    this.ctx.scrollTop = Math.max(0, Math.min(maxScroll, scrollTop + e.deltaY))
    this.ctx.requestRender()
  }

  /** Handle container resize — auto-scale delegatd to Draw.onResize. */
  onResize(): void {
    // The caller (Draw) handles auto-scale logic since scale is on Draw.options.
  }

  // ---- Table hit testing ----

  private hitTestTable(
    tableEl: IElement,
    clickX: number,
    clickY: number,
  ): { td: ITd; cx: number; cy: number; cw: number; ch: number } | null {
    const trList = tableEl.trList
    if (!trList) return null

    let maxCols = 0
    for (const tr of trList) {
      let colCount = 0
      for (const td of tr.tdList) colCount += td.colspan || 1
      if (colCount > maxCols) maxCols = colCount
    }

    const contentW = DEFAULT_PAGE_SETUP.width - DEFAULT_PAGE_SETUP.marginLeft - DEFAULT_PAGE_SETUP.marginRight
    const colWidths = new Array(maxCols).fill(Math.round(contentW / maxCols))

    let ry = 0
    for (let ri = 0; ri < trList.length; ri++) {
      const tr = trList[ri]
      const rowH = tr.height || 30
      let cxAcc = 0
      let ci = 0
      for (const td of tr.tdList) {
        const colspan = td.colspan || 1
        let cw = 0
        for (let s = 0; s < colspan && ci + s < maxCols; s++) cw += colWidths[ci + s]
        let ch = 0
        const rowspan = td.rowspan || 1
        for (let s = 0; s < rowspan && ri + s < trList.length; s++) {
          ch += trList[ri + s]?.height || 30
        }

        if (clickX >= cxAcc && clickX < cxAcc + cw && clickY >= ry && clickY < ry + ch) {
          return { td, cx: cxAcc, cy: ry, cw, ch }
        }
        cxAcc += cw
        ci += colspan
      }
      ry += rowH
    }
    return null
  }

  // ---- Control click handling ----

  private handleControlClick(el: IElement): void {
    const ctrl = el.control
    if (!ctrl) return

    if (ctrl.controlType === 'checkbox' || ctrl.controlType === 'radio') {
      const _b = this.ctx.saveBefore()
      ctrl.checked = !ctrl.checked
      this.ctx.updateElementInZone(el)
      this.ctx.requestRender()
      this.ctx.emitContentChange(this.ctx.getZoneElements())
      this.ctx.commitZoneEdit('toggle ' + ctrl.controlType, _b)
      return
    }

    const focusable = ['input', 'textarea', 'number', 'date', 'select']
    if (focusable.includes(ctrl.controlType)) {
      this.ctx.setFocusedControl(el)
      this.ctx.positionProxy()
      this.ctx.requestRender()
      setTimeout(() => this.ctx.focusIME(), 0)
    }
  }

  // ---- Mouse Events ----

  onMouseDown(e: MouseEvent): void {
    if (this.ctx.mode === EditorMode.READONLY || this.ctx.mode === EditorMode.PRINT) return

    const { x, y } = this.clientToDoc(e.clientX, e.clientY)
    const yZone = this.ctx.zoneFromY(y)

    if (yZone === ZoneType.MAIN) {
      this.ctx.setActiveZone(ZoneType.MAIN)
    }

    const globalIdx = this.ctx.getIndexByCoord(x, y)
    const clickedEl = globalIdx < this.ctx.positionList.length
      ? this.ctx.elementAtGlobal(globalIdx)
      : undefined

    // Table cell hit-testing
    if (clickedEl && clickedEl.type === ElementType.TABLE && clickedEl.trList) {
      const tablePos = this.ctx.positionList[globalIdx]
      if (tablePos) {
        const cell = this.hitTestTable(clickedEl, x - tablePos.x, y - tablePos.y)
        if (cell) {
          this.ctx.setFocusedCell({ tableEl: clickedEl, td: cell.td })
          this.ctx.setFocusedControl(null)
          this.ctx.positionProxy()
          this.ctx.requestRender()
          setTimeout(() => this.ctx.focusIME(), 0)
          return
        }
      }
    }

    // Control hit-testing
    if (clickedEl && clickedEl.type === ElementType.CONTROL && clickedEl.control) {
      this.handleControlClick(clickedEl)
      return
    }

    // Clicked outside any control/table cell — unfocus
    this.ctx.setFocusedControl(null)
    this.ctx.setFocusedCell(null)

    const index = this.ctx.globalToCursorIndex(globalIdx)
    const zoneMax = this.ctx.getZoneElements().length
    const clamped = index < 0 ? 0 : index > zoneMax ? zoneMax : index

    this.ctx.startDrag(clamped)
    this.ctx.setCursorIndex(clamped)
    this.ctx.requestRender()
    this.ctx.positionProxy()
    setTimeout(() => this.ctx.focusIME(), 0)
  }

  onMouseMove(e: MouseEvent): void {
    if (!this.ctx.isSelecting) return

    const { x, y } = this.clientToDoc(e.clientX, e.clientY)
    let index = this.ctx.globalToCursorIndex(this.ctx.getIndexByCoord(x, y))
    const zoneMax = this.ctx.getZoneElements().length
    if (index < 0) index = 0
    if (index > zoneMax) index = zoneMax

    // Only extend/rerender when index actually changes
    if (this.prevIdx !== index) {
      this.prevIdx = index
      this.ctx.extendTo(index)
      this.ctx.setCursorIndex(index)
      this.ctx.requestRender()
    }
  }

  onMouseUp(_e: MouseEvent): void {
    if (!this.ctx.isSelecting) return
    this.prevIdx = undefined as any
    this.ctx.endDrag()
    this.ctx.requestRender()
  }

  onDoubleClick(e: MouseEvent): void {
    if (this.ctx.mode === EditorMode.READONLY || this.ctx.mode === EditorMode.PRINT) return
    const { x, y } = this.clientToDoc(e.clientX, e.clientY)
    this.ctx.setActiveZone(this.ctx.zoneFromY(y))
    const globalIdx = this.ctx.getIndexByCoord(x, y)
    this.ctx.setCursorIndex(this.ctx.globalToCursorIndex(globalIdx))
    this.ctx.clearRange()
    this.ctx.requestRender()
    this.ctx.positionProxy()
    setTimeout(() => this.ctx.focusIME(), 0)
  }
}
