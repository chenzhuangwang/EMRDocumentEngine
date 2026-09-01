// ============================================================
// ModelD — 树形文档数据模型 (架构 §2.1-§2.2 权威定义, v20.34)
//
// 存储去分页化: DocumentTree → body: FlowBody → BlockNode[]
// children 全 ID 化: children: readonly string[] (NodePool ID 引用)
// 路径体系统一: string[] (ID 链路), 废弃 TreePath
// ============================================================

// ---- 节点类型常量 ----

export const NodeType = {
  DOCUMENT: 'document',
  PARAGRAPH: 'paragraph',
  TABLE: 'table',
  ROW: 'row',
  CELL: 'cell',
  TEXT: 'text',
  SMART_TEXT: 'smarttext',
  IMAGE: 'image',
  SEPARATOR: 'separator',
  SECTION_BREAK: 'section_break',
  BOOKMARK: 'bookmark',
  CROSS_REFERENCE: 'cross_reference',
  FIELD: 'field',
  FOOTNOTE_REF: 'footnote_ref',
  FOOTNOTE_CONTENT: 'footnote_content',
  COMMENT_MARKER: 'comment_marker',
} as const
export type NodeType = (typeof NodeType)[keyof typeof NodeType]

// ================================================================
// 样式
// ================================================================

export interface TextStyle {
  font?: string
  size?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  underlineStyle?: 'single' | 'double' | 'wave'
  strikeout?: boolean
  color?: string
  highlight?: string
  superscript?: boolean
  subscript?: boolean
  letterSpacing?: number
}

export interface ParagraphStyle {
  alignment?: 'left' | 'center' | 'right' | 'justify'
  indent?: number
  lineHeight?: number
  spaceBefore?: number
  spaceAfter?: number
  /** 列表属性 */
  list?: ListStyle
  /** 大纲级别 (0=正文, 1-6=Heading 1-6) */
  outlineLevel?: number
}

export interface ListStyle {
  type: 'bullet' | 'ordered'
  level: number
  numberStyle?: 'decimal' | 'lower_alpha' | 'upper_alpha' | 'lower_roman' | 'upper_roman' | 'cjk_ideographic'
  bulletChar?: string
  startAt?: number
  continueNumbering?: boolean
}

// ================================================================
// ElementMeta — SmartTextNode 的国标医疗元数据
// ================================================================

export interface ElementCode {
  internal: string
  dataElement: string
}

export interface ElementFormat {
  dataType: 'S1' | 'S2' | 'S3' | 'N' | 'D'
  showType?: 'AN' | 'N'
  minLength?: number
  maxLength?: number
  dictionary?: string
  /** 数值精度 (小数点后位数), 如金额 scale=2 */
  scale?: number
  /** 多行文本控件的最小行数 */
  minRows?: number
  /** 枚举选项 (下拉/单选/复选) */
  enums?: ElementEnums
}

/** 枚举选项集 (下拉/单选/复选控件的候选值定义) */
export interface ElementEnums {
  /** 是否多选 */
  multiple?: boolean
  /** 是否允许手动输入 */
  editable?: boolean
  /** 是否可搜索过滤 */
  searchable?: boolean
  data?: ElementEnumOption[]
}

/** 单个枚举选项 */
export interface ElementEnumOption {
  name: string
  value: string
  /** 选中后互斥 (排除其他选项) */
  exclusive?: boolean
}

export interface PrivacyConfig {
  enabled: boolean
  maskChar: string
  maskRule: 'full' | 'partial'
}

export interface ElementMeta {
  code: ElementCode
  name: string
  labels?: string[]
  format?: ElementFormat
  required?: boolean
  readonly?: boolean
  privacy?: PrivacyConfig
}

// ================================================================
// 基础节点 (铁律 1: 节点本身不存储 parentId)
// ================================================================

export interface BaseNode {
  id: string
  type: NodeType
  metadata?: Record<string, unknown>
}

// ---- 内联节点 ----

export interface TextNode extends BaseNode, TextStyle {
  type: typeof NodeType.TEXT
  text: string
}

export interface SmartTextNode extends BaseNode, TextStyle {
  type: typeof NodeType.SMART_TEXT
  /** 占位符 (未填时的显示形式, 如 '[姓名]') — 契约 §2.1 */
  text: string
  /** 运行时值 (患者数据, 可选) — 缺失/空串视为未填, 读取方渲染 value 否则渲染 text — 契约 §2.1 */
  value?: string
  element: ElementMeta
}

export interface ImageNode extends BaseNode {
  type: typeof NodeType.IMAGE
  src?: string
  objectKey?: string
  width: number
  height: number
  naturalWidth?: number
  naturalHeight?: number
  wrapMode: 'inline' | 'square' | 'top-bottom'
}

export interface BookmarkNode extends BaseNode {
  type: typeof NodeType.BOOKMARK
  name: string
  targetId: string
  targetOffset?: number
}

export interface CrossReferenceNode extends BaseNode, TextStyle {
  type: typeof NodeType.CROSS_REFERENCE
  refType: 'bookmark' | 'heading' | 'footnote' | 'page_number'
  targetRef: string
  displayText: string
}

export type FieldType =
  | 'current_date' | 'current_time' | 'page_number' | 'total_pages'
  | 'author_name' | 'document_title' | 'last_saved_date' | 'print_date'

export interface FieldNode extends BaseNode, TextStyle {
  type: typeof NodeType.FIELD
  fieldType: FieldType
  format?: string
  cachedValue?: string
  cachedVersion?: number
}

export interface FootnoteRef extends BaseNode, TextStyle {
  type: typeof NodeType.FOOTNOTE_REF
  footnoteId: string
  /** 运行时缓存, 不持久化 (v20.5) */
  number?: number
}

export type InlineNode =
  | TextNode
  | SmartTextNode
  | ImageNode
  | BookmarkNode
  | CrossReferenceNode
  | FieldNode
  | FootnoteRef

// ---- 块级节点 + 特殊 ----

export interface Paragraph extends BaseNode, ParagraphStyle {
  type: typeof NodeType.PARAGRAPH
  children: readonly string[]
}

export interface Table extends BaseNode {
  type: typeof NodeType.TABLE
  columns: ColumnDefinition[]
  children: readonly string[]
  pageBreak?: TablePageBreakRule
}

export interface ColumnDefinition {
  width: number
  minWidth?: number
  mode?: 'fixed' | 'percentage' | 'auto'
}

export interface TablePageBreakRule {
  repeatHeader?: boolean
  minRowsBeforeBreak?: number
  continuationLabel?: string
}

export interface TableRow extends BaseNode {
  type: typeof NodeType.ROW
  height?: number
  children: readonly string[]
}

export interface TableCell extends BaseNode {
  type: typeof NodeType.CELL
  colspan?: number
  rowspan?: number
  children: readonly string[]
  backgroundColor?: string
  verticalAlign?: 'top' | 'middle' | 'bottom'
  isHeader?: boolean
}

export interface SeparatorNode extends BaseNode {
  type: typeof NodeType.SEPARATOR
  lineStyle?: 'solid' | 'dashed' | 'dotted' | 'double'
  width?: number
  color?: string
  widthMode?: 'full' | 'fixed'
  fixedWidth?: number
  alignment?: 'left' | 'center' | 'right'
}

export interface SectionBreak extends BaseNode {
  type: typeof NodeType.SECTION_BREAK
  breakType: 'next_page' | 'continuous' | 'even_page' | 'odd_page'
  nextPageSetup?: Partial<PageSetup>
  nextHeader?: string[]
  nextFooter?: string[]
  nextPageNumberStart?: number
  nextFirstPageDifferent?: boolean
}

export interface FootnoteContent extends BaseNode {
  type: typeof NodeType.FOOTNOTE_CONTENT
  refId: string
  children: readonly string[]
}

export interface CommentMarker extends BaseNode {
  type: typeof NodeType.COMMENT_MARKER
  threadId: string
  rangeStart: { path: string[]; offset: number }
  rangeEnd: { path: string[]; offset: number }
}

export type BlockNode = Paragraph | Table | ImageNode | SeparatorNode
export type BodyChild = BlockNode | SectionBreak

// ---- CommentThread (独立存后端) ----

export interface CommentEntry {
  id: string
  author: string
  content: string
  createdAt: number
  editedAt?: number
}

export interface CommentThread {
  id: string
  rangeStart: { path: string[]; offset: number }
  rangeEnd: { path: string[]; offset: number }
  author: string
  createdAt: number
  status: 'open' | 'resolved' | 'reopened'
  /** 创建时的乐观锁版本号, 指向 t_document.version (v20.7) */
  baseVersion: number
  anchorStatus: 'valid' | 'reanchored' | 'degraded'
  comments: CommentEntry[]
}

// ================================================================
// 正文模式
// ================================================================

export interface FlowBody {
  mode: 'flow'
  children: readonly string[]
}

// ================================================================
// 页面设置 & 文档
// ================================================================

export interface WatermarkConfig {
  type: 'text' | 'image' | 'tile'
  text?: string
  fontSize?: number
  color?: string
  opacity?: number
  rotation?: number
  spacing?: number
}

export interface PageSetup {
  width: number
  height: number
  marginTop: number
  marginBottom: number
  marginLeft: number
  marginRight: number
  orientation: 'portrait' | 'landscape'
  watermark?: WatermarkConfig
}

/** 页眉页脚选项 (§7.3 文档属性, canonical owner = DocumentTree) */
export interface HeaderFooterConfig {
  /** 首页不同 (首页使用独立页眉页脚) */
  differentFirstPage: boolean
  /** 奇偶页不同 (奇数页/偶数页使用不同页眉页脚) */
  differentOddEven: boolean
}

export const DEFAULT_HEADER_FOOTER_CONFIG: HeaderFooterConfig = {
  differentFirstPage: false,
  differentOddEven: false,
}

export interface DocumentTree {
  type: typeof NodeType.DOCUMENT
  id: string
  title: string
  pageSetup: PageSetup
  body: FlowBody
  header?: string[]
  footer?: string[]
  /** 页眉页脚选项 (可选, 缺失时读取方用 DEFAULT_HEADER_FOOTER_CONFIG) */
  headerFooterConfig?: HeaderFooterConfig
  footnotes?: string[]
  endnotes?: string[]
  comments?: CommentThread[]
  metadata?: Record<string, unknown>
  /**
   * 文档格式版本 (semver 字符串, 例 '4.2.0')
   * 由 DocumentSerializer 写入, DocumentLoader 读取并触发升级链。
   * 历史文档缺失该字段时, 视为 '1.0.0'。
   */
  modelVersion?: string
}

// ================================================================
// 默认值
// ================================================================

export const DEFAULT_PAGE_SETUP: PageSetup = {
  width: 794,
  height: 1123,
  marginTop: 72,
  marginBottom: 72,
  marginLeft: 90,
  marginRight: 90,
  orientation: 'portrait',
}

// ================================================================
// ID 生成器
// ================================================================

let _nodeIdCounter = 0
export function generateId(): string {
  return `nd_${Date.now().toString(36)}_${(++_nodeIdCounter).toString(36)}`
}
export function resetIdCounter(): void {
  _nodeIdCounter = 0
}
