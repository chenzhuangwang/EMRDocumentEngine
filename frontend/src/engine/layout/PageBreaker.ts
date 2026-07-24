// ============================================================
// 分页引擎 - 精确分页计算
// ============================================================

import type { ILine, IPage, IPageSetup } from '../document/DocumentModel'
import { DEFAULT_PAGE_SETUP } from '../document/DocumentModel'

export class PageBreaker {

  /**
   * 将行列表分为多页
   */
  breakPages(
    lines: ILine[],
    headerLines: ILine[],
    footerLines: ILine[],
    pageSetup: IPageSetup = DEFAULT_PAGE_SETUP
  ): IPage[] {
    const pages: IPage[] = []

    // Compute actual header/footer heights from the lines, with configured minimums
    const actualHeaderH = headerLines.reduce((h, l) => h + l.height, 0) || (pageSetup.headerHeight || 50)
    const actualFooterH = footerLines.reduce((h, l) => h + l.height, 0) || (pageSetup.footerHeight || 40)

    const pageContentHeight =
      pageSetup.height -
      pageSetup.marginTop -
      pageSetup.marginBottom -
      actualHeaderH -
      actualFooterH

    let pageIndex = 0
    let currentPageLines: ILine[] = []
    let currentPageHeight = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineHeight = line.height

      // 检查当前行是否包含分页符
      if (line.elements.length === 1 && line.elements[0]?.type === 'page_break') {
        // 保存当前页
        pages.push({
          pageIndex,
          lines: currentPageLines,
          headerLines,
          footerLines,
          totalHeight: currentPageHeight,
        })

        pageIndex++
        currentPageLines = []
        currentPageHeight = 0
        continue
      }

      // 检查是否需要分页
      if (currentPageHeight + lineHeight > pageContentHeight && currentPageLines.length > 0) {
        pages.push({
          pageIndex,
          lines: currentPageLines,
          headerLines,
          footerLines,
          totalHeight: currentPageHeight,
        })

        pageIndex++
        currentPageLines = [line]
        currentPageHeight = lineHeight
      } else {
        currentPageLines.push(line)
        currentPageHeight += lineHeight
      }
    }

    // 处理最后一页
    if (currentPageLines.length > 0) {
      pages.push({
        pageIndex,
        lines: currentPageLines,
        headerLines,
        footerLines,
        totalHeight: currentPageHeight,
      })
    }

    // 至少保证一页
    if (pages.length === 0) {
      pages.push({
        pageIndex: 0,
        lines: [],
        headerLines,
        footerLines,
        totalHeight: 0,
      })
    }

    return pages
  }
}
