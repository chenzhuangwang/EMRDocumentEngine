// ============================================================
// 分页引擎 - 精确分页计算 (含孤行/寡行控制)
// ============================================================

import type { PageSetup } from '../../document/core/DocumentModel'
import { DEFAULT_PAGE_SETUP } from '../../document/core/DocumentModel'
import type { ILine, IPage } from './PageLayout'

// 重新导出 — 保持向后兼容
export type { ILine, IPage }

/** Minimum lines of a paragraph that must stay together (avoid orphans/widows). */
const MIN_PARAGRAPH_LINES = 2

export class PageBreaker {

  /**
   * 将行列表分为多页，含孤行/寡行控制。
   *
   * 规则：
   * - 孤行 (orphan): 段落只有 1 行留在上一页底部 → 整段移到下一页
   * - 寡行 (widow):  段落只有 1 行出现在下一页顶部 → 从上一页再移一行过来
   */
  breakPages(
    lines: ILine[],
    headerLines: ILine[],
    footerLines: ILine[],
    pageSetup: PageSetup = DEFAULT_PAGE_SETUP
  ): IPage[] {
    const pages: IPage[] = []

    // Compute actual header/footer heights from the lines, with configured minimums
    const actualHeaderH = headerLines.reduce((h, l) => h + l.height, 0) || 50
    const actualFooterH = footerLines.reduce((h, l) => h + l.height, 0) || 40

    const pageContentHeight =
      pageSetup.height -
      pageSetup.marginTop -
      pageSetup.marginBottom -
      actualHeaderH -
      actualFooterH

    // Pre-compute paragraph boundary markers.
    // paragraphEnds[i] = true means line i ends a paragraph (its last element is \n).
    const paragraphEnds = lines.map(l => {
      const last = l.elements[l.elements.length - 1]
      return last?.value === '\n'
    })

    let pageIndex = 0
    let currentPageLines: ILine[] = []
    let currentPageHeight = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineHeight = line.height

      // 检查当前行是否包含分页符或分节符
      const firstEl = line.elements[0]
      if (firstEl?.type === 'page_break' || firstEl?.type === 'section_break') {
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
        // ---- 孤行检查 ----
        // 如果当前页的最后一段只有 1 行（孤行），将其移到下一页。
        const orphanCount = this.countLastParagraphLines(currentPageLines, paragraphEnds, lines.indexOf(currentPageLines[0]))
        if (orphanCount > 0 && orphanCount < MIN_PARAGRAPH_LINES) {
          // Move the orphan lines to the next page
          const orphans = currentPageLines.splice(currentPageLines.length - orphanCount, orphanCount)
          currentPageHeight -= orphans.reduce((h, l) => h + l.height, 0)

          // If current page is now empty, skip pushing it
          if (currentPageLines.length > 0) {
            pages.push({
              pageIndex,
              lines: currentPageLines,
              headerLines,
              footerLines,
              totalHeight: currentPageHeight,
            })
            pageIndex++
          } else {
            // Page became empty — reuse the same pageIndex
          }

          currentPageLines = [...orphans, line]
          currentPageHeight = orphans.reduce((h, l) => h + l.height, 0) + lineHeight
          continue
        }

        // ---- 寡行检查 ----
        // 如果新页面的第一段只有当前这 1 行（寡行），从上一页再带一行过来。
        const widowStart = i
        let widowEnd = widowStart
        while (widowEnd < lines.length && !paragraphEnds[widowEnd]) {
          widowEnd++
        }
        if (widowEnd < lines.length) widowEnd++ // include the \n line
        const widowLineCount = widowEnd - widowStart
        if (widowLineCount > 0 && widowLineCount < MIN_PARAGRAPH_LINES && currentPageLines.length > 0) {
          // Pull one more line from current page to avoid widow
          const pulled = currentPageLines.pop()!
          currentPageHeight -= pulled.height

          pages.push({
            pageIndex,
            lines: currentPageLines,
            headerLines,
            footerLines,
            totalHeight: currentPageHeight,
          })

          pageIndex++
          currentPageLines = [pulled, line]
          currentPageHeight = pulled.height + lineHeight
          continue
        }

        // Normal page break (no orphan/widow violations)
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

  /**
   * Count how many lines at the END of `pageLines` belong to the same
   * (incomplete) paragraph — i.e. lines after the last paragraph boundary.
   * Returns 0 if the last line ends a paragraph (boundary already present).
   *
   * @param pageLines  Lines currently on the page
   * @param paragraphEnds  Full document paragraph boundary markers
   * @param pageStartIdx  Index of pageLines[0] in the full lines array
   */
  private countLastParagraphLines(
    pageLines: ILine[],
    paragraphEnds: boolean[],
    pageStartIdx: number
  ): number {
    if (pageLines.length === 0) return 0

    // Check if the last line on the page ends a paragraph
    const lastLineGlobalIdx = pageStartIdx + pageLines.length - 1
    if (lastLineGlobalIdx < paragraphEnds.length && paragraphEnds[lastLineGlobalIdx]) {
      return 0 // Paragraph is complete — no orphan
    }

    // Walk backward to find the last paragraph boundary on this page
    let count = 0
    for (let j = pageLines.length - 1; j >= 0; j--) {
      const globalJ = pageStartIdx + j
      if (globalJ < paragraphEnds.length && paragraphEnds[globalJ]) {
        // Found the previous paragraph boundary — lines after it are the orphan
        return count
      }
      count++
    }

    // No paragraph boundary found on this page — the entire page content
    // is one paragraph. Don't treat it as an orphan (it's the only content).
    return 0
  }
}
