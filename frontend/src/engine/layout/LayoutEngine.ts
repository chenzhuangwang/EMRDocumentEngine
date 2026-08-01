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
import { textMeasurer } from './TextMeasurer'
import { LineBreaker, type LineElement } from './LineBreaker'
import { PageBreaker, type ILine, type IPage } from './PageBreaker'
import { DEFAULT_PAGE_SETUP } from '../document/DocumentModel'

/** 布局配置 */
export interface LayoutConfig {
  pageWidth: number
  pageHeight: number
  marginTop: number
  marginBottom: number
  marginLeft: number
  marginRight: number
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

        // 列表标记: 在段落开头插入 bullet/number 文本节点
        if (para.list) {
          const listType = para.list.type
          const level = para.list.level || 1
          const indent = '  '.repeat(level - 1)
          let marker = ''
          if (listType === 'bullet') {
            marker = indent + '• ' // bullet: •
          } else if (listType === 'ordered') {
            // 编号: 计算当前段落在同级列表中的序号
            const orderNum = this.computeListNumber(para.id, pool, doc, level)
            marker = indent + orderNum + '. '
          }
          if (marker) {
            elements.push({
              id: para.id + '_list_marker', type: 'text', value: marker,
              font: 'SimSun', size: 16,
            })
          }
        }

        for (const childId of para.children) {
          const child = pool.nodes.get(childId)
          if (!child) continue
          const childType = (child as unknown as Record<string, unknown>).type as string
          if (childType === 'text' || childType === 'smarttext') {
            const tn = child as unknown as TextNode
            elements.push({
              id: tn.id, type: childType, value: tn.text,
              font: tn.font, size: tn.size, bold: tn.bold, italic: tn.italic,
              color: tn.color,
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
          })
        } else {
          const lines = lineBreaker.breakLines(elements, {
            maxWidth: contentWidth, wordBreak: 'break-all',
            defaultFont: 'SimSun', defaultSize: 16,
          })
          // 标记每行的段落对齐/缩进
          for (const line of lines) {
            line.alignment = para.alignment
            line.indent = para.indent
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

          items.push({
            nodeId: el.id, nodeType: el.type, type: el.type,
            text: el.value,
            x: itemX, y, width: line.width / line.elements.length,
            height: charHeight,
            ascent: line.maxAscent, descent: line.maxDescent,
            font: el.font || 'SimSun', size: el.size || 16,
          })
        }
        y += line.height
      }
      return { pageIndex: ip.pageIndex, width: this.config.pageWidth, height: this.config.pageHeight, items }
    })

    this.pages = slifPages
    this.eventBus.emit('layout:changed', slifPages)
    return slifPages
  }

  /** 增量布局 (仅重排脏区) */
  incrementalLayout(
    _doc: DocumentTree, _pool: NodePool, _dirtyParagraphIds: Set<string>,
  ): SLIFPage[] {
    // TODO: TASK-481~485 增量布局实现
    // 当前回退到全量布局
    return this.pages
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
