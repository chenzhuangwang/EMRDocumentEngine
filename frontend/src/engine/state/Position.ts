// ============================================================
// 编辑位置/坐标计算器
// ============================================================

import type { IPosition, IPageSetup, IPage, IPageOffset } from '../document/DocumentModel'
import type { TextMeasurer } from '../layout/TextMeasurer'

export class Position {
  private positionList: IPosition[] = []
  private pageList: IPage[] = []
  private pageSetup: IPageSetup
  private measurer: TextMeasurer

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

      // Header area (relative to page start)
      let headerY = pageStartY + pageSetup.marginTop
      for (const hl of page.headerLines) {
        for (const _el of hl.elements) {
          positions.push({
            index: globalIndex++,
            pageIndex: page.pageIndex,
            rowIndex: positions.length,
            x: pageSetup.marginLeft,
            y: headerY,
            width: 0,
            height: hl.height,
            ascent: hl.maxAscent,
            descent: hl.maxDescent,
          })
        }
        headerY += hl.height
      }

      // Main content area
      let contentY = pageStartY + pageSetup.marginTop + (pageSetup.headerHeight || 50)
      for (const ml of page.lines) {
        let contentX = pageSetup.marginLeft
        for (const el of ml.elements) {
          const elWidth = (el.value === '​' || el.value === '\n') ? 0 : this.measurer.measureWidth(el.value || '', {
            font: el.font || 'SimSun',
            size: el.size || 16,
            bold: el.bold,
            italic: el.italic,
          })
          positions.push({
            index: globalIndex++,
            pageIndex: page.pageIndex,
            rowIndex: positions.length,
            x: contentX,
            y: contentY,
            width: elWidth,
            height: ml.height,
            ascent: ml.maxAscent,
            descent: ml.maxDescent,
          })
          contentX += elWidth
        }
        contentY += ml.height
      }

      // Footer area
      const footerStartY = pageStartY + pageSetup.height - pageSetup.marginBottom - (pageSetup.footerHeight || 40)
      for (const fl of page.footerLines) {
        for (const _el of fl.elements) {
          positions.push({
            index: globalIndex++,
            pageIndex: page.pageIndex,
            rowIndex: positions.length,
            x: pageSetup.marginLeft,
            y: footerStartY,
            width: 0,
            height: fl.height,
            ascent: fl.maxAscent,
            descent: fl.maxDescent,
          })
        }
      }
    }

    this.positionList = positions
    return positions
  }

  getPositionByIndex(index: number): IPosition | undefined {
    return this.positionList[index]
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

    // If click is to the right of the last position on its line, place cursor at end
    if (this.positionList.length > 0) {
      const last = this.positionList[this.positionList.length - 1]
      if (y >= last.y && y <= last.y + last.height && x > last.x + last.width) {
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
