// ============================================================
// 编辑位置/坐标计算器
// ============================================================

import type { IPosition, IPageSetup, IPage, IPageOffset } from '../document/DocumentModel'

export class Position {
  private positionList: IPosition[] = []
  private pageList: IPage[] = []
  private pageSetup: IPageSetup

  constructor(pageSetup: IPageSetup) {
    this.pageSetup = pageSetup
  }

  computePositions(pages: IPage[], pageSetup: IPageSetup): IPosition[] {
    this.pageList = pages
    this.pageSetup = pageSetup
    const positions: IPosition[] = []
    let globalIndex = 0

    for (const page of pages) {
      const pageStartY = page.pageIndex * (pageSetup.height + 20)
      let currentY = pageStartY + pageSetup.marginTop

      // Header lines
      for (const hl of page.headerLines) {
        for (const _el of hl.elements) {
          positions.push({
            index: globalIndex++,
            pageIndex: page.pageIndex,
            rowIndex: positions.length,
            x: pageSetup.marginLeft,
            y: currentY,
            width: 0,
            height: hl.height,
            ascent: hl.maxAscent,
            descent: hl.maxDescent,
          })
        }
        currentY += hl.height
      }

      // Main content lines
      currentY = pageStartY + pageSetup.marginTop + 50
      for (const ml of page.lines) {
        let cx = pageSetup.marginLeft
        for (const _el of ml.elements) {
          positions.push({
            index: globalIndex++,
            pageIndex: page.pageIndex,
            rowIndex: positions.length,
            x: cx,
            y: currentY + ml.maxAscent,
            width: 0,
            height: ml.height,
            ascent: ml.maxAscent,
            descent: ml.maxDescent,
          })
        }
        currentY += ml.height
      }

      // Footer lines
      const footerStartY = pageStartY + pageSetup.height - pageSetup.marginBottom - 40
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
        if (x > pos.x + pos.width / 2 && i < this.positionList.length - 1) {
          return i + 1
        }
        return i
      }
      const dist = Math.sqrt((x - (pos.x + pos.width / 2)) ** 2 + (y - (pos.y + pos.height / 2)) ** 2)
      if (dist < closestDistance) {
        closestDistance = dist
        closestIndex = i
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
