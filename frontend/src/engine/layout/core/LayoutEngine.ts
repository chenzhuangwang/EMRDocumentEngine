// ================================================================
// LayoutEngine — 布局编排器 (架构 §7.3, v20.34)
//
// 独立于 Draw, 无 Canvas 依赖
// 输入: DocumentTree + NodePool + DirtyTracker
// 输出: SLIFPage[] (布局产物)
//
// 职责: LineBreaker/PageBreaker 调度 + PageStartTable 增量分页
// 导出链路可直接消费 SLIFPage[]
// ================================================================

import type { DocumentTree, Paragraph, TextNode } from '../../document/core/DocumentModel'
import type { NodePool } from '../../document/core/NodePool'
import type { SLIFPage, SLIFItem, SLIFRow, SLIFCell } from './SLIF'
import type { EventBus } from '../../interaction/EventBus'
import type { LayoutConfig } from './LayoutContext'
import type { LayoutResult } from './LayoutResult'
import { textMeasurer, type TextMeasurer } from '../text/TextMeasurer'
import { LineBreaker } from '../line/LineBreaker'
import type { LineElement } from '../line/LineLayout'
import { PageBreaker } from '../page/PageBreaker'
import type { ILine, IPage } from '../page/PageLayout'
import { DEFAULT_PAGE_SETUP } from '../../document/core/DocumentModel'
import { MergeMatrix } from '../../document/table/MergeMatrix'
import { FootnoteLayout } from '../footnote/FootnoteLayout'
import { ListParticle } from '../../render/particles/ListParticle'

export type { LayoutConfig } from './LayoutContext'
export type { LayoutResult } from './LayoutResult'

/** 标题级别 → 字体缩放倍率 (基于正文默认 16px: H1=32, H2=24, H3=20, H4=18, H5=16, H6=14) */
const HEADING_SCALE: Record<number, number> = { 1: 2.0, 2: 1.5, 3: 1.25, 4: 1.125, 5: 1.0, 6: 0.875 }
const BASE_FONT_SIZE = 16

export class LayoutEngine {
  private eventBus: EventBus
  private pages: SLIFPage[] = []
  private config: LayoutConfig

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus
    this.config = {
      pageWidth: 794, pageHeight: 1123,
      marginTop: 72, marginBottom: 72,
      marginLeft: 90, marginRight: 90,
    }
  }

  /** 全量重布局 — LineBreaker + PageBreaker 集成 (TASK-445) */
  fullLayout(doc: DocumentTree, pool: NodePool): LayoutResult {
    const measurer = textMeasurer
    const lineBreaker = new LineBreaker(measurer)
    const pageBreaker = new PageBreaker()
    const contentWidth = this.config.pageWidth - this.config.marginLeft - this.config.marginRight

    // Step 1: 遍历 FlowBody, 为每个 Paragraph 调用 LineBreaker
    const allLines: ILine[] = []
    const pageSetup = {
      ...DEFAULT_PAGE_SETUP,
      width: this.config.pageWidth,
      height: this.config.pageHeight,
      marginTop: this.config.marginTop,
      marginBottom: this.config.marginBottom,
      marginLeft: this.config.marginLeft,
      marginRight: this.config.marginRight,
    }

    for (const blockId of doc.body.children) {
      const block = pool.nodes.get(blockId)
      if (!block) continue
      const blockType = (block as unknown as Record<string, unknown>).type as string

      if (blockType === 'section_break') {
        // 分节符: 作为特殊标记行
        allLines.push({
          elements: [{ id: block.id, type: 'section_break' }],
          width: contentWidth, height: 0, maxAscent: 0, maxDescent: 0,
        })
        continue
      }

      if (blockType === 'separator') {
        allLines.push({
          elements: [{ id: block.id, type: 'separator' }],
          width: contentWidth, height: 12, maxAscent: 6, maxDescent: 6,
        })
        continue
      }

      if (blockType === 'table') {
        // 表格: 生成 SLIFItem 时在后续步骤中展开 (R37)
        allLines.push({
          elements: [{ id: block.id, type: 'table', value: '', tableBlock: block } as LineElement],
          width: contentWidth, height: 0, maxAscent: 0, maxDescent: 0,
          indent: 0,
        })
        continue
      }

      if (blockType === 'paragraph') {
        const para = block as unknown as Paragraph
        const elements: LineElement[] = []

        // 列表标记: 拼到第一个文本节点前面, 避免与内容重叠
        let listMarker = ''
        let savedListMarker = ''
        if (para.list) {
          const listType = para.list.type
          const level = para.list.level || 1
          const indent = '  '.repeat(level - 1)
          if (listType === 'bullet') {
            const bulletChar = para.list.bulletChar || ListParticle.resolveBulletChar(level)
            listMarker = indent + bulletChar + ' '
          } else if (listType === 'ordered') {
            const orderNum = this.computeListNumber(para.id, pool, doc, level)
            const numberStyle = para.list.numberStyle || 'decimal'
            listMarker = indent + ListParticle.formatOrderedNumberRaw(orderNum, numberStyle) + ' '
          }
          savedListMarker = listMarker
        }

        // 标题样式: outlineLevel > 0 时缩放字体 + 加粗
        const outlineLevel = para.outlineLevel ?? 0
        const headingScale = outlineLevel > 0 ? (HEADING_SCALE[outlineLevel] ?? 1) : 1
        const isHeading = outlineLevel > 0

        for (const childId of para.children) {
          const child = pool.nodes.get(childId)
          if (!child) continue
          const childType = (child as unknown as Record<string, unknown>).type as string
          if (childType === 'text' || childType === 'smarttext' || childType === 'cross_reference') {
            const tn = child as unknown as TextNode
            // 交叉引用节点使用 displayText
            const textVal = childType === 'cross_reference'
              ? ((child as unknown as { displayText: string }).displayText || tn.text || '?')
              : tn.text
            const value = listMarker ? listMarker + textVal : textVal
            if (listMarker) listMarker = '' // 仅首节点添加
            // 标题: 缩放字号 + 加粗
            const baseSize = tn.size || BASE_FONT_SIZE
            const headingSize = isHeading ? Math.round(baseSize * headingScale) : undefined
            elements.push({
              id: tn.id, type: childType, value,
              font: tn.font, size: headingSize ?? tn.size,
              bold: isHeading ? true : tn.bold, italic: tn.italic,
              color: tn.color, underline: tn.underline,
              underlineStyle: (tn as { underlineStyle?: string }).underlineStyle,
              strikeout: tn.strikeout, superscript: tn.superscript, subscript: tn.subscript,
              highlight: tn.highlight,
            })
          } else if (childType === 'image') {
            const img = child as unknown as Record<string, unknown>
            elements.push({
              id: child.id, type: 'image',
              value: '', imageData: {
                width: img.width as number,
                height: img.height as number,
                wrapType: (img.wrapMode as string) || 'inline',
              },
            })
          } else if (childType === 'footnote_ref') {
            elements.push({ id: child.id, type: 'footnote_ref', value: '' })
          } else if (childType === 'field') {
            const fn = child as unknown as Record<string, unknown>
            const fBaseSize = (fn.size as number) || BASE_FONT_SIZE
            elements.push({
              id: child.id, type: 'field', value: (fn.cachedValue as string) || '',
              font: fn.font as string, size: isHeading ? Math.round(fBaseSize * headingScale) : fn.size as number,
              bold: isHeading ? true : (fn.bold as boolean), italic: fn.italic as boolean,
              fieldType: fn.fieldType as string,
            })
          }
        }

        if (elements.length === 0) {
          // 空段落占位行 — 确保每个段落都有布局位置, 光标可定位
          const emptySize = isHeading ? Math.round(BASE_FONT_SIZE * headingScale) : BASE_FONT_SIZE
          allLines.push({
            elements: [{ id: para.id, type: 'text', value: '' }],
            width: 0,
            height: emptySize,
            maxAscent: emptySize * 0.8,
            maxDescent: emptySize * 0.2,
            alignment: para.alignment,
            indent: para.indent,
            listMarker: savedListMarker || undefined,
          })
        } else {
          const lines = lineBreaker.breakLines(elements, {
            maxWidth: contentWidth, wordBreak: 'break-all',
            defaultFont: 'SimSun', defaultSize: 16,
          })
          // 标记每行的段落对齐/缩进
          let isFirstLine = true
          for (const line of lines) {
            line.alignment = para.alignment
            line.indent = para.indent
            if (isFirstLine && savedListMarker) {
              line.listMarker = savedListMarker
              isFirstLine = false
            }
          }
          allLines.push(...lines)
        }
      }
    }

    // Step 2: PageBreaker 分页
    const iPages = pageBreaker.breakPages(allLines, [], [], pageSetup)

    // Step 3: IPage[] → SLIFPage[]
    const slifPages: SLIFPage[] = iPages.map((ip: IPage) => {
      let y = this.config.marginTop
      const items: SLIFItem[] = []
      const pageContentHeight = pageSetup.height - pageSetup.marginTop - pageSetup.marginBottom
      for (const line of ip.lines) {
        const firstEl = line.elements[0]

        // 表格: 展开为含行数据的 SLIFItem (R37+R65+TASK-702 跨页断表)
        if (firstEl?.type === 'table') {
          const tbl = (firstEl as LineElement).tableBlock as {
            id: string; columns?: { width: number }[]; children: string[]
            pageBreak?: { repeatHeader?: boolean; minRowsBeforeBreak?: number; continuationLabel?: string }
          } | undefined
          if (tbl) {
            const { rows: allRows, columnWidths } = this.buildTableRows(tbl, pool, contentWidth, lineBreaker)
            const pageBreak = tbl.pageBreak
            const headerRowCount = pageBreak?.repeatHeader ? 1 : 0
            const minRows = pageBreak?.minRowsBeforeBreak || 2
            const label = pageBreak?.continuationLabel || '（续表）'

            // 计算剩余页面空间
            const pageContentBottom = this.config.marginTop + pageContentHeight
            const remainingSpace = pageContentBottom - y
            const totalTableH = allRows.reduce((h, r) => h + (r.height || 24) + 1, 0)

            if (totalTableH <= remainingSpace || allRows.length <= minRows) {
              // 表格完整放入当前页
              items.push(this.createTableItem(tbl.id, allRows, contentWidth, y, totalTableH, headerRowCount, columnWidths))
              // 关键: 推进 y, 否则表格后续内容会与表格重叠 (光标无法定位到表格之后)
              y += totalTableH
            } else {
              // 跨页拆分 (TASK-702)
              let rowStart = 0
              let usedH = 0
              let isFirstPage = true

              while (rowStart < allRows.length) {
                const pageRows = []
                let pageH = 0
                // 第一页: 使用当前页剩余空间; 后续页: 使用整页空间
                const maxH = isFirstPage ? remainingSpace : pageContentHeight - 30 // 30 for continuation label

                for (let ri = rowStart; ri < allRows.length; ri++) {
                  const rh = (allRows[ri].height || 24) + 1
                  if (pageH + rh > maxH && pageRows.length >= minRows) break
                  pageRows.push(allRows[ri])
                  pageH += rh
                }

                if (pageRows.length === 0) break

                const item = this.createTableItem(tbl.id, pageRows, contentWidth, y,
                  pageH, isFirstPage ? headerRowCount : headerRowCount, columnWidths)
                if (!isFirstPage) {
                  item.continuationLabel = label
                  y += 20 // 续表标记占用
                }
                items.push(item)

                rowStart += pageRows.length
                y += pageH
                usedH += pageH
                isFirstPage = false

                // 下一页从顶部开始
                if (rowStart < allRows.length) {
                  y = this.config.marginTop
                }
              }
            }
          }
          continue
        }

        if (line.height === 0) continue // 跳过 section_break 标记行
        if (firstEl?.type === 'separator') {
          items.push({
            nodeId: firstEl.id, nodeType: 'separator', type: 'separator',
            x: this.config.marginLeft, y, width: contentWidth, height: line.height,
            ascent: line.maxAscent, descent: line.maxDescent,
            font: 'SimSun', size: 12,
          })
          y += line.height
          continue
        }
        for (const el of line.elements) {
          if (el.type === 'section_break') continue
          if (el.type === 'footnote_ref') {
            // 脚注引用: 生成占位 SLIF item, 编号在 Step 4 回填
            const fnCharHeight = measurer.getLineHeight({ font: el.font || 'SimSun', size: el.size || 12 })
            items.push({
              nodeId: el.id, nodeType: 'footnote_ref', type: 'footnote',
              x: this.config.marginLeft + (line.indent ?? 0), y,
              width: 12, height: fnCharHeight,
              ascent: fnCharHeight * 0.8, descent: fnCharHeight * 0.2,
              font: el.font || 'SimSun', size: el.size || 12,
              text: '?',  // 占位, Step 4 回填为正确编号
              superscript: true,
            })
            continue
          }
          if (el.type === 'image') {
            const imgEl = el as { imageData?: { width?: number; height?: number } }
            const iw = imgEl.imageData?.width || contentWidth
            const ih = imgEl.imageData?.height || 200
            items.push({
              nodeId: el.id, nodeType: 'image', type: 'image',
              x: this.config.marginLeft, y,
              width: Math.min(iw, contentWidth), height: ih,
              ascent: ih, descent: 0,
              font: 'SimSun', size: 12,
            })
            continue
          }
          const charHeight = measurer.getLineHeight({ font: el.font || 'SimSun', size: el.size || 16 })

          // 计算 X 偏移: 基础 marginLeft + 缩进 + 对齐
          let itemX = this.config.marginLeft + (line.indent ?? 0)
          if (line.alignment === 'center') {
            itemX = this.config.marginLeft + (contentWidth - line.width) / 2 + (line.indent ?? 0)
          } else if (line.alignment === 'right') {
            itemX = this.config.marginLeft + contentWidth - line.width
          }

          // 列表标记: 从首元素 text 中剥离, 通过 listMarker 字段传给 Draw
          let itemText: string | undefined = el.value
          let itemListMarker: string | undefined = line.listMarker
          let itemMarkerWidth: number | undefined
          const markerX = itemX  // 保存标记原始位置 (shift 前)
          if (itemListMarker && itemText && itemText.startsWith(itemListMarker)) {
            itemText = itemText.slice(itemListMarker.length)
            // 测量标记宽度, 偏移正文 x
            const markerW = measurer.measure(itemListMarker, {
              font: el.font || 'SimSun', size: el.size || 16,
              bold: el.bold, italic: el.italic,
            })
            itemMarkerWidth = markerW.width
            itemX += markerW.width
          } else {
            itemListMarker = undefined // 非首元素不带标记
          }

          items.push({
            nodeId: el.id, nodeType: el.type, type: el.type,
            text: itemText,
            x: itemX, y, width: line.width / line.elements.length,
            height: charHeight,
            ascent: line.maxAscent, descent: line.maxDescent,
            font: el.font || 'SimSun', size: el.size || 16,
            bold: el.bold, italic: el.italic,
            color: el.color, underline: el.underline,
            underlineStyle: (el as { underlineStyle?: string }).underlineStyle,
            strikeout: el.strikeout, superscript: el.superscript, subscript: el.subscript,
            highlight: (el as { highlight?: string }).highlight,
            listMarker: itemListMarker,
            listMarkerX: itemListMarker ? markerX : undefined,
            markerWidth: itemMarkerWidth,
            fieldType: (el as { fieldType?: string }).fieldType,
          })
        }
        y += line.height
      }

      // 页眉/页脚布局
      const headerH = this.config.headerHeight ?? 42
      const footerH = this.config.footerHeight ?? 42
      const headerItems = this.layoutHeaderFooterContent(doc.header, pool, lineBreaker, measurer, contentWidth, headerH)
      const footerItems = this.layoutHeaderFooterContent(doc.footer, pool, lineBreaker, measurer, contentWidth, footerH)

      return {
        pageIndex: ip.pageIndex, width: this.config.pageWidth, height: this.config.pageHeight, items,
        headerItems, footerItems, headerHeight: headerH, footerHeight: footerH,
      }
    })

    // Step 4: 脚注收集与布局 — 每页独立收集 footnote_ref, 生成脚注区 SLIF items
    const footnoteEngine = new FootnoteLayout()
    for (const page of slifPages) {
      const footnotes = footnoteEngine.collectFootnotes(page, pool)
      if (footnotes.length > 0) {
        // 回填正文中 footnote SLIF items 的编号
        for (const item of page.items) {
          if (item.type === 'footnote') {
            const fn = footnotes.find(f => f.refId === item.nodeId)
            if (fn) item.text = String(fn.number)
          }
        }
        const footnoteY = page.height - this.config.marginBottom - 60
        const fnItems = footnoteEngine.generateFootnoteItems(
          footnotes, footnoteY, contentWidth, this.config.marginLeft,
        )
        // 脚注区 items 追加到页面
        for (const fi of fnItems) {
          page.items.push(fi)
        }
      }
    }

    this.pages = slifPages
    this.eventBus.emit('layout:changed', slifPages)
    return slifPages
  }

  /** 增量布局 (仅重排脏区, TASK-446 incrementalRepaginate)
   *
   * 策略: 脏段落 ≤ 3 → 保留早期页面 + 从脏页开始 fullLayout 切片
   *       否则 → 全量重排
   */
  incrementalLayout(
    doc: DocumentTree, pool: NodePool, dirtyParagraphIds: Set<string>,
  ): LayoutResult {
    if (dirtyParagraphIds.size === 0) return this.pages

    // 小范围脏: 局部重排
    if (dirtyParagraphIds.size <= 3) {
      const firstDirtyPageIndex = this.findPageContainingParagraph(dirtyParagraphIds)
      if (firstDirtyPageIndex <= 0) return this.fullLayout(doc, pool)

      // 全量重排 (LineBreaker + PageBreaker 管道无法只重排中间部分)
      const allPages = this.fullLayout(doc, pool)

      // 如果早期页面布局未变, 复用它们 (页码对齐)
      let preservedCount = 0
      for (let i = 0; i < firstDirtyPageIndex && i < allPages.length; i++) {
        if (i < this.pages.length &&
            this.pages[i].items.length === allPages[i].items.length &&
            this.pages[i].items[0]?.nodeId === allPages[i].items[0]?.nodeId) {
          preservedCount++
        } else {
          break
        }
      }

      if (preservedCount > 0) {
        const result = [...this.pages.slice(0, preservedCount), ...allPages.slice(preservedCount)]
        // 重新编号页面
        for (let i = 0; i < result.length; i++) result[i].pageIndex = i
        this.pages = result
        this.eventBus.emit('layout:changed', result)
        console.debug(
          `[LayoutEngine] incrementalLayout: preserved ${preservedCount}/${firstDirtyPageIndex} pages, ` +
          `${dirtyParagraphIds.size} dirty → ${result.length} total pages`
        )
        return result
      }

      this.pages = allPages
      return allPages
    }

    // 大范围脏 → 全量重排
    return this.fullLayout(doc, pool)
  }

  /** 查找包含任一脏段落的页面索引, -1 表示需要全量重排 */
  private findPageContainingParagraph(dirtyParagraphIds: ReadonlySet<string>): number {
    for (let pi = 0; pi < this.pages.length; pi++) {
      for (const item of this.pages[pi].items) {
        if (dirtyParagraphIds.has(item.nodeId)) return pi
        // item 可能属于某个段落的子节点, 尝试匹配
      }
    }
    // 未找到 → 脏段可能不在已有页面中 (新增段落) → 需要全量重排
    return -1
  }

  getPages(): SLIFPage[] { return this.pages }

  /**
   * 将 Table 节点展开为 SLIFRow[] + columnWidths (Phase 1, v21.0)
   *
   * 列宽优先级 (对齐 Word): fixed > percentage > auto
   *   - fixed: ColumnDefinition.width 为像素宽
   *   - percentage: ColumnDefinition.width 为百分比 (0-100), 基于 contentWidth 换算
   *   - auto / 无 mode: 剩余宽度均匀分配
   *
   * cell x 位置按累积列宽计算 (支持非均匀列宽)。
   */
  private buildTableRows(
    table: {
      id: string
      columns?: { width: number; minWidth?: number; mode?: 'fixed' | 'percentage' | 'auto' }[]
      children: string[]
      pageBreak?: { repeatHeader?: boolean; minRowsBeforeBreak?: number; continuationLabel?: string }
    },
    pool: NodePool,
    contentWidth: number,
    lineBreaker: LineBreaker,
  ): { rows: SLIFRow[]; columnWidths: number[] } {
    const CELL_PAD = 6
    const MIN_ROW_HEIGHT = 24

    const colDefs = table.columns
    const numCols = colDefs?.length || 2
    const columnWidths = this.computeColumnWidths(colDefs || [], numCols, contentWidth)

    // 计算列累积 X (用于 cell x 定位)
    const cumulativeX: number[] = [0]
    for (let i = 0; i < columnWidths.length - 1; i++) {
      cumulativeX.push(cumulativeX[i] + columnWidths[i])
    }

    // 预收集行节点 + 声明行高 (rowspan 合并高度基准)
    const rowNodes = table.children
      .map(id => pool.nodes.get(id) as { type?: string; height?: number; children: string[] } | undefined)
      .filter((n): n is { type?: string; height?: number; children: string[] } => !!n && n.type === 'row')
    const numRows = rowNodes.length
    const rowHeights = rowNodes.map(r => Math.max(r.height || MIN_ROW_HEIGHT, MIN_ROW_HEIGHT))

    // 占用矩阵: 追踪 colspan/rowspan 已占用的格子
    const matrix = new MergeMatrix(numRows, columnWidths.length)

    // ---- 第一遍: 布局每个 cell 的内容 (换行 + 多段落), 记录 (row,col) 定位 + contentHeight ----
    interface CellLayout {
      id: string
      row: number
      col: number
      colspan: number
      rowspan: number
      x: number
      width: number
      isHeader?: boolean
      backgroundColor?: string
      verticalAlign?: 'top' | 'middle' | 'bottom'
      items: SLIFItem[]
      contentHeight: number
    }
    const cellLayouts: CellLayout[] = []

    for (let ri = 0; ri < numRows; ri++) {
      const row = rowNodes[ri]
      // colCursor: 当前单元格的起始列索引 (跳过 rowspan/colspan 已占用的列)
      let colCursor = 0
      for (const cellId of row.children) {
        while (colCursor < columnWidths.length && matrix.isOccupied(ri, colCursor)) colCursor++
        if (colCursor >= columnWidths.length) break

        const cell = pool.nodes.get(cellId) as {
          type?: string; colspan?: number; rowspan?: number
          isHeader?: boolean; backgroundColor?: string
          verticalAlign?: 'top' | 'middle' | 'bottom'; children: string[]
        } | undefined
        if (!cell) continue

        const cellSpan = cell.colspan || 1
        const rowSpan = cell.rowspan || 1
        let cellWidth = 0
        for (let s = 0; s < cellSpan && colCursor + s < columnWidths.length; s++) {
          cellWidth += columnWidths[colCursor + s] || 40
        }
        if (cellWidth === 0) cellWidth = 40

        // 布局 cell 内文本: 换行 + 多段落堆叠 (y 从 0 顶部对齐)
        const { items, contentHeight } = this.layoutCellItems(cell.children, cellWidth, pool, lineBreaker, CELL_PAD)

        cellLayouts.push({
          id: cellId, row: ri, col: colCursor,
          colspan: cellSpan, rowspan: rowSpan,
          x: cumulativeX[colCursor] || 0, width: cellWidth,
          isHeader: cell.isHeader, backgroundColor: cell.backgroundColor,
          verticalAlign: cell.verticalAlign,
          items, contentHeight,
        })

        matrix.placeCell(cellId, ri, colCursor, cellSpan, rowSpan)
        colCursor += cellSpan
      }
    }

    // ---- 第二遍: 根据内容高度增长行高 (避免换行文本溢出/与下一行重叠) ----
    for (const cl of cellLayouts) {
      // cell 渲染高度 = sum(行高) + (rowSpan-1) 个 1px 行间隙
      // 内容需满足: sum(行高) >= contentHeight + 2*CELL_PAD - (rowSpan-1)
      const need = cl.contentHeight + CELL_PAD * 2 - (cl.rowspan - 1)
      if (cl.rowspan <= 1) {
        if (rowHeights[cl.row] < need) rowHeights[cl.row] = need
      } else {
        let spanH = 0
        for (let s = 0; s < cl.rowspan && cl.row + s < numRows; s++) {
          spanH += rowHeights[cl.row + s]
        }
        if (spanH < need) {
          const lastRow = Math.min(cl.row + cl.rowspan - 1, numRows - 1)
          rowHeights[lastRow] += need - spanH
        }
      }
    }

    // ---- 第三遍: 构建 SLIFRow[] (应用行高增长 + 垂直对齐) ----
    const rows: SLIFRow[] = []
    for (let ri = 0; ri < numRows; ri++) {
      const cells: SLIFCell[] = []
      for (const cl of cellLayouts) {
        if (cl.row !== ri) continue

        // 合并单元格高度 = 从 ri 起的 rowspan 行高之和 + (rowSpan-1) 个 1px 间隙
        let cellHeight = 0
        for (let s = 0; s < cl.rowspan && ri + s < numRows; s++) {
          cellHeight += rowHeights[ri + s]
        }
        cellHeight += cl.rowspan - 1
        if (cellHeight < MIN_ROW_HEIGHT) cellHeight = MIN_ROW_HEIGHT

        // 垂直对齐: 内容顶部偏移 (默认 top)
        let contentTop = CELL_PAD
        if (cl.verticalAlign === 'middle') {
          contentTop = Math.max(CELL_PAD, Math.floor((cellHeight - cl.contentHeight) / 2))
        } else if (cl.verticalAlign === 'bottom') {
          contentTop = Math.max(CELL_PAD, cellHeight - cl.contentHeight - CELL_PAD)
        }

        const items = cl.items.map(it => ({ ...it, y: it.y + contentTop }))

        cells.push({
          id: cl.id,
          x: cl.x, y: 0,
          width: cl.width, height: cellHeight,
          colspan: cl.colspan > 1 ? cl.colspan : undefined,
          rowspan: cl.rowspan > 1 ? cl.rowspan : undefined,
          isHeader: cl.isHeader,
          backgroundColor: cl.backgroundColor,
          items,
        })
      }
      rows.push({ height: rowHeights[ri], cells })
    }

    return { rows, columnWidths }
  }

  /**
   * 布局单元格内文本 — 换行 + 多段落堆叠 (Phase 3, v21.0)
   *
   * @param paraIds    cell 内的段落 ID 列表
   * @param cellWidth  单元格内容区宽度 (px)
   * @returns 已布局的文本 items (y 为 cell 局部坐标, 顶部对齐从 0 开始) + 内容总高度
   */
  private layoutCellItems(
    paraIds: string[],
    cellWidth: number,
    pool: NodePool,
    lineBreaker: LineBreaker,
    CELL_PAD: number,
  ): { items: SLIFItem[]; contentHeight: number } {
    const items: SLIFItem[] = []
    const maxTextWidth = Math.max(cellWidth - CELL_PAD * 2, 1)
    const DEFAULT_SIZE = 12
    let lineY = 0

    for (const paraId of paraIds) {
      const para = pool.nodes.get(paraId) as { children?: string[] } | undefined
      const elements: LineElement[] = []

      if (para?.children) {
        for (const textId of para.children) {
          const tn = pool.nodes.get(textId) as {
            type?: string; text?: string; font?: string; size?: number
            bold?: boolean; italic?: boolean; color?: string
            underline?: boolean; strikeout?: boolean
            superscript?: boolean; subscript?: boolean
          } | undefined
          if (tn?.type === 'text') {
            elements.push({
              id: textId, type: 'text', value: tn.text || '',
              font: tn.font, size: tn.size, bold: tn.bold, italic: tn.italic,
              color: tn.color, underline: tn.underline, strikeout: tn.strikeout,
              superscript: tn.superscript, subscript: tn.subscript,
            })
          }
        }
      }

      if (elements.length === 0) {
        // 空段落: 占一行 (默认行高), 附带空占位 item 供光标定位
        const blankH = DEFAULT_SIZE
        items.push({
          nodeId: paraId, nodeType: 'text', type: 'text',
          x: 0, y: lineY, width: 0, height: blankH,
          ascent: blankH * 0.8, descent: blankH * 0.2,
          font: 'SimSun', size: DEFAULT_SIZE, text: '',
        })
        lineY += blankH
        continue
      }

      const lines = lineBreaker.breakLines(elements, {
        maxWidth: maxTextWidth, wordBreak: 'break-all',
        defaultFont: 'SimSun', defaultSize: DEFAULT_SIZE,
      })

      for (const line of lines) {
        // 逐元素计算行内 x 偏移 (多样式 run 正确拼接)
        let elX = 0
        for (const el of line.elements) {
          if (el.type !== 'text') continue
          const elWidth = textMeasurer.measureWidth(el.value || '', {
            font: el.font || 'SimSun', size: el.size || DEFAULT_SIZE,
            bold: el.bold, italic: el.italic,
          })
          items.push({
            nodeId: el.id, nodeType: 'text', type: 'text',
            x: elX, y: lineY,
            width: elWidth, height: line.height,
            ascent: line.maxAscent, descent: line.maxDescent,
            font: el.font || 'SimSun', size: el.size || DEFAULT_SIZE,
            bold: el.bold, italic: el.italic,
            color: el.color, underline: el.underline, strikeout: el.strikeout,
            superscript: el.superscript, subscript: el.subscript,
            text: el.value || '',
          })
          elX += elWidth
        }
        lineY += line.height
      }
    }

    return { items, contentHeight: lineY }
  }

  /**
   * 计算表格列宽 — 实现 fixed > percentage > auto 优先级 (Phase 1, v21.0)
   *
   * @param colDefs      ColumnDefinition[]
   * @param numCols      实际列数
   * @param contentWidth 表格可用内容宽度 (contentWidth)
   * @returns 每列像素宽度数组
   */
  private computeColumnWidths(
    colDefs: { width: number; minWidth?: number; mode?: 'fixed' | 'percentage' | 'auto' }[],
    numCols: number,
    contentWidth: number,
  ): number[] {
    const MIN_WIDTH = 40
    const widths: number[] = new Array(numCols).fill(0)
    const accounted = new Array(numCols).fill(false)

    // Phase 1: fixed 列 — 直接使用 width
    let usedWidth = 0
    for (let i = 0; i < colDefs.length && i < numCols; i++) {
      const def = colDefs[i]
      if (def.mode === 'fixed') {
        widths[i] = Math.max(def.width || MIN_WIDTH, def.minWidth || MIN_WIDTH)
        accounted[i] = true
        usedWidth += widths[i]
      }
    }

    // Phase 2: percentage 列 — 按 contentWidth 百分比计算
    for (let i = 0; i < colDefs.length && i < numCols; i++) {
      const def = colDefs[i]
      if (def.mode === 'percentage' && !accounted[i]) {
        const pct = Math.min(100, Math.max(0, def.width || 0))
        widths[i] = Math.max(Math.floor(contentWidth * pct / 100), def.minWidth || MIN_WIDTH)
        accounted[i] = true
        usedWidth += widths[i]
      }
    }

    // Phase 3: auto / 未指定 mode — 剩余宽度均匀分配
    const autoCols = accounted.filter(a => !a).length
    if (autoCols > 0) {
      const remaining = Math.max(0, contentWidth - usedWidth)
      const autoWidth = Math.max(MIN_WIDTH, Math.floor(remaining / autoCols))
      for (let i = 0; i < numCols; i++) {
        if (!accounted[i]) {
          widths[i] = autoWidth
        }
      }
    }

    // 兜底: 无 colDefs 的列 (numCols > colDefs.length)
    for (let i = 0; i < numCols; i++) {
      if (widths[i] === 0) {
        widths[i] = Math.max(MIN_WIDTH, Math.floor(contentWidth / numCols))
      }
    }

    return widths
  }

  /** 创建表格 SLIFItem (TASK-702, v21.0: +columnWidths) */
  private createTableItem(
    tableId: string, rows: import('./SLIF').SLIFRow[], contentWidth: number,
    y: number, height: number, headerRowCount?: number,
    columnWidths?: number[],
  ): import('./SLIF').SLIFItem {
    return {
      nodeId: tableId, nodeType: 'table', type: 'table',
      x: this.config.marginLeft, y,
      width: contentWidth, height,
      ascent: height, descent: 0,
      font: 'SimSun', size: 12,
      rows,
      headerRowCount,
      columnWidths,
    }
  }

  private computeListNumber(paraId: string, pool: import('../../document/core/NodePool').NodePool, doc: DocumentTree, level: number): number {
    let count = 0
    let lastOrderedCount = 0  // 记住上一个有序列表序列的计数，供 continueNumbering 使用

    for (const bid of doc.body.children) {
      const b = pool.nodes.get(bid) as Record<string, unknown> | undefined
      const bl = b?.list as { type?: string; level?: number; startAt?: number; continueNumbering?: boolean } | undefined

      if (bid === paraId) {
        // continueNumbering: 当前段跟在非列表段落后仍延续编号
        if (bl?.continueNumbering && count === 0 && lastOrderedCount > 0) {
          count = lastOrderedCount
        }
        // startAt: 显式指定起始编号 (优先级最高)
        if (bl?.startAt && bl.startAt > 0) {
          return bl.startAt
        }
        return count + 1
      }

      if (bl?.type === 'ordered' && (bl?.level || 1) === level) {
        count++
        lastOrderedCount = count
      } else {
        count = 0
      }
    }
    return 1
  }

  /**
   * 布局页眉/页脚段落内容 → SLIFItem[]
   * 每个 page 独立布局, y 坐标相对于页眉/页脚区顶部
   */
  private layoutHeaderFooterContent(
    blockIds: string[] | undefined,
    pool: NodePool,
    lineBreaker: LineBreaker,
    measurer: TextMeasurer,
    contentWidth: number,
    regionHeight: number,
  ): SLIFItem[] {
    if (!blockIds || blockIds.length === 0) return []

    const allLines: ILine[] = []

    for (const blockId of blockIds) {
      const block = pool.nodes.get(blockId)
      if (!block) continue
      const blockType = (block as unknown as Record<string, unknown>).type as string
      if (blockType !== 'paragraph') continue

      const para = block as unknown as Paragraph
      const elements: LineElement[] = []

      for (const childId of para.children) {
        const child = pool.nodes.get(childId)
        if (!child) continue
        const childType = (child as unknown as Record<string, unknown>).type as string
        if (childType === 'text' || childType === 'smarttext') {
          const tn = child as unknown as TextNode
          elements.push({
            id: tn.id, type: childType, value: tn.text,
            font: tn.font, size: tn.size, bold: tn.bold, italic: tn.italic,
            color: tn.color, underline: tn.underline,
            strikeout: tn.strikeout, superscript: tn.superscript, subscript: tn.subscript,
          })
        } else if (childType === 'field') {
          const fn = child as unknown as Record<string, unknown>
          elements.push({
            id: child.id, type: 'field', value: (fn.cachedValue as string) || '',
            font: fn.font as string, size: fn.size as number,
            bold: fn.bold as boolean, italic: fn.italic as boolean,
            fieldType: fn.fieldType as string,
          })
        }
      }

      if (elements.length > 0) {
        const lines = lineBreaker.breakLines(elements, {
          maxWidth: contentWidth, wordBreak: 'break-all',
          defaultFont: 'SimSun', defaultSize: 12,
        })
        for (const line of lines) {
          line.alignment = para.alignment || 'center' // 页眉页脚默认居中
        }
        allLines.push(...lines)
      }
    }

    // 无内容 → 空项
    if (allLines.length === 0) return []

    // 计算垂直居中偏移
    const totalH = allLines.reduce((sum, l) => sum + l.height, 0)
    let y = Math.max(0, (regionHeight - totalH) / 2)

    const items: SLIFItem[] = []
    for (const line of allLines) {
      for (const el of line.elements) {
        const charHeight = measurer.getLineHeight({ font: el.font || 'SimSun', size: el.size || 12 })
        let itemX = this.config.marginLeft + (line.indent ?? 0)
        if (line.alignment === 'center') {
          itemX = this.config.marginLeft + (contentWidth - line.width) / 2
        } else if (line.alignment === 'right') {
          itemX = this.config.marginLeft + contentWidth - line.width
        }

        items.push({
          nodeId: el.id, nodeType: el.type, type: el.type,
          text: el.value,
          x: itemX, y, width: line.width / (line.elements.length || 1),
          height: charHeight,
          ascent: line.maxAscent, descent: line.maxDescent,
          font: el.font || 'SimSun', size: el.size || 12,
          bold: el.bold, italic: el.italic,
          color: el.color, underline: el.underline,
          strikeout: el.strikeout, superscript: el.superscript, subscript: el.subscript,
            fieldType: (el as { fieldType?: string }).fieldType,
          })
      }
      y += line.height
    }

    return items
  }

  getVisiblePages(scrollY: number, viewportHeight: number): { start: number; end: number } {
    // 分页间隙 — 与 Draw.renderer.getPageVerticalGap() 同源
    // (LayoutEngine 不持有 renderer 引用, 调用方负责传参一致性)
    const pageVerticalGap = this.pageVerticalGap
    let cumulativeY = 0
    let start = 0; let end = this.pages.length - 1

    for (let i = 0; i < this.pages.length; i++) {
      const pageHeight = this.pages[i].height // CSS pixels, 与 scrollY/viewportHeight 同单位
      // 累加步长 = 单页高度 + 间隙 (末页之外不再追加间隙, 但循环以 height 判断可见性)
      const slot = pageHeight + pageVerticalGap
      if (cumulativeY + pageHeight < scrollY) start = i + 1
      if (cumulativeY > scrollY + viewportHeight) { end = i - 1; break }
      cumulativeY += slot
    }
    return { start: Math.max(0, start), end: Math.min(this.pages.length - 1, end) }
  }

  /**
   * 当前布局使用的分页渲染间隙。
   * 默认 0 — 与历史行为完全一致。
   * 通过 setPageVerticalGap() 在外部调整 (调整后需 Draw.render 重绘)。
   */
  private pageVerticalGap = 0

  /** 设置分页渲染间隙 — 影响 getVisiblePages 的可见页计算 */
  setPageVerticalGap(gap: number): void {
    this.pageVerticalGap = Math.max(0, gap)
  }

  /** 获取当前分页渲染间隙 */
  getPageVerticalGap(): number { return this.pageVerticalGap }

  updateConfig(config: Partial<LayoutConfig>): void {
    Object.assign(this.config, config)
  }
}
