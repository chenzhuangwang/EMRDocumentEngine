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

    const pageContentHeight =
      pageSetup.height -
      pageSetup.marginTop -
      pageSetup.marginBottom -
      (pageSetup.headerHeight || 50) -
      (pageSetup.footerHeight || 40)

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
          headerLines: pageIndex === 0 ? headerLines : headerLines,
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
          headerLines: pageIndex === 0 ? headerLines : headerLines,
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
