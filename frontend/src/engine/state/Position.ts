// ============================================================
// 编辑位置/坐标计算器
// ============================================================

import type { IPosition, IPageSetup, IPage, IPageOffset, IElement } from '../document/DocumentModel'
import { RowFlex } from '../document/DocumentModel'
import type { TextMeasurer } from '../layout/TextMeasurer'

interface LineLayoutEntry {
  x: number
  width: number
}

export class Position {
  private positionList: IPosition[] = []
  private pageList: IPage[] = []
  private pageSetup: IPageSetup
  private measurer: TextMeasurer

  /** Actual computed header/footer heights (includes min + trailing \n). */
  public headerHeight: number = 50
  public footerHeight: number = 40

  constructor(pageSetup: IPageSetup, measurer: TextMeasurer) {
    this.pageSetup = pageSetup
    this.measurer = measurer
  }

  /**
   * 根据分页结果计算所有元素的像素坐标（全局坐标）
   * 每个 position 的 (x, y) 是相对于整个画布的绝对坐标
   */
  computePositions(pages: IPage[], pageSetup: IPageSetup): IPosition[] {
    this.pageList = pages
    this.pageSetup = pageSetup
    const positions: IPosition[] = []
    let globalIndex = 0

    for (const page of pages) {
      const pageStartY = page.pageIndex * (pageSetup.height + 20)

      // Header area
      let headerY = pageStartY + pageSetup.marginTop
      let actualHeaderHeight = (pageSetup.headerHeight || 50)
      const headerContentWidth = pageSetup.width - pageSetup.marginLeft - pageSetup.marginRight
      for (const hl of page.headerLines) {
        const lineLayout = this.computeLineLayout(hl.elements, headerContentWidth)
        for (const entry of lineLayout.entries) {
          positions.push({
            index: globalIndex++,
            pageIndex: page.pageIndex,
            rowIndex: positions.length,
            x: entry.x,
            y: headerY,
            width: entry.width,
            height: hl.height,
            ascent: hl.maxAscent,
            descent: hl.maxDescent,
          })
        }
        headerY += hl.height
      }
      // Compute actual header height, with a sensible minimum so the zone
      // doesn't collapse to zero for one-line headers.
      const configHeaderH = pageSetup.headerHeight || 50
      if (page.headerLines.length > 0) {
        const contentH = headerY - (pageStartY + pageSetup.marginTop)
        actualHeaderHeight = Math.max(contentH, configHeaderH)
        // If the last header line ends with \n, add a synthetic position
        // for the implicit next line. Uses globalIndex past the last real
        // element — zoneFromPosition handles this via Y-based fallback.
        const lastLine = page.headerLines[page.headerLines.length - 1]
        const lastEl = lastLine.elements[lastLine.elements.length - 1]
        if (lastEl && lastEl.value === '\n') {
          // Use a large sentinel index so zoneFromPosition triggers the
          // Y-based fallback (pos.index >= total in zoneFromPosition).
          positions.push({
            index: Number.MAX_SAFE_INTEGER,
            pageIndex: page.pageIndex,
            rowIndex: positions.length,
            x: pageSetup.marginLeft,
            y: headerY,
            width: 0,
            height: lastLine.height,
            ascent: lastLine.maxAscent,
            descent: lastLine.maxDescent,
          })
          actualHeaderHeight += lastLine.height
        }
      }
      this.headerHeight = actualHeaderHeight

      // Main content area — starts right after the actual header content
      let contentY = pageStartY + pageSetup.marginTop + actualHeaderHeight
      const contentWidth = pageSetup.width - pageSetup.marginLeft - pageSetup.marginRight
      for (const ml of page.lines) {
        // Compute element widths and alignment offset for this line
        const lineLayout = this.computeLineLayout(ml.elements, contentWidth)
        for (const entry of lineLayout.entries) {
          positions.push({
            index: globalIndex++,
            pageIndex: page.pageIndex,
            rowIndex: positions.length,
            x: entry.x,
            y: contentY,
            width: entry.width,
            height: ml.height,
            ascent: ml.maxAscent,
            descent: ml.maxDescent,
          })
        }
        contentY += ml.height
      }

      // Footer area — positioned from the bottom, growing upward
      const configFooterH = pageSetup.footerHeight || 40
      let totalFooterH = configFooterH
      const footerContentWidth = pageSetup.width - pageSetup.marginLeft - pageSetup.marginRight
      for (const fl of page.footerLines) {
        totalFooterH += fl.height
      }
      // Start position: bottom margin minus total footer height, so the
      // last footer line sits at the bottom margin edge
      let footerY = pageStartY + pageSetup.height - pageSetup.marginBottom - totalFooterH
      for (const fl of page.footerLines) {
        const lineLayout = this.computeLineLayout(fl.elements, footerContentWidth)
        for (const entry of lineLayout.entries) {
          positions.push({
            index: globalIndex++,
            pageIndex: page.pageIndex,
            rowIndex: positions.length,
            x: entry.x,
            y: footerY,
            width: entry.width,
            height: fl.height,
            ascent: fl.maxAscent,
            descent: fl.maxDescent,
          })
        }
        footerY += fl.height
      }
      this.footerHeight = totalFooterH
      // Trailing \n synthetic position for footer
      if (page.footerLines.length > 0) {
        const lastLine = page.footerLines[page.footerLines.length - 1]
        const lastEl = lastLine.elements[lastLine.elements.length - 1]
        if (lastEl && lastEl.value === '\n') {
          positions.push({
            index: Number.MAX_SAFE_INTEGER,
            pageIndex: page.pageIndex,
            rowIndex: positions.length,
            x: pageSetup.marginLeft,
            y: footerY,
            width: 0,
            height: lastLine.height,
            ascent: lastLine.maxAscent,
            descent: lastLine.maxDescent,
          })
          this.footerHeight += lastLine.height
        }
      }
    }

    this.positionList = positions
    return positions
  }

  getPositionByIndex(index: number): IPosition | undefined {
    return this.positionList[index]
  }

  /**
   * Compute X positions for elements in a single line, applying alignment.
   * Reads rowFlex from the first element in the line.
   */
  private computeLineLayout(
    elements: IElement[],
    contentWidth: number
  ): { entries: LineLayoutEntry[] } {
    // Measure all element widths
    const visibleElements: { el: IElement; width: number }[] = []
    let totalWidth = 0
    for (const el of elements) {
      if (el.value === '​' || el.value === '\n') {  // eslint-disable-line
        visibleElements.push({ el, width: 0 })
        continue
      }
      const w = this.measurer.measureWidth(el.value || '', {
        font: el.font || 'SimSun',
        size: el.size || 16,
        bold: el.bold,
        italic: el.italic,
      })
      visibleElements.push({ el, width: w })
      totalWidth += w
    }

    // Determine alignment from the first element with explicit rowFlex
    let rowFlex: RowFlex = RowFlex.LEFT
    for (const { el } of visibleElements) {
      if (el.rowFlex) { rowFlex = el.rowFlex; break }
    }

    // Calculate per-element X positions
    const entries: LineLayoutEntry[] = []
    const marginLeft = this.pageSetup.marginLeft

    if (rowFlex === RowFlex.CENTER) {
      const xOffset = marginLeft + (contentWidth - totalWidth) / 2
      let cx = xOffset
      for (const { width } of visibleElements) {
        entries.push({ x: cx, width })
        cx += width
      }
    } else if (rowFlex === RowFlex.RIGHT) {
      const xOffset = marginLeft + contentWidth - totalWidth
      let cx = xOffset
      for (const { width } of visibleElements) {
        entries.push({ x: cx, width })
        cx += width
      }
    } else if (rowFlex === RowFlex.JUSTIFY) {
      // Standard word-processor behavior: the last line of a paragraph
      // (ending with \n) should NOT be justified — fallback to LEFT.
      const lastEl = visibleElements[visibleElements.length - 1]?.el
      const isLastLine = lastEl?.value === '\n'

      // Only distribute gaps between elements that have positive width
      const visibleIdxs = visibleElements.reduce<number[]>((acc, v, i) => {
        if (v.width > 0) acc.push(i)
        return acc
      }, [])

      if (isLastLine || visibleIdxs.length <= 1) {
        // Fallback to LEFT alignment
        let cx = marginLeft
        for (const { width } of visibleElements) {
          entries.push({ x: cx, width })
          cx += width
        }
      } else {
        const gaps = visibleIdxs.length - 1
        const extraPerGap = Math.max(0, contentWidth - totalWidth) / gaps
        // Build a set of element indices after which to insert extra space
        const gapAfter = new Set<number>()
        for (let g = 0; g < gaps; g++) {
          gapAfter.add(visibleIdxs[g])
        }
        let cx = marginLeft
        for (let i = 0; i < visibleElements.length; i++) {
          const { width } = visibleElements[i]
          entries.push({ x: cx, width })
          cx += width
          if (gapAfter.has(i)) {
            cx += extraPerGap
          }
        }
      }
    } else {
      // LEFT (default)
      let cx = marginLeft
      for (const { width } of visibleElements) {
        entries.push({ x: cx, width })
        cx += width
      }
    }

    return { entries }
  }

  getIndexByCoord(x: number, y: number): number {
    let closestIndex = 0
    let closestDistance = Infinity

    for (let i = 0; i < this.positionList.length; i++) {
      const pos = this.positionList[i]
      if (
        x >= pos.x &&
        x <= pos.x + pos.width &&
        y >= pos.y &&
        y <= pos.y + pos.height
      ) {
        // Click in right half → cursor goes after this character
        if (x > pos.x + pos.width / 2) {
          return i + 1
        }
        return i
      }
      const cx = pos.x + pos.width / 2
      const cy = pos.y + pos.height / 2
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
      if (dist < closestDistance) {
        closestDistance = dist
        closestIndex = i
      }
    }

    // If click is to the right of the last position on its line, place cursor at end.
    // Search backward to find the last element on the same Y line (not the
    // absolute last in the list, which may belong to a different zone/page).
    // Also handles clicks on empty lines (no position at that Y at all).
    if (this.positionList.length > 0) {
      let foundLine = false
      for (let i = this.positionList.length - 1; i >= 0; i--) {
        const last = this.positionList[i]
        if (y >= last.y && y <= last.y + last.height) {
          foundLine = true
          if (x > last.x + last.width) {
            // For visible characters (width>0): cursor after the char.
            // For zero-width chars (\n): cursor stays on the current line.
            return last.width > 0 ? i + 1 : i
          }
          break
        }
      }
      // No position at this Y → empty line (trailing \n, gap between zones, etc.)
      if (!foundLine) {
        return this.positionList.length
      }
    }

    return closestIndex
  }

  getPageIndexByCoord(y: number): number {
    const pageHeight = this.pageSetup.height + 20
    return Math.max(0, Math.floor(y / pageHeight))
  }

  getPositionsInRange(startIndex: number, endIndex: number): IPosition[] {
    return this.positionList.slice(
      Math.min(startIndex, endIndex),
      Math.max(startIndex, endIndex) + 1
    )
  }

  /**
   * Find the character index on the previous/next line nearest to the
   * current cursor's x position. Used by ArrowUp / ArrowDown.
   */
  getNeighborIndex(currentIndex: number, lineDelta: number): number {
    const list = this.positionList
    if (list.length === 0) return 0

    const clampedIdx = Math.min(currentIndex, list.length - 1)
    const cur = list[clampedIdx]

    // Collect unique y-coordinates (each y = one line)
    const yValues: number[] = []
    for (const p of list) {
      const last = yValues[yValues.length - 1]
      if (last === undefined || Math.abs(p.y - last) > 1) {
        yValues.push(p.y)
      }
    }

    // Find which line the current cursor is on
    let lineIdx = 0
    for (let i = 0; i < yValues.length; i++) {
      if (Math.abs(cur.y - yValues[i]) < 2) { lineIdx = i; break }
    }

    // Target line (clamped to valid range)
    const targetLineIdx = Math.max(0, Math.min(yValues.length - 1, lineIdx + lineDelta))
    const targetY = yValues[targetLineIdx]

    // Find nearest x position on the target line
    let bestIdx = clampedIdx
    let bestDist = Infinity
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      if (Math.abs(p.y - targetY) < 2) {
        const dx = Math.abs(p.x - cur.x)
        if (dx < bestDist) { bestDist = dx; bestIdx = i }
      }
    }
    return bestIdx
  }

  getPageCount(): number {
    return this.pageList.length
  }

  getPositionList(): IPosition[] {
    return this.positionList
  }

  getPageOffset(pageIndex: number): IPageOffset {
    return {
      x: 0,
      y: pageIndex * (this.pageSetup.height + 20),
      pageIndex,
    }
  }

  clear(): void {
    this.positionList = []
    this.pageList = []
  }
}
