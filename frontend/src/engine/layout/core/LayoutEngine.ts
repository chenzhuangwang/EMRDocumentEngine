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

import type { DocumentTree, Paragraph, TextNode, SmartTextNode, ElementEnumOption } from '../../document/core/DocumentModel'
import type { NodePool } from '../../document/core/NodePool'
import type { ControlType } from '../../template/TemplateDefinition'
import type { SLIFPage, SLIFItem, SLIFRow, SLIFCell } from './SLIF'
import type { EventBus } from '../../interaction/EventBus'
import type { LayoutConfig } from './LayoutContext'
import type { LayoutResult } from './LayoutResult'
import type { TextMeasurer } from '../text/TextMeasurer'
import { LineBreaker } from '../line/LineBreaker'
import type { LineElement } from '../line/LineLayout'
import { PageBreaker } from '../page/PageBreaker'
import type { ILine, IPage } from '../page/PageLayout'
import { DEFAULT_PAGE_SETUP } from '../../document/core/DocumentModel'
import { controlValueDisplay } from '../../document/factory/ElementFormatter'
import { layoutControlOptions, controlOptionsWidth, controlOptionsPlaceholderWidth } from '../../document/control/ControlOptions'
import { controlVisualRecipe, CONTROL_BOX_PADDING, AFFORDANCE_GAP, AFFORDANCE_WIDTH, controlInlineLeadTrail, stripPlaceholderBrackets } from '../../document/control/ControlBox'
import { isControlValueEmpty } from '../../document/control/ControlValue'
import { wrapControlText } from '../text/TextWrap'
import { MergeMatrix } from '../../document/table/MergeMatrix'
import { FootnoteLayout } from '../footnote/FootnoteLayout'
import { ListParticle } from '../../render/particles/ListParticle'

export type { LayoutConfig } from './LayoutContext'
export type { LayoutResult } from './LayoutResult'

/**
 * 运行时控件内联渲染预留宽所需的最小信息 (契约 §12.6 表单模式内联渲染)。
 * 正交读取: controlType 直接来自 TemplateDefinition, options 直接来自 element.format.enums,
 * 布局只消费、不推导 (绝不从 dataType/enums 反向推断 controlType)。
 */
export interface InlineControlInfo {
  controlType?: ControlType
  options?: ElementEnumOption[]
  /** 附属字面量 (契约 §12.1 不变量 10) — 布局为其预留宽, 避免相邻控件重叠 */
  label?: string
  prefix?: string
  suffix?: string
}

/** 标题级别 → 字体缩放倍率 (基于正文默认 16px: H1=32, H2=24, H3=20, H4=18, H5=16, H6=14) */
const HEADING_SCALE: Record<number, number> = { 1: 2.0, 2: 1.5, 3: 1.25, 4: 1.125, 5: 1.0, 6: 0.875 }
const BASE_FONT_SIZE = 16

// 页眉/页脚区域 (WPS 式朝版心扩展, 契约 §7 页眉页脚布局)
const HF_MIN_REGION = 42       // 最小可交互/可见带高
const HF_HEAD_TOP_PAD = 8      // 页眉距页面顶部
const HF_HEAD_BOTTOM_PAD = 2
const HF_FOOT_TOP_PAD = 2
const HF_FOOT_BOTTOM_PAD = 8   // 页脚距页面底部
/** 文档含脚注时正文分页预留的脚注 gutter (与 FootnoteLayout 固定 60 一致) */
const FOOTNOTE_GUTTER = 60

export class LayoutEngine {
  private eventBus: EventBus
  private measurer: TextMeasurer
  private pages: SLIFPage[] = []
  private config: LayoutConfig
  // 运行时控件内联渲染预留宽信息源 (契约 §12.6) — 由 Draw 注入 (读取
  // templateDefinitions.controlType + element.format.enums)。布局不直接持有
  // templateDefinitions, 只消费回调, 保持布局与设计期层的解耦。
  private controlInfoOf: ((nodeId: string) => InlineControlInfo | undefined) | null = null

  constructor(eventBus: EventBus, measurer: TextMeasurer) {
    this.eventBus = eventBus
    this.measurer = measurer
    this.config = {
      pageWidth: 794, pageHeight: 1123,
      marginTop: 72, marginBottom: 72,
      marginLeft: 90, marginRight: 90,
    }
  }

  /** 全量重布局 — LineBreaker + PageBreaker 集成 (TASK-445) */
  fullLayout(doc: DocumentTree, pool: NodePool): LayoutResult {
    const measurer = this.measurer
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
              : childType === 'smarttext'
                ? controlValueDisplay((child as SmartTextNode).element, (child as SmartTextNode).value, tn.text)
                : tn.text
            const value = listMarker ? listMarker + textVal : textVal
            if (listMarker) listMarker = '' // 仅首节点添加
            // 标题: 缩放字号 + 加粗
            const baseSize = tn.size || BASE_FONT_SIZE
            const headingSize = isHeading ? Math.round(baseSize * headingScale) : undefined
            // 控件布局提示 (契约 §12.6):
            //   - 多行文本域 minRows (layer D): 影响行高, 不决定值语义
            //   - checkbox/radio 表单模式内联渲染: 预留候选项宽 (control.width),
            //     使内联候选项不与后续文本重叠 (信息源同 controlInfoOf, 无反向推导)
            let control: LineElement['control']
            // 控件未显式设字体/字号时, 继承同段落文字 run (避免控件比周围文字偏大/偏小)
            const runDefault = this.paraRunDefault(pool, para.children, BASE_FONT_SIZE)
            let smartFont: string | undefined
            let smartSize: number | undefined
            if (childType === 'smarttext') {
              const minRows = (child as unknown as { element?: { format?: { minRows?: number } } }).element?.format?.minRows
              const info = this.controlInfoOf?.(childId)
              const recipe = controlVisualRecipe(info?.controlType)
              const opts = info?.options
              const font = tn.font || runDefault.font
              const size = tn.size || runDefault.size
              smartFont = font
              smartSize = size
              const measure = (t: string) =>
                this.measurer.measureWidth(t, { font, size, bold: tn.bold, italic: tn.italic })
              if (recipe.kind === 'options') {
                // 内联候选项预留宽 — 与渲染 (ControlParticle) / 命中 (MouseHandler) 共用
                // layoutControlOptions 单一事实源; 空候选项 (enums 但 data=[]) 仍 enum 语义,
                // 预留「无候选项」占位宽而非退化输入框 (不变量 3)。
                control = opts && opts.length > 0
                  ? { width: controlOptionsWidth(layoutControlOptions(opts, info!.controlType as 'checkbox' | 'radio', measure)) }
                  : { width: controlOptionsPlaceholderWidth(measure) }
              } else if (recipe.frame === 'brackets') {
                // 方括号框: 空态 textVal 已含 `[ ]` (占位符), 填充态需补画 `[ value ]`。
                // 预留宽 = 完整可见宽 (框 + 文本 + affordance), 闭环不变量 1。
                // select (affordance dropdown) 不画括号 → 预留宽不含方括号。
                const isEmpty = isControlValueEmpty((tn as unknown as { value?: unknown }).value)
                const bracketsOn = recipe.affordance == null
                const shown = isEmpty
                  ? (bracketsOn ? textVal : stripPlaceholderBrackets(textVal))
                  : (bracketsOn ? `[${textVal}]` : textVal)
                let width = measure(shown)
                if (recipe.affordance) width += AFFORDANCE_GAP + AFFORDANCE_WIDTH
                control = { width }
              } else if (recipe.frame === 'box') {
                // 四边框多行文本域 (textarea): 空态沿用 minRows; 填充态按值折行、
                // 预留 width+minRows+lines (契约 §12.6 多行, 行距=size)。
                const raw = (tn as unknown as { value?: unknown }).value
                const valueEmpty = isControlValueEmpty(raw)
                if (valueEmpty) {
                  control = (typeof minRows === 'number' && minRows > 0) ? { minRows } : undefined
                } else {
                  const str = typeof textVal === 'string' ? textVal : String(textVal)
                  const logical = str.split('\n')
                  const naturalW = logical.map((l) => measure(l))
                  const needWrap = contentWidth > 0 && naturalW.some((w) => w > contentWidth)
                  let physical: string[]
                  let colW: number
                  if (needWrap) {
                    physical = wrapControlText(str, contentWidth, measure)
                    colW = contentWidth
                  } else {
                    physical = logical
                    colW = Math.max(0, ...naturalW)
                  }
                  const rowsCount = physical.length
                  const reserveRows = Math.max(typeof minRows === 'number' && minRows > 0 ? minRows : 1, rowsCount)
                  control = {
                    width: colW > 0 ? colW : undefined,
                    minRows: reserveRows,
                    lines: physical,
                    rows: rowsCount,
                  }
                }
              } else {
                control = undefined
              }
              // 附属字面量 label/prefix/suffix 占位宽计入行内 advance (契约 §12.1
              // 不变量 10): 否则相邻控件的 label 会压到前一个盒/文字上。
              if (control && typeof control.width === 'number') {
                const { lead, trail } = controlInlineLeadTrail(info, measure)
                control = { ...control, width: control.width + lead + trail }
              }
            } else {
              control = undefined
            }
            elements.push({
              id: tn.id, type: childType, value,
              font: childType === 'smarttext' ? smartFont : tn.font,
              size: headingSize ?? (childType === 'smarttext' ? smartSize : tn.size),
              bold: isHeading ? true : tn.bold, italic: tn.italic,
              color: tn.color, underline: tn.underline,
              underlineStyle: (tn as { underlineStyle?: string }).underlineStyle,
              strikeout: tn.strikeout, superscript: tn.superscript, subscript: tn.subscript,
              highlight: tn.highlight,
              control,
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
            firstLineIndent: para.firstLineIndent,
            listMarker: savedListMarker || undefined,
          })
        } else {
          const lines = lineBreaker.breakLines(elements, {
            maxWidth: contentWidth, wordBreak: 'break-all',
            defaultFont: 'SimSun', defaultSize: 16,
            lineHeight: para.lineHeight,
          })
          // 标记每行的段落对齐/缩进; 首行缩进仅首行
          let isFirstLine = true
          for (const line of lines) {
            line.alignment = para.alignment
            line.indent = para.indent
            if (isFirstLine) {
              line.firstLineIndent = para.firstLineIndent
              if (savedListMarker) line.listMarker = savedListMarker
              isFirstLine = false
            }
          }
          allLines.push(...lines)
        }
      }
    }

    // 页眉/页脚内容布局 (每页一致; y 相对各自带顶, WPS 式锚定朝版心扩展)
    const headerLines = this.collectHFParagraphLines(doc.header, pool, lineBreaker, measurer, contentWidth)
    const footerLines = this.collectHFParagraphLines(doc.footer, pool, lineBreaker, measurer, contentWidth)
    const hfHeader = this.layoutHFRegion('header', headerLines, measurer, contentWidth)
    const hfFooter = this.layoutHFRegion('footer', footerLines, measurer, contentWidth)

    // 脚注 gutter: 含脚注时正文为脚注区预留
    const footnoteReserve = this.docContainsFootnotes(pool) ? FOOTNOTE_GUTTER : 0

    // 正文实际可用区 (WPS): 页眉超高 → 正文起点下移; 页脚超高 → 正文终点上移。
    const bodyTop = Math.max(this.config.marginTop, hfHeader.regionHeight)
    const bodyBottom = this.config.pageHeight - Math.max(this.config.marginBottom, hfFooter.regionHeight)
    const bodyArea = Math.max(0, bodyBottom - bodyTop - footnoteReserve)

    // Step 2: PageBreaker 分页 (正文可用高 = bodyArea)
    const iPages = pageBreaker.breakPages(allLines, [], [], pageSetup, footnoteReserve, bodyArea)

    // Step 3: IPage[] → SLIFPage[]
    const slifPages: SLIFPage[] = iPages.map((ip: IPage) => {
      let y = bodyTop
      const items: SLIFItem[] = []
      const pageContentHeight = bodyArea
      for (const line of ip.lines) {
        const firstEl = line.elements[0]

        // 表格: 展开为含行数据的 SLIFItem (R37+R65+TASK-702 跨页断表)
        if (firstEl?.type === 'table') {
          const tbl = (firstEl as LineElement).tableBlock as {
            id: string; columns?: { width: number }[]; children: readonly string[]
            pageBreak?: { repeatHeader?: boolean; minRowsBeforeBreak?: number; continuationLabel?: string }
          } | undefined
          if (tbl) {
            const { rows: allRows, columnWidths } = this.buildTableRows(tbl, pool, contentWidth, lineBreaker)
            const pageBreak = tbl.pageBreak
            const headerRowCount = pageBreak?.repeatHeader ? 1 : 0
            const minRows = pageBreak?.minRowsBeforeBreak || 2
            const label = pageBreak?.continuationLabel || '（续表）'

            // 计算剩余页面空间
            const pageContentBottom = bodyTop + pageContentHeight
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
                  y = bodyTop
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
        // 行起始 X (对齐/缩进后) — 元素级 X 累积基准 (修复拆分节点后多 item 重叠/选区偏移)
        // 块缩进 indent 每行生效; 首行缩进 firstLineIndent 仅首行 (LineBreaker 已只给首行赋值)。
        let lineStartX = this.config.marginLeft + (line.indent ?? 0) + (line.firstLineIndent ?? 0)
        if (line.alignment === 'center') {
          lineStartX = this.config.marginLeft + (contentWidth - line.width) / 2 + (line.indent ?? 0) + (line.firstLineIndent ?? 0)
        } else if (line.alignment === 'right') {
          lineStartX = this.config.marginLeft + contentWidth - line.width
        }
        let cursorX = lineStartX
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

          // 元素级 X: 从行内累积游标取值 (而非整行同一起点), 修复拆分节点后多 item 重叠/选区偏移
          let itemX = cursorX

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

          // 元素实际渲染宽度 (与 LineBreaker 同源度量), 供 x 累积 + hit-test 精确命中。
          // smarttext 是原子控件: 布局 advance 取「盒宽」= 文本宽 + 2*内边距 (与
          // LineBreaker.getElementWidth 同源), 否则相邻控件盒重叠、且换行不生效。
          const isSmart = el.type === 'smarttext'
          // 离散控件内联渲染: 预留候选项宽 (control.width), 与 LineBreaker 同源。
          // PageLayout.ILine.elements 是窄化类型 (无 control), 运行时仍保留该字段, 故回 cast。
          const elControl = (el as LineElement).control
          const controlWidth = isSmart && typeof elControl?.width === 'number' && elControl.width > 0
            ? elControl.width
            : undefined
          const itemWidth = controlWidth !== undefined
            ? controlWidth
            : measurer.measureWidth(itemText || '', {
                font: el.font || 'SimSun', size: el.size || 16,
                bold: el.bold, italic: el.italic,
              })
          const advanceWidth = itemWidth + (isSmart ? CONTROL_BOX_PADDING * 2 : 0)

          items.push({
            nodeId: el.id, nodeType: el.type, type: el.type,
            text: itemText,
            x: itemX, y, width: (itemMarkerWidth || 0) + itemWidth,
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
            controlLines: isSmart ? elControl?.lines : undefined,
            fieldType: (el as { fieldType?: string }).fieldType,
          })

          // 推进元素级 X 游标 (标记宽度 + 正文宽度 [+ 控件盒内边距])
          cursorX += (itemMarkerWidth || 0) + advanceWidth
        }
        y += line.height
      }

      // 页眉/页脚 — 复用预计算的 items/带高 (每页一致)
      return {
        pageIndex: ip.pageIndex, width: this.config.pageWidth, height: this.config.pageHeight, items,
        headerItems: hfHeader.items, footerItems: hfFooter.items,
        headerHeight: hfHeader.regionHeight, footerHeight: hfFooter.regionHeight,
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
      children: readonly string[]
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
      .map(id => pool.nodes.get(id) as { type?: string; height?: number; children: readonly string[] } | undefined)
      .filter((n): n is { type?: string; height?: number; children: readonly string[] } => !!n && n.type === 'row')
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
          verticalAlign?: 'top' | 'middle' | 'bottom'; children: readonly string[]
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
    paraIds: readonly string[],
    cellWidth: number,
    pool: NodePool,
    lineBreaker: LineBreaker,
    CELL_PAD: number,
  ): { items: SLIFItem[]; contentHeight: number } {
    const items: SLIFItem[] = []
    const maxTextWidth = Math.max(cellWidth - CELL_PAD * 2, 1)
    const DEFAULT_SIZE = BASE_FONT_SIZE
    let lineY = 0

    for (const paraId of paraIds) {
      const para = pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
      const elements: LineElement[] = []

      if (para?.children) {
        for (const textId of para.children) {
          const child = pool.nodes.get(textId) as {
            type?: string; text?: string; font?: string; size?: number
            bold?: boolean; italic?: boolean; color?: string
            underline?: boolean; strikeout?: boolean
            superscript?: boolean; subscript?: boolean
            value?: unknown; element?: { format?: { enums?: { multiple?: boolean; data?: ElementEnumOption[] }; minRows?: number } }
          } | undefined
          if (!child) continue
          if (child.type === 'text') {
            elements.push({
              id: textId, type: 'text', value: child.text || '',
              font: child.font, size: child.size, bold: child.bold, italic: child.italic,
              color: child.color, underline: child.underline, strikeout: child.strikeout,
              superscript: child.superscript, subscript: child.subscript,
            })
          } else if (child.type === 'smarttext') {
            // 表格 cell 内控件 — 预留宽与正文/页眉一致 (options 候选组 / 方括号+affordance /
            // label·prefix·suffix lead/trail), 使 cell 内控件可见、占宽、不重叠。
            const display = controlValueDisplay((child as SmartTextNode).element, (child as SmartTextNode).value, (child as { text: string }).text)
            // 未显式设字体/字号时继承同段落文字 run (与周围文字协调)
            const rd = this.paraRunDefault(pool, para.children, DEFAULT_SIZE)
            const font = child.font || rd.font
            const size = child.size || rd.size
            const measure = (t: string) => this.measurer.measureWidth(t, { font, size, bold: child.bold, italic: child.italic })
            const info = this.controlInfoOf?.(textId)
            const recipe = controlVisualRecipe(info?.controlType)
            let width: number | undefined
            if (recipe.kind === 'options') {
              const opts = info?.options
              width = opts && opts.length > 0
                ? controlOptionsWidth(layoutControlOptions(opts, info!.controlType as 'checkbox' | 'radio', measure))
                : controlOptionsPlaceholderWidth(measure)
            } else if (recipe.frame === 'brackets') {
              const isEmpty = isControlValueEmpty(child.value)
              const bracketsOn = recipe.affordance == null
              const shown = isEmpty
                ? (bracketsOn ? display : stripPlaceholderBrackets(display))
                : (bracketsOn ? `[${display}]` : display)
              width = measure(shown)
              if (recipe.affordance) width += AFFORDANCE_GAP + AFFORDANCE_WIDTH
            }
            if (typeof width === 'number') {
              const { lead, trail } = controlInlineLeadTrail(info, measure)
              width = width + lead + trail
            }
            elements.push({
              id: textId, type: 'smarttext', value: display,
              font, size, bold: child.bold, italic: child.italic,
              color: child.color, underline: child.underline, strikeout: child.strikeout,
              superscript: child.superscript, subscript: child.subscript,
              control: typeof width === 'number' ? { width } : undefined,
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
        lineHeight: (para as { lineHeight?: number } | undefined)?.lineHeight,
      })

      for (const line of lines) {
        // 逐元素计算行内 x 偏移 (多样式 run 正确拼接)
        let elX = 0
        for (const el of line.elements) {
          if (el.type === 'smarttext') {
            const elControl = (el as LineElement).control
            const layoutW = (typeof elControl?.width === 'number' && elControl.width > 0)
              ? elControl.width
              : this.measurer.measureWidth(el.value || '', {
                  font: el.font || 'SimSun', size: el.size || DEFAULT_SIZE,
                  bold: el.bold, italic: el.italic,
                })
            items.push({
              nodeId: el.id, nodeType: 'smarttext', type: 'smarttext',
              x: elX, y: lineY,
              width: layoutW, height: line.height,
              ascent: line.maxAscent, descent: line.maxDescent,
              font: el.font || 'SimSun', size: el.size || DEFAULT_SIZE,
              bold: el.bold, italic: el.italic,
              color: el.color, underline: el.underline, strikeout: el.strikeout,
              superscript: el.superscript, subscript: el.subscript,
              text: el.value || '',
            })
            elX += layoutW + CONTROL_BOX_PADDING * 2
            continue
          }
          if (el.type !== 'text') continue
          const elWidth = this.measurer.measureWidth(el.value || '', {
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
  /**
   * 收集页眉/页脚段落 → 折行 ILine[] (WPS 式多行)。
   * 空段/无可布局子节点 → 推占位行, 使 Enter 拆出的新空段有行、光标可落。
   */
  private collectHFParagraphLines(
    blockIds: string[] | undefined,
    pool: NodePool,
    lineBreaker: LineBreaker,
    measurer: TextMeasurer,
    contentWidth: number,
  ): ILine[] {
    if (!blockIds || blockIds.length === 0) return []
    const allLines: ILine[] = []

    for (const blockId of blockIds) {
      const block = pool.nodes.get(blockId)
      if (!block) continue
      if ((block as unknown as Record<string, unknown>).type !== 'paragraph') continue
      const para = block as unknown as Paragraph
      const elements: LineElement[] = []

      for (const childId of para.children) {
        const child = pool.nodes.get(childId)
        if (!child) continue
        const childType = (child as unknown as Record<string, unknown>).type as string
        if (childType === 'text' || childType === 'smarttext') {
          const tn = child as unknown as TextNode
          // smarttext: 有值显示值、无值回退占位符 (与正文一致); text: 原文
          const display = childType === 'smarttext'
            ? controlValueDisplay((child as SmartTextNode).element, (child as SmartTextNode).value, tn.text)
            : tn.text
          // 控件预留宽 (与正文一致): checkbox/radio 候选组 / 方括号+affordance,
          // 否则纯文本宽。使页眉内控件不与后续文字/选项重叠。
          let control: LineElement['control']
          let smartFont: string | undefined
          let smartSize: number | undefined
          if (childType === 'smarttext') {
            const info = this.controlInfoOf?.(tn.id)
            const recipe = controlVisualRecipe(info?.controlType)
            const opts = info?.options
            const rd = this.paraRunDefault(pool, para.children, BASE_FONT_SIZE)
            const font = tn.font || rd.font
            const size = tn.size || rd.size
            smartFont = font
            smartSize = size
            const measure = (t: string) => measurer.measureWidth(t, { font, size, bold: tn.bold, italic: tn.italic })
            if (recipe.kind === 'options') {
              control = opts && opts.length > 0
                ? { width: controlOptionsWidth(layoutControlOptions(opts, info!.controlType as 'checkbox' | 'radio', measure)) }
                : { width: controlOptionsPlaceholderWidth(measure) }
            } else if (recipe.frame === 'brackets') {
              const isEmpty = isControlValueEmpty((child as { value?: unknown }).value)
              const bracketsOn = recipe.affordance == null
              const shown = isEmpty
                ? (bracketsOn ? display : stripPlaceholderBrackets(display))
                : (bracketsOn ? `[${display}]` : display)
              let width = measure(shown)
              if (recipe.affordance) width += AFFORDANCE_GAP + AFFORDANCE_WIDTH
              control = { width }
            }
            if (control && typeof control.width === 'number') {
              const { lead, trail } = controlInlineLeadTrail(info, measure)
              control = { ...control, width: control.width + lead + trail }
            }
          }
          elements.push({
            id: tn.id, type: childType, value: display, control,
            font: childType === 'smarttext' ? smartFont : tn.font,
            size: childType === 'smarttext' ? smartSize : tn.size, bold: tn.bold, italic: tn.italic,
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

      if (elements.length === 0) {
        // 空段占位行 (对照正文空段) — Enter 拆出的新空段在此有行可画、光标可落
        const hEmpty = measurer.getLineHeight({ font: 'SimSun', size: BASE_FONT_SIZE })
        allLines.push({
          elements: [{ id: para.id, type: 'text', value: '' }],
          width: 0,
          height: hEmpty,
          maxAscent: hEmpty * 0.8,
          maxDescent: hEmpty * 0.2,
          alignment: para.alignment || 'left',
        })
        continue
      }

      const lines = lineBreaker.breakLines(elements, {
        maxWidth: contentWidth, wordBreak: 'break-all',
        defaultFont: 'SimSun', defaultSize: BASE_FONT_SIZE,
        lineHeight: (para as Paragraph).lineHeight,
      })
      let isFirst = true
      for (const line of lines) {
        line.alignment = para.alignment || 'left' // 页眉页脚默认左对齐 (WPS)
        if (isFirst) { line.firstLineIndent = (para as Paragraph).firstLineIndent; isFirst = false }
      }
      allLines.push(...lines)
    }
    return allLines
  }

  /**
   * 把页眉/页脚折行布局进上下 margin 带, 返回 items + 使用的带高。
   * y 相对带顶 (header 带顶=页顶; footer 带顶 = 页高 - footerHeight)。
   * WPS 式锚定: 页眉内容贴顶部向下扩展; 页脚内容贴带底向上扩展。
   * 超高 (> margin 带) → 裁掉靠页边一侧的行, 保留靠版心一侧。
   */
  private layoutHFRegion(
    kind: 'header' | 'footer',
    lines: ILine[],
    measurer: TextMeasurer,
    contentWidth: number,
  ): { items: SLIFItem[]; regionHeight: number } {
    if (lines.length === 0) return { items: [], regionHeight: HF_MIN_REGION }

    const padTop = kind === 'header' ? HF_HEAD_TOP_PAD : HF_FOOT_TOP_PAD
    const padBottom = kind === 'header' ? HF_HEAD_BOTTOM_PAD : HF_FOOT_BOTTOM_PAD
    const totalH = lines.reduce((s, l) => s + l.height, 0)

    // 不封顶 (WPS): 页眉/页脚随行数长高, 正文起点/分页容量按实际带高让位。
    const regionHeight = Math.max(HF_MIN_REGION, totalH + padTop + padBottom)
    // 页眉顶部锚定; 页脚底部锚定 (相对带顶; 配合 footerTop 在绝对坐标上靠页底)
    let y = kind === 'header'
      ? padTop
      : Math.max(0, regionHeight - padBottom - totalH)

    const items: SLIFItem[] = []
    for (const line of lines) {
      let lineStartX = this.config.marginLeft + (line.indent ?? 0) + (line.firstLineIndent ?? 0)
      if (line.alignment === 'center') {
        lineStartX = this.config.marginLeft + (contentWidth - line.width) / 2
      } else if (line.alignment === 'right') {
        lineStartX = this.config.marginLeft + contentWidth - line.width
      }
      let cursorX = lineStartX
      for (const el of line.elements) {
        const charHeight = measurer.getLineHeight({ font: el.font || 'SimSun', size: el.size || BASE_FONT_SIZE })
        // smarttext 控件: 用预留宽 (control.width, 与正文一致); 否则纯文本宽
        const elControl = (el as LineElement).control
        const layoutW = (el.type === 'smarttext' && typeof elControl?.width === 'number' && elControl.width > 0)
          ? elControl.width
          : measurer.measureWidth(el.value || '', {
              font: el.font || 'SimSun', size: el.size || BASE_FONT_SIZE,
              bold: el.bold, italic: el.italic,
            })
        const elWidth = layoutW
        const advanceWidth = el.type === 'smarttext' ? elWidth + CONTROL_BOX_PADDING * 2 : elWidth
        items.push({
          nodeId: el.id, nodeType: el.type, type: el.type,
          text: el.value,
          x: cursorX, y, width: elWidth,
          height: charHeight,
          ascent: line.maxAscent, descent: line.maxDescent,
          font: el.font || 'SimSun', size: el.size || BASE_FONT_SIZE,
          bold: el.bold, italic: el.italic,
          color: el.color, underline: el.underline,
          strikeout: el.strikeout, superscript: el.superscript, subscript: el.subscript,
          fieldType: (el as { fieldType?: string }).fieldType,
        })
        cursorX += advanceWidth
      }
      y += line.height
    }
    return { items, regionHeight }
  }

  /** 段落内首个文本 run 的字体/字号 — 供控件未显式设置时继承 (与周围文字协调) */
  private paraRunDefault(pool: NodePool, children: readonly string[], fallbackSize: number): { font: string; size: number } {
    for (const cid of children) {
      const n = pool.nodes.get(cid) as { type?: string; font?: string; size?: number } | undefined
      if (n?.type === 'text') return { font: n.font || 'SimSun', size: n.size || fallbackSize }
    }
    return { font: 'SimSun', size: fallbackSize }
  }

  /** 文档 (pool) 是否含脚注引用 — 用于正文分页预留脚注 gutter */
  private docContainsFootnotes(pool: NodePool): boolean {
    for (const [, node] of pool.nodes) {
      if ((node as { type?: string }).type === 'footnote_ref') return true
    }
    return false
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

  /** 注入内联渲染预留宽信息源 (契约 §12.6), null 清除 (缺省行为不变)。 */
  setControlInfoOf(fn: ((nodeId: string) => InlineControlInfo | undefined) | null): void {
    this.controlInfoOf = fn
  }
}
