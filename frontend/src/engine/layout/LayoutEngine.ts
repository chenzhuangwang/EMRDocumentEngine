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

import type { DocumentTree, Paragraph, TextNode } from '../document/DocumentModel'
import type { NodePool } from '../document/NodePool'
import type { SLIFPage, SLIFItem } from './SLIF'
import type { EventBus } from '../interaction/EventBus'
import { textMeasurer, type TextMeasurer } from './TextMeasurer'
import { LineBreaker, type LineElement } from './LineBreaker'
import { PageBreaker, type ILine, type IPage } from './PageBreaker'
import { DEFAULT_PAGE_SETUP } from '../document/DocumentModel'
import { FootnoteLayout } from './FootnoteLayout'

/** 布局配置 */
export interface LayoutConfig {
  pageWidth: number
  pageHeight: number
  marginTop: number
  marginBottom: number
  marginLeft: number
  marginRight: number
  /** 页眉区域高度 (px), 默认 42 (约 3 行 14px) */
  headerHeight?: number
  /** 页脚区域高度 (px), 默认 42 */
  footerHeight?: number
}

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
  fullLayout(doc: DocumentTree, pool: NodePool): SLIFPage[] {
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
            const bulletChar = para.list.bulletChar || this.resolveBulletChar(level)
            listMarker = indent + bulletChar + ' '
          } else if (listType === 'ordered') {
            const orderNum = this.computeListNumber(para.id, pool, doc, level)
            const numberStyle = para.list.numberStyle || 'decimal'
            listMarker = indent + this.formatListNumber(orderNum, numberStyle) + ' '
          }
          savedListMarker = listMarker
        }

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
            elements.push({
              id: tn.id, type: childType, value,
              font: tn.font, size: tn.size, bold: tn.bold, italic: tn.italic,
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
            elements.push({
              id: child.id, type: 'field', value: (fn.cachedValue as string) || '',
              font: fn.font as string, size: fn.size as number,
              bold: fn.bold as boolean, italic: fn.italic as boolean,
              fieldType: fn.fieldType as string,
            })
          }
        }

        if (elements.length === 0) {
          // 空段落占位行 — 确保每个段落都有布局位置, 光标可定位
          const defaultSize = 16
          allLines.push({
            elements: [{ id: para.id, type: 'text', value: '' }],
            width: 0,
            height: defaultSize,
            maxAscent: defaultSize * 0.8,
            maxDescent: defaultSize * 0.2,
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
            const allRows = this.buildTableRows(tbl, pool, contentWidth)
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
              items.push(this.createTableItem(tbl.id, allRows, contentWidth, y, totalTableH, headerRowCount))
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
                  pageH, isFirstPage ? headerRowCount : headerRowCount)
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
          if (itemListMarker && itemText && itemText.startsWith(itemListMarker)) {
            itemText = itemText.slice(itemListMarker.length)
            // 测量标记宽度, 偏移正文 x
            const markerW = measurer.measure(itemListMarker, {
              font: el.font || 'SimSun', size: el.size || 16,
              bold: el.bold, italic: el.italic,
            })
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
  ): SLIFPage[] {
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

  /** 将 Table 节点展开为 SLIFRow[] (R37+R65: 跨页断表支持) */
  private buildTableRows(
    table: { id: string; columns?: { width: number }[]; children: string[]; pageBreak?: { repeatHeader?: boolean; minRowsBeforeBreak?: number; continuationLabel?: string } },
    pool: NodePool,
    contentWidth: number,
  ): import('./SLIF').SLIFRow[] {
    const numCols = table.columns?.length || 2
    const colWidth = Math.floor(contentWidth / numCols)
    const rows: import('./SLIF').SLIFRow[] = []

    for (const rowId of table.children) {
      const row = pool.nodes.get(rowId) as { type?: string; height?: number; children: string[] } | undefined
      if (!row || row.type !== 'row') continue

      const cells: import('./SLIF').SLIFCell[] = []
      for (let ci = 0; ci < row.children.length; ci++) {
        const cellId = row.children[ci]
        const cell = pool.nodes.get(cellId) as {
          type?: string; colspan?: number; rowspan?: number
          isHeader?: boolean; backgroundColor?: string
          verticalAlign?: string; children: string[]
        } | undefined
        if (!cell) continue

        const items: import('./SLIF').SLIFItem[] = []
        for (const paraId of cell.children) {
          const para = pool.nodes.get(paraId) as { children?: string[] } | undefined
          if (para?.children) {
            for (const textId of para.children) {
              const tn = pool.nodes.get(textId) as { type?: string; text?: string; font?: string; size?: number; bold?: boolean; color?: string } | undefined
              if (tn?.type === 'text') {
                items.push({
                  nodeId: textId, nodeType: 'text', type: 'text',
                  x: 0, y: 0, width: colWidth - 12, height: 20,
                  ascent: 14, descent: 6,
                  font: tn.font || 'SimSun', size: tn.size || 12,
                  bold: tn.bold, color: tn.color,
                  text: tn.text || '',
                })
              }
            }
          }
        }

        cells.push({
          x: ci * colWidth, y: 0,
          width: colWidth, height: row.height || 24,
          colspan: cell.colspan, rowspan: cell.rowspan,
          isHeader: cell.isHeader,
          backgroundColor: cell.backgroundColor,
          items,
        })
      }

      rows.push({ height: row.height || 24, cells })
    }

    return rows
  }

  /** 计算有序列表编号: 统计前面同类型同级别段落数 + 1 */
  /** 创建表格 SLIFItem (TASK-702) */
  private createTableItem(
    tableId: string, rows: import('./SLIF').SLIFRow[], contentWidth: number,
    y: number, height: number, headerRowCount?: number,
  ): import('./SLIF').SLIFItem {
    return {
      nodeId: tableId, nodeType: 'table', type: 'table',
      x: this.config.marginLeft, y,
      width: contentWidth, height,
      ascent: height, descent: 0,
      font: 'SimSun', size: 12,
      rows,
      headerRowCount,
    }
  }

  /** 根据 numberStyle 格式化有序列表编号 */
  private formatListNumber(orderNum: number, numberStyle: string): string {
    switch (numberStyle) {
      case 'lower_alpha':
        return String.fromCharCode(96 + ((orderNum - 1) % 26) + 1)
      case 'upper_alpha':
        return String.fromCharCode(64 + ((orderNum - 1) % 26) + 1)
      case 'lower_roman':
        return this.toRomanNumeral(orderNum).toLowerCase()
      case 'upper_roman':
        return this.toRomanNumeral(orderNum)
      case 'cjk_ideographic':
        return this.toCjkIdeographic(orderNum)
      default:
        return String(orderNum)
    }
  }

  private toRomanNumeral(n: number): string {
    const values = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1]
    const symbols = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I']
    let r = ''
    for (let i = 0; i < values.length; i++) {
      while (n >= values[i]) { r += symbols[i]; n -= values[i] }
    }
    return r
  }

  private toCjkIdeographic(n: number): string {
    const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
    if (n < 1) return '零'
    if (n <= 9) return digits[n]
    if (n <= 99) {
      const tens = n >= 20 ? digits[Math.floor(n / 10)] : ''
      return tens + '十' + (n % 10 > 0 ? digits[n % 10] : '')
    }
    return String(n) // > 99 fallback
  }

  private computeListNumber(paraId: string, pool: import('../document/NodePool').NodePool, doc: DocumentTree, level: number): number {
    let count = 0
    for (const bid of doc.body.children) {
      if (bid === paraId) return count + 1
      const b = pool.nodes.get(bid) as Record<string, unknown> | undefined
      const bl = b?.list as { type?: string; level?: number } | undefined
      if (bl?.type === 'ordered' && (bl?.level || 1) === level) count++
      else count = 0 // 非同级有序列表 → 重置计数
    }
    return 1
  }

  /** 根据嵌套层级返回项目符号字符: level 1→•, 2→◦, 3→▪, 4+→◦ (循环) */
  private resolveBulletChar(level: number): string {
    const bullets = ['•', '◦', '▪'] // • ◦ ▪
    return bullets[(level - 1) % bullets.length]
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
    let cumulativeY = 0
    let start = 0; let end = this.pages.length - 1

    for (let i = 0; i < this.pages.length; i++) {
      const pageHeight = this.pages[i].height // CSS pixels, 与 scrollY/viewportHeight 同单位
      if (cumulativeY + pageHeight < scrollY) start = i + 1
      if (cumulativeY > scrollY + viewportHeight) { end = i - 1; break }
      cumulativeY += pageHeight
    }
    return { start: Math.max(0, start), end: Math.min(this.pages.length - 1, end) }
  }

  updateConfig(config: Partial<LayoutConfig>): void {
    Object.assign(this.config, config)
  }
}
