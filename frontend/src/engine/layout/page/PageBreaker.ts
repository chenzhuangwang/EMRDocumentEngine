// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

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
    pageSetup: PageSetup = DEFAULT_PAGE_SETUP,
    reserveHeight = 0,
    /** 实际正文可用高 (页眉/页脚超高时正文让位后) — 缺省按 margin 推算 */
    pageContentHeightOverride?: number,
  ): IPage[] {
    const pages: IPage[] = []

    // 页眉/页脚占用页面上/下 margin 带(可超高) — 正文可用区由调用方给定或按 margin 推算。
    const pageContentHeight = pageContentHeightOverride ?? (
      pageSetup.height -
      pageSetup.marginTop -
      pageSetup.marginBottom -
      reserveHeight
    )

    // Pre-compute paragraph boundary markers.
    // paragraphEnds[i] = true means line i ends a paragraph (its last element is \n),
    // OR it is a pageable table line (block boundary — 不参与孤行/寡行控制).
    const paragraphEnds = lines.map(l => {
      if (l.pageable) return true
      const last = l.elements[l.elements.length - 1]
      return last?.value === '\n'
    })

    let pageIndex = 0
    let currentPageLines: ILine[] = []
    let currentPageHeight = 0

    let i = 0
    while (i < lines.length) {
      const line = lines[i]

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
        i++
        continue
      }

      // 可分页行 (表格): 以当前可用高问 paginate, 拿 TableFragment
      if (line.pageable) {
        const avail = pageContentHeight - currentPageHeight
        const result = line.pageable.paginate(avail)

        // 本页放不下 → 结束当前页, 换页后再问 (游标未推进)
        if (result.requiresNewPage) {
          if (currentPageLines.length > 0) {
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
          }
          // 不前进 i — 同一 pageable 在整页可用高下必能推进 (TablePaginator 契约)
          continue
        }

        // 本页承载一片 fragment
        currentPageLines.push({
          ...line,
          height: result.fragment.height,
          tableFragment: result.fragment,
        })
        currentPageHeight += result.fragment.height

        if (result.done) {
          i++
          continue
        }
        // 未排完 → 本 fragment 已占满当前页, 换页后继续问同一 pageable
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

      const lineHeight = line.height

      // 检查是否需要分页
      if (currentPageHeight + lineHeight > pageContentHeight && currentPageLines.length > 0) {
        // ---- 孤行检查 ----
        // 如果当前页的最后一段只有 1 行（孤行），将其移到下一页。
        const orphanCount = this.countLastParagraphLines(currentPageLines)
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
          i++
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
        // 表格块边界不参与寡行 (不从上一页跨表格拉文本行)
        const lastLine = currentPageLines[currentPageLines.length - 1]
        const lastIsTableBlock = !!lastLine && (!!lastLine.tableFragment || !!lastLine.pageable)
        if (widowLineCount > 0 && widowLineCount < MIN_PARAGRAPH_LINES && currentPageLines.length > 0 && !lastIsTableBlock) {
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
          i++
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
      i++
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
   * 表格 fragment / pageable 行视为段落边界 (表格是块, 不参与孤行控制)。
   */
  private countLastParagraphLines(pageLines: ILine[]): number {
    if (pageLines.length === 0) return 0

    // Check if the last line on the page ends a paragraph
    if (this.lineEndsParagraph(pageLines[pageLines.length - 1])) {
      return 0 // Paragraph is complete — no orphan
    }

    // Walk backward to find the last paragraph boundary on this page
    let count = 0
    for (let j = pageLines.length - 1; j >= 0; j--) {
      if (this.lineEndsParagraph(pageLines[j])) {
        // Found the previous paragraph boundary — lines after it are the orphan
        return count
      }
      count++
    }

    // No paragraph boundary found on this page — the entire page content
    // is one paragraph. Don't treat it as an orphan (it's the only content).
    return 0
  }

  /** 行是否结束一个段落 (或本身是表格块边界) */
  private lineEndsParagraph(line: ILine): boolean {
    if (line.pageable || line.tableFragment) return true
    const last = line.elements[line.elements.length - 1]
    return last?.value === '\n'
  }
}
