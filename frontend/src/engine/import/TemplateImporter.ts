// ================================================================
// TemplateImporter — 外部模板 JSON → 引擎四层模型 (契约 §12.2)
//
// 职责: ROUTING。读取一个外部模板节点, 把它的每一个字段路由到
// 拥有它的那一层:
//
//   外部语义字段 (element.code/name/labels + format + required/
//                 readonly/privacy)  → ElementMeta (DocumentModel)
//   外部运行时值 (value: string/number/string[], 空值归一)
//                                    → SmartTextNode.value (契约 §12.6.1)
//   外部模板设计期字段 (deletable/editable/tips/label/prefix/
//                       suffix/single) → TemplateDefinitionStore (§12.1)
//   外部表现层字段 (borderStyle/contentWrap/contentStyle/minWidth/
//                   textAlign)        → PresentationStyleStore (§2.2)
//
// 契约铁律: 导入器不得在 SmartTextNode / ElementMeta / Paragraph 上
// 新增持久字段去承载本该属于 TemplateDefinition 或 PresentationStyle
// 层的东西。没有归宿的外部字段一律丢弃或推迟, 绝不塞进 DocumentModel。
//
// 已知推迟项 (契约 §12.2):
//   - 共享样式字典 (styles.paragraph/table + globalStyles) —— 仅解析
//     styles.text → TextStyle 的 font/size/bold。
//   - checkfield 复选框语义 (P0 只取 prefix 文本)。
//   - insert/delete 修订痕迹 (P0 丢弃标记, 保留兄弟内容)。
//   - scripts / valid (非四层模型)。
// ================================================================

import type {
  DocumentTree, BaseNode, ElementMeta, ElementFormat,
  TextStyle, Paragraph, TextNode, SmartTextNode,
  Table, TableRow, TableCell, ColumnDefinition, PageSetup,
  DocumentMetadata, ControlValue, ElementEnums, ElementEnumOption,
} from '../document/core/DocumentModel'
import { NodeType, generateId, normalizeDocumentMetadata } from '../document/core/DocumentModel'
import { isControlValueEmpty } from '../document/control/ControlValue'
import { CURRENT_DOCUMENT_VERSION, versionToString } from '../document/version/DocumentFormatVersion'
import { TemplateDefinitionStore } from '../template/TemplateDefinition'
import type { TemplateDefinition } from '../template/TemplateDefinition'
import { PresentationStyleStore } from '../render/presentation/PresentationStyle'
import type { PresentationStyle } from '../render/presentation/PresentationStyle'

// ================================================================
// 外部模板 JSON 的松散类型 (不可信第三方输入, 全部可选 + 防御式访问)
// ================================================================

interface ExtElementCode { internal?: string; dataElement?: string }
interface ExtElement { name?: string; code?: ExtElementCode; labels?: string[] }
interface ExtStyleRef { id?: string; css?: Record<string, unknown> }
interface ExtEnumOption { name?: string; value?: string; exclusive?: boolean; numericValue?: number }
interface ExtEnums {
  multiple?: boolean
  editable?: boolean
  searchable?: boolean
  data?: ExtEnumOption[]
}
interface ExtFormat {
  dataType?: string
  showType?: string
  minLength?: number
  maxLength?: number
  dictionary?: string
  scale?: number
  minRows?: number
  enums?: ExtEnums
}
interface ExtNode {
  type?: string
  id?: string
  code?: string
  data?: string
  label?: string
  prefix?: string
  suffix?: string
  tips?: string
  single?: boolean
  deletable?: boolean
  editable?: boolean
  required?: boolean
  readonly?: boolean
  privacy?: boolean
  value?: unknown
  format?: ExtFormat
  element?: ExtElement
  style?: ExtStyleRef
  children?: ExtNode[]
  headerRows?: number
  colspan?: number
  rowspan?: number
  [key: string]: unknown
}

// ================================================================
// 导入结果
// ================================================================

export interface TemplateImportResult {
  /** 语义内容 (DocumentTree) */
  doc: DocumentTree
  /** 全部节点 (构建 NodePool 的源) */
  nodes: Map<string, BaseNode>
  /** 模板设计期字段 (契约 §12.1) */
  templateDefinitions: TemplateDefinitionStore
  /** 表现层字段 (契约 §2.2) */
  presentationStyles: PresentationStyleStore
}

// ---- 单位换算 (引擎坐标以 px / 96dpi 为准) ----

const MM_PER_PX = 96 / 25.4
const PT_PER_PX = 4 / 3

function mmToPx(mm: number): number {
  return Math.round(mm * MM_PER_PX)
}

/** 解析带单位的长度串 → px (支持 px / mm / pt / 裸数值)。 */
function lengthToPx(v: unknown): number | undefined {
  if (typeof v === 'number') return Math.round(v)
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  let m = s.match(/^([\d.]+)\s*px$/i); if (m) return Math.round(parseFloat(m[1]))
  m = s.match(/^([\d.]+)\s*mm$/i); if (m) return mmToPx(parseFloat(m[1]))
  m = s.match(/^([\d.]+)\s*pt$/i); if (m) return Math.round(parseFloat(m[1]) * PT_PER_PX)
  m = s.match(/^([\d.]+)/); if (m) return Math.round(parseFloat(m[1]))
  return undefined
}

// ================================================================
// TemplateImporter
// ================================================================

export class TemplateImporter {
  private nodeMap: Map<string, BaseNode> = new Map()
  private templateDefinitions = new TemplateDefinitionStore()
  private presentationStyles = new PresentationStyleStore()
  private textStyles: Record<string, TextStyle> = {}

  /**
   * 导入一份外部模板 JSON (Object 或已解析的 JSON 文本均可, 由调用方
   * 决定解析时机)。每次调用产出全新的结果, 不保留跨次导入状态。
   */
  import(raw: unknown): TemplateImportResult {
    this.nodeMap = new Map()
    this.templateDefinitions = new TemplateDefinitionStore()
    this.presentationStyles = new PresentationStyleStore()
    this.textStyles = this.indexTextStyles(raw)

    const doc = this.parseDocument(raw)

    return {
      doc,
      nodes: this.nodeMap,
      templateDefinitions: this.templateDefinitions,
      presentationStyles: this.presentationStyles,
    }
  }

  // ------------------------------------------------------------
  // 文档 / 区块
  // ------------------------------------------------------------

  private parseDocument(raw: unknown): DocumentTree {
    const root = (raw ?? {}) as Record<string, unknown>
    const extDoc = (root.document ?? {}) as Record<string, unknown>

    const headerIds = this.parseSection(extDoc.header)
    const footerIds = this.parseSection(extDoc.footer)
    const bodyIds = this.parseSection(extDoc.body)

    const docId = generateId()
    const doc: DocumentTree = {
      type: NodeType.DOCUMENT,
      id: docId,
      title: this.parseTitle(root),
      pageSetup: this.parsePageSetup(root.layout),
      body: { mode: 'flow', children: bodyIds },
      header: headerIds,
      footer: footerIds,
      headerFooterConfig: { differentFirstPage: false, differentOddEven: false },
      modelVersion: versionToString(CURRENT_DOCUMENT_VERSION),
    }
    const metadata = this.parseMetadata(root)
    if (metadata) doc.metadata = metadata

    this.nodeMap.set(docId, doc as unknown as BaseNode)
    return doc
  }

  /** 解析一个 $root 区块 (header/body/footer) → 块级节点 id 数组 */
  private parseSection(section: unknown): string[] {
    if (!section || typeof section !== 'object') return []
    const children = (section as { children?: unknown }).children
    if (!Array.isArray(children)) return []
    const ids: string[] = []
    for (const child of children) {
      const id = this.parseBlock(child as ExtNode)
      if (id) ids.push(id)
    }
    return ids
  }

  private parseBlock(node: ExtNode): string | null {
    switch (node.type) {
      case 'paragraph': return this.parseParagraph(node)
      case 'table': return this.parseTable(node)
      default: return null
    }
  }

  private parseParagraph(node: ExtNode): string | null {
    const id = node.id
    if (!id) return null
    const childIds: string[] = []
    for (const child of node.children ?? []) {
      const cid = this.parseInline(child)
      if (cid) childIds.push(cid)
    }
    const para: Paragraph = { type: NodeType.PARAGRAPH, id, children: childIds }
    this.nodeMap.set(id, para)
    return id
  }

  private parseInline(node: ExtNode): string | null {
    switch (node.type) {
      case 'text': return this.parseText(node)
      case 'smarttext': return this.parseSmartText(node)
      case 'checkfield': return this.parseCheckfield(node)
      case 'insert':
      case 'delete':
        // 修订痕迹标记 (无 children), 兄弟内容照常导入 —— 契约 §12.2
        return null
      default: return null
    }
  }

  // ------------------------------------------------------------
  // 内联节点
  // ------------------------------------------------------------

  private parseText(node: ExtNode): string | null {
    const id = node.id
    if (!id) return null
    const text = typeof node.data === 'string' ? node.data : ''
    const tn: TextNode = { type: NodeType.TEXT, id, text, ...this.resolveTextStyle(node) }
    this.nodeMap.set(id, tn)
    return id
  }

  private parseSmartText(node: ExtNode): string | null {
    const id = node.id
    if (!id) return null

    const el = node.element
    if (el?.code) {
      // 有内联 element → SmartTextNode (语义 + 运行时 + 两层层外字段)
      const element: ElementMeta = {
        code: {
          internal: el.code.internal ?? '',
          dataElement: el.code.dataElement ?? '',
        },
        name: el.name ?? '',
      }
      if (el.labels && el.labels.length > 0) element.labels = el.labels

      const format = this.mapFormat(node.format)
      if (format) element.format = format
      if (node.required) element.required = true
      if (node.readonly) element.readonly = true
      if (node.privacy === true) element.privacy = { enabled: true, maskChar: '*', maskRule: 'full' }

      const st: SmartTextNode = {
        type: NodeType.SMART_TEXT,
        id,
        text: `[${el.name ?? ''}]`,          // 占位符 (契约 §2.1)
        element,
        ...this.resolveTextStyle(node),
      }
      const value = this.coerceControlValue(node.value)
      if (!isControlValueEmpty(value)) st.value = value

      this.nodeMap.set(id, st)
      this.setTemplateDefinition(id, node)
      this.setPresentationStyle(id, node)
      return id
    }

    // 无 element → 静态标签 (文本框/占位盒/字典值字段) → TextNode。
    // 文本依次取: label → code(当 code≠id, 即携带展示文本) → 字符串 value
    // → 内嵌 text 子节点 data (字典值字段把选中项渲染成内嵌 text)。
    const code = typeof node.code === 'string' ? node.code : ''
    const label = typeof node.label === 'string' ? node.label : ''
    const strValue = typeof node.value === 'string' ? node.value : ''
    const text = label || (code !== id ? code : '') || strValue || this.firstNestedText(node)
    const tn: TextNode = { type: NodeType.TEXT, id, text, ...this.resolveTextStyle(node) }
    this.nodeMap.set(id, tn)
    this.setPresentationStyle(id, node)
    return id
  }

  private parseCheckfield(node: ExtNode): string | null {
    const id = node.id
    if (!id) return null
    const text = typeof node.prefix === 'string' ? node.prefix : ''
    const tn: TextNode = { type: NodeType.TEXT, id, text, ...this.resolveTextStyle(node) }
    this.nodeMap.set(id, tn)
    this.setPresentationStyle(id, node)
    return id
  }

  /** 取节点内嵌的第一个非空 text 子节点的 data (字典值字段的渲染文本) */
  private firstNestedText(node: ExtNode): string {
    for (const child of node.children ?? []) {
      if (child.type === 'text' && typeof child.data === 'string' && child.data !== '') {
        return child.data
      }
    }
    return ''
  }

  // ------------------------------------------------------------
  // 表格
  // ------------------------------------------------------------

  private parseTable(node: ExtNode): string | null {
    const id = node.id
    if (!id) return null
    const columns: ColumnDefinition[] = []
    const rowIds: string[] = []
    const headerRows = typeof node.headerRows === 'number' ? node.headerRows : 0
    let rowIndex = 0

    for (const child of node.children ?? []) {
      if (child.type === 'colgroup') {
        for (const col of child.children ?? []) {
          if (col.type === 'col') columns.push(this.parseColumn(col))
        }
      } else if (child.type === 'tablebody') {
        for (const row of child.children ?? []) {
          const rid = this.parseRow(row, rowIndex < headerRows)
          if (rid) rowIds.push(rid)
          rowIndex++
        }
      }
    }

    const table: Table = { type: NodeType.TABLE, id, columns, children: rowIds }
    // 表格的业务标识 (如 "diagnosis-table") 供脚本定位, 存入 metadata
    if (typeof node.code === 'string' && node.code !== '' && node.code !== id) {
      table.metadata = { code: node.code }
    }
    this.nodeMap.set(id, table)
    return id
  }

  private parseColumn(col: ExtNode): ColumnDefinition {
    const width = col.style?.css?.width
    if (typeof width === 'string' && width.includes('%')) {
      const pct = parseFloat(width)
      return Number.isNaN(pct) ? { width: 0, mode: 'auto' } : { width: pct, mode: 'percentage' }
    }
    const px = lengthToPx(width)
    return px !== undefined ? { width: px, mode: 'fixed' } : { width: 0, mode: 'auto' }
  }

  private parseRow(node: ExtNode, isHeader: boolean): string | null {
    const id = node.id
    if (!id) return null
    const cellIds: string[] = []
    for (const child of node.children ?? []) {
      const cid = this.parseCell(child, isHeader)
      if (cid) cellIds.push(cid)
    }
    const row: TableRow = { type: NodeType.ROW, id, children: cellIds }
    this.nodeMap.set(id, row)
    return id
  }

  private parseCell(node: ExtNode, isHeader: boolean): string | null {
    const id = node.id
    if (!id) return null
    const blockIds: string[] = []
    for (const child of node.children ?? []) {
      const bid = this.parseBlock(child)
      if (bid) blockIds.push(bid)
    }
    const cell: TableCell = { type: NodeType.CELL, id, children: blockIds }
    if (typeof node.colspan === 'number' && node.colspan > 1) cell.colspan = node.colspan
    if (typeof node.rowspan === 'number' && node.rowspan > 1) cell.rowspan = node.rowspan
    if (isHeader) cell.isHeader = true
    const va = node.style?.css?.verticalAlign
    if (va === 'top' || va === 'middle' || va === 'bottom') cell.verticalAlign = va
    this.nodeMap.set(id, cell)
    return id
  }

  // ------------------------------------------------------------
  // 字段路由 (四层)
  // ------------------------------------------------------------

  /** ElementMeta.format (语义)。未知 dataType 收敛到契约词汇表。 */
  private mapFormat(fmt: ExtFormat | undefined): ElementFormat | undefined {
    if (!fmt) return undefined
    const f: ElementFormat = { dataType: this.coerceDataType(fmt.dataType) }
    if (fmt.showType === 'AN' || fmt.showType === 'N') f.showType = fmt.showType
    if (typeof fmt.minLength === 'number') f.minLength = fmt.minLength
    if (typeof fmt.maxLength === 'number') f.maxLength = fmt.maxLength
    if (typeof fmt.dictionary === 'string' && fmt.dictionary !== '') f.dictionary = fmt.dictionary
    if (typeof fmt.scale === 'number') f.scale = fmt.scale
    if (typeof fmt.minRows === 'number') f.minRows = fmt.minRows
    const enums = this.mapEnums(fmt.enums)
    if (enums) f.enums = enums
    return f
  }

  /**
   * 外部内联枚举 → ElementEnums (契约 §12.6 值域来源)。
   *
   * 映射 format.enums 的 multiple/editable/searchable 三态 + data[] 候选
   * (name/value/exclusive)。防御式收口: 非字符串 name/value 丢弃, 缺 value
   * 时回退 name, 缺 name 时回退 value (name 与 value 至少保留其一)。
   *
   * 注意 (VR-7): format.dictionary 是外部字典引用, 本方法不展开其候选;
   * dictionary 字段已在 mapFormat 中原文保留, 展开需 canonical
   * DictionaryProvider (后续)。inline enums 与 dictionary 二者各自独立。
   */
  private mapEnums(enums: ExtEnums | undefined): ElementEnums | undefined {
    if (!enums) return undefined
    const out: ElementEnums = {}
    if (typeof enums.multiple === 'boolean') out.multiple = enums.multiple
    if (typeof enums.editable === 'boolean') out.editable = enums.editable
    if (typeof enums.searchable === 'boolean') out.searchable = enums.searchable

    if (Array.isArray(enums.data)) {
      const data: ElementEnumOption[] = []
      for (const o of enums.data) {
        if (!o || typeof o !== 'object') continue
        const name = typeof o.name === 'string' ? o.name : ''
        const value = typeof o.value === 'string' ? o.value : name
        if (value === '') continue
        const opt: ElementEnumOption = { name: name !== '' ? name : value, value }
        if (o.exclusive === true) opt.exclusive = true
        if (typeof o.numericValue === 'number' && Number.isFinite(o.numericValue)) opt.numericValue = o.numericValue
        data.push(opt)
      }
      if (data.length > 0) out.data = data
    }
    return out
  }

  /**
   * 外部运行时值 → 规范 ControlValue (契约 §12.6.1)。
   * 仅保留 string / 有限 number / 全 string 数组; 其余 (boolean/null/
   * 混合数组等) 归为 undefined。空值归一交给调用方 isControlValueEmpty。
   */
  private coerceControlValue(raw: unknown): ControlValue | undefined {
    if (typeof raw === 'string') return raw
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
    if (Array.isArray(raw)) {
      const arr = raw.filter((v): v is string => typeof v === 'string')
      return arr.length > 0 ? arr : undefined
    }
    return undefined
  }

  private coerceDataType(dt: string | undefined): ElementFormat['dataType'] {
    switch (dt) {
      case 'S1': case 'S2': case 'S3': case 'N': case 'D': return dt
      case 'DT': return 'D'    // 日期时间 → 日期
      case 'L': return 'S3'    // 长文本 → 字符串
      default: return 'S3'
    }
  }

  /** 模板设计期字段 → TemplateDefinitionStore (契约 §12.1) */
  private setTemplateDefinition(id: string, node: ExtNode): void {
    const d: TemplateDefinition = {}
    if (typeof node.deletable === 'boolean') d.deletable = node.deletable
    if (typeof node.editable === 'boolean') d.editable = node.editable
    if (typeof node.tips === 'string') d.tips = node.tips
    if (typeof node.label === 'string') d.label = node.label
    if (typeof node.prefix === 'string') d.prefix = node.prefix
    if (typeof node.suffix === 'string') d.suffix = node.suffix
    if (typeof node.single === 'boolean') d.single = node.single
    if (Object.keys(d).length > 0) this.templateDefinitions.set(id, d)
  }

  /** 表现层字段 → PresentationStyleStore (契约 §2.2) */
  private setPresentationStyle(id: string, node: ExtNode): void {
    const s: PresentationStyle = {}
    if (typeof node.borderStyle === 'string') s.borderStyle = node.borderStyle
    if (typeof node.contentWrap === 'boolean') s.contentWrap = node.contentWrap
    if (typeof node.contentStyle === 'string') s.contentStyle = node.contentStyle
    if (node.minWidth !== undefined) {
      s.minWidth = typeof node.minWidth === 'number' ? node.minWidth : String(node.minWidth)
    }
    if (typeof node.textAlign === 'string') s.textAlign = node.textAlign
    if (Object.keys(s).length > 0) this.presentationStyles.set(id, s)
  }

  // ------------------------------------------------------------
  // 样式 / 元数据 / 页面
  // ------------------------------------------------------------

  /** 仅解析 styles.text → TextStyle 的 font/size/bold (契约 §12.2) */
  private indexTextStyles(raw: unknown): Record<string, TextStyle> {
    const out: Record<string, TextStyle> = {}
    const root = (raw ?? {}) as Record<string, unknown>
    const styles = (root.styles ?? {}) as Record<string, unknown>
    const text = (styles.text ?? {}) as Record<string, unknown>
    for (const [styleId, def] of Object.entries(text)) {
      if (!def || typeof def !== 'object') continue
      const d = def as Record<string, unknown>
      const s: TextStyle = {}
      if (typeof d.fontFamily === 'string') s.font = d.fontFamily
      if (typeof d.fontSize === 'string') {
        const px = lengthToPx(d.fontSize)   // "10.5pt" → 14px
        if (px !== undefined) s.size = px
      }
      if (d.fontWeight === 'bold') s.bold = true
      else if (typeof d.fontWeight === 'string' || typeof d.fontWeight === 'number') {
        const w = parseInt(String(d.fontWeight), 10)
        if (!Number.isNaN(w) && w >= 600) s.bold = true
      }
      if (Object.keys(s).length > 0) out[styleId] = s
    }
    return out
  }

  private resolveTextStyle(node: ExtNode): TextStyle {
    const ref = node.style?.id
    return (ref && this.textStyles[ref]) || {}
  }

  private parseTitle(root: Record<string, unknown>): string {
    return typeof root.categoryId === 'string' && root.categoryId !== ''
      ? root.categoryId
      : '导入的模板'
  }

  private parseMetadata(root: Record<string, unknown>): DocumentMetadata | undefined {
    const raw: Record<string, unknown> = {}
    if (typeof root._id === 'string') raw.externalId = root._id
    if (typeof root.categoryId === 'string') raw.categoryId = root.categoryId
    const props = (root.properties ?? {}) as Record<string, unknown>
    // 白名单映射 (契约 §7.7): 仅映射存在 canonical home 的字段, 交给
    // normalizeDocumentMetadata 收口; 未知字段 (version/createTime 等) drop (§12.2)。
    for (const k of [
      'author', 'creator', 'reviewer', 'department', 'category',
      'keywords', 'createdAt', 'updatedAt',
    ] as const) {
      const v = props[k]
      if (v !== undefined && v !== null) raw[k] = v
    }
    return normalizeDocumentMetadata(raw)
  }

  private parsePageSetup(layout: unknown): PageSetup {
    const l = (layout ?? {}) as Record<string, unknown>
    const paper = (l.paper ?? {}) as Record<string, unknown>
    const margins = (l.margins ?? {}) as Record<string, unknown>

    const orientation = paper.orientation === 'landscape' ? 'landscape' : 'portrait'
    let width = 794
    let height = 1123
    if (paper.type !== 'A4') {
      const w = lengthToPx(paper.width)
      const h = lengthToPx(paper.height)
      if (w !== undefined) width = w
      if (h !== undefined) height = h
    }

    // 边距: 裸数值按 mm 计 (外部模板边距单位), 带单位串走 lengthToPx
    const margin = (v: unknown, fallback: number): number =>
      typeof v === 'number' ? mmToPx(v) : (lengthToPx(v) ?? fallback)

    return {
      width,
      height,
      marginTop: margin(margins.top, 72),
      marginBottom: margin(margins.bottom, 72),
      marginLeft: margin(margins.left, 90),
      marginRight: margin(margins.right, 90),
      orientation,
    }
  }
}

/** 单例便捷入口 (纯注册表式, 无副作用, 见契约 §27.3) */
export const templateImporter = new TemplateImporter()

/**
 * 外部模板格式判别器 (契约 §12.2)。
 *
 * 外部模板 JSON 的顶层以 `document` 字段为锚点:
 *   { _id, categoryId, styles, globalStyles, layout,
 *     document: { header/body/footer }, valid, scripts }
 * 而引擎自身序列化格式 (DocumentTree) 以 `type: 'document'` + `body` 为根,
 * 顶层没有 `document` 字段。据此可无损区分两种格式, 供加载入口路由。
 */
export function isExternalTemplate(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const doc = (raw as Record<string, unknown>).document
  return !!doc && typeof doc === 'object'
}
