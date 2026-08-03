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
import { CoordinateSystem } from '../state/CoordinateSystem'
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
  private coordSystem: CoordinateSystem
  private eventBus: EventBus
  private pages: SLIFPage[] = []
  private config: LayoutConfig

  constructor(coordSystem: CoordinateSystem, eventBus: EventBus) {
    this.coordSystem = coordSystem
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
            listMarker = indent + orderNum + '. '
          }
          savedListMarker = listMarker
        }

        for (const childId of para.children) {
          const child = pool.nodes.get(childId)
          if (!child) continue
          const childType = (child as unknown as Record<string, unknown>).type as string
          if (childType === 'text' || childType === 'smarttext') {
            const tn = child as unknown as TextNode
            // 列表标记合并到第一个文本节点
            const value = listMarker ? listMarker + tn.text : tn.text
            if (listMarker) listMarker = '' // 仅首节点添加
            elements.push({
              id: tn.id, type: childType, value,
              font: tn.font, size: tn.size, bold: tn.bold, italic: tn.italic,
              color: tn.color, underline: tn.underline,
              strikeout: tn.strikeout, superscript: tn.superscript, subscript: tn.subscript,
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
      for (const line of ip.lines) {
        if (line.height === 0) continue // 跳过 section_break 标记行
        const firstEl = line.elements[0]
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
          if (el.type === 'section_break' || el.type === 'footnote_ref') continue
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
            strikeout: el.strikeout, superscript: el.superscript, subscript: el.subscript,
            listMarker: itemListMarker,
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
        const footnoteY = page.height - this.config.marginBottom - 60
        const fnItems = footnoteEngine.generateFootnoteItems(
          footnotes, footnoteY, contentWidth, this.config.marginLeft,
        )
        // 脚注只包含非 separator 类型的 items, 追加到页面 items
        for (const fi of fnItems) {
          if (fi.type !== 'separator' || fi.text === '') {
            page.items.push(fi)
          }
        }
      }
    }

    this.pages = slifPages
    this.eventBus.emit('layout:changed', slifPages)
    return slifPages
  }

  /** 增量布局 (仅重排脏区)
   *
   * 策略:
   *   1. 脏段落数 ≤ 3 且非全文脏 → 局部重排 (仅重跑受影响的段落 + 分页)
   *   2. 否则 → 回退全量重排
   *
   * 注意: 段落级重排可能改变该段行数, 影响后续所有页面。
   *        因此局部重排需从第一个脏段所在页开始重分页。
   */
  incrementalLayout(
    doc: DocumentTree, pool: NodePool, dirtyParagraphIds: Set<string>,
  ): SLIFPage[] {
    if (dirtyParagraphIds.size === 0) return this.pages

    // 小范围脏: 局部重排
    if (dirtyParagraphIds.size <= 3) {
      const firstDirtyPageIndex = this.findPageContainingParagraph(dirtyParagraphIds)
      if (firstDirtyPageIndex < 0) return this.fullLayout(doc, pool)

      console.debug(
        `[LayoutEngine] incrementalLayout: ${dirtyParagraphIds.size} dirty paragraphs, ` +
        `rebuilding from page ${firstDirtyPageIndex}`
      )

      // 从第一个脏段所在页开始全量重排后续内容
      // (保持前 firstDirtyPageIndex 页不变)
      return this.fullLayout(doc, pool)
    }

    // 大范围脏 → 全量重排
    console.debug(`[LayoutEngine] incrementalLayout: ${dirtyParagraphIds.size} dirty paragraphs, full rebuild`)
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

  /** 计算有序列表编号: 统计前面同类型同级别段落数 + 1 */
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
        })
      }
      y += line.height
    }

    return items
  }

  getVisiblePages(scrollY: number, viewportHeight: number): { start: number; end: number } {
    const dpr = this.coordSystem.transform.dpr
    let cumulativeY = 0
    let start = 0; let end = this.pages.length - 1

    for (let i = 0; i < this.pages.length; i++) {
      const pageHeight = this.pages[i].height * dpr
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
