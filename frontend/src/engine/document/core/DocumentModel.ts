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
  /** 首行缩进 (仅首行右移, 后续行顶格; 像素) */
  firstLineIndent?: number
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
  dataType: 'S1' | 'S2' | 'S3' | 'N' | 'D' | 'DT'
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
  /** 选项携带的数值 (如评分/权重, 契约 §12.7) — 可选用; 旧文档/旧数据缺失保持 undefined, 向后兼容 */
  numericValue?: number
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

/**
 * SmartTextNode 运行时值的规范类型 (契约 §12.6.1)。
 * undefined (缺失 value 字段) 是规范的空/未填状态, 不在该联合类型内。
 * 值类型映射: S1/S2/S3→string; N→number; D→"YYYY-MM-DD" string;
 * DT→"YYYY-MM-DD HH:mm:ss" string; 枚举 multiple===true→string[], 否则→string。
 * 已落地: value 拓宽为 ControlValue 与 SetControlValueCommand 同步 (契约 §12.6.1)。
 */
export type ControlValue = string | number | string[]

export interface SmartTextNode extends BaseNode, TextStyle {
  type: typeof NodeType.SMART_TEXT
  /** 占位符 (未填时的显示形式, 如 '[姓名]') — 契约 §2.1 */
  text: string
  /** 运行时值 (患者数据, 可选) — 缺失/空串/空数组视为未填, 读取方渲染 value 否则渲染 text — 契约 §2.1/§12.6 */
  value?: ControlValue
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
  /** 图片水印 URL (type='image' 或 'tile-image' 时) — 文档内容, 契约 §12.4 */
  imageUrl?: string
  /** 图片水印缩放比例 — 文档内容, 契约 §12.4 */
  imageScale?: number
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

// ================================================================
// DocumentMetadata — 文档级元数据 (契约 §7.7)
//
// 描述「这份文档是谁的、属于什么、何时创建/修改」—— 不是文档内容,
// 不是控件语义 (TemplateDefinition), 也不是控件运行时值 (SmartTextNode.value)。
// 唯一 canonical home = DocumentTree.metadata。title 不在此列 (顶级必填)。
//
// 与 BaseNode.metadata (Record<string, unknown>, 节点级业务标识如 table.code)
// 是两个不同概念, 不得混同、不得互相约束。
// ================================================================

export interface DocumentMetadata {
  /** 文档作者 */
  author?: string
  /** 创建人 */
  creator?: string
  /** 审核人 */
  reviewer?: string
  /** 科室 */
  department?: string
  /** 分类 */
  category?: string
  /** 关键词 (数组规范形; 逗号串仅是 UI 输入表示) */
  keywords?: string[]
  /** 外部模板 id (importer: root._id) */
  externalId?: string
  /** 外部模板分类 id (importer: root.categoryId) */
  categoryId?: string
  /** 系统创建时间 (ISO 8601, 系统生命周期字段, UI 只读) */
  createdAt?: string
  /** 最近修改时间 (ISO 8601, 系统生命周期字段, UI 只读) */
  updatedAt?: string
}

/** DocumentMetadata 的字符串型字段 (keywords 单独走数组规范化) */
const DOCUMENT_METADATA_STRING_KEYS = [
  'author', 'creator', 'reviewer', 'department', 'category',
  'externalId', 'categoryId', 'createdAt', 'updatedAt',
] as const

/** DocumentMetadata 全部 canonical 键 (契约 §7.7 白名单) */
export const DOCUMENT_METADATA_KEYS: readonly (keyof DocumentMetadata)[] = [
  ...DOCUMENT_METADATA_STRING_KEYS, 'keywords',
]

/**
 * 规范化任意输入为合法 DocumentMetadata (契约 §7.7)。
 *
 * 职责: 白名单收口 + 数据规范化 —— 这是「canonical model 决定字段」,
 * 不是 importer/UI 的自由裁量。所有写入方 (importer / UI / loader / upgrader)
 * 在把值交给 UpdateDocumentPropertiesCommand 前必须经此函数。
 *
 * 规则:
 *   - 非对象 / 数组 / null → undefined (视为无 metadata)
 *   - 字符串字段: 仅保留非空 trim 后的字符串, 其余丢弃
 *   - keywords: 仅接受数组; trim + 去空 + 去重 (保持顺序)
 *   - 未知字段一律丢弃 (§12.2)
 *   - 结果为空 → undefined (整体删除语义)
 */
export function normalizeDocumentMetadata(raw: unknown): DocumentMetadata | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const src = raw as Record<string, unknown>
  const out: DocumentMetadata = {}

  for (const k of DOCUMENT_METADATA_STRING_KEYS) {
    const v = src[k]
    if (typeof v === 'string') {
      const t = v.trim()
      if (t !== '') out[k] = t
    }
  }

  const kw = src['keywords']
  if (Array.isArray(kw)) {
    const seen = new Set<string>()
    const keywords: string[] = []
    for (const item of kw) {
      if (typeof item !== 'string') continue
      const t = item.trim()
      if (t !== '' && !seen.has(t)) { seen.add(t); keywords.push(t) }
    }
    if (keywords.length > 0) out.keywords = keywords
  }

  return Object.keys(out).length > 0 ? out : undefined
}

export interface DocumentTree {
  type: typeof NodeType.DOCUMENT
  id: string
  title: string
  pageSetup: PageSetup
  body: FlowBody
  /** 默认页眉段落 id 数组 — 语义 = 默认(奇数页)变体 (契约 §7.9) */
  header?: string[]
  /** 默认页脚段落 id 数组 — 语义 = 默认(奇数页)变体 (契约 §7.9) */
  footer?: string[]
  /**
   * 首页变体 (differentFirstPage 开启时用于第 1 页, 契约 §7.9)。
   * 加法可选字段: 缺失 ≡ 该变体无内容 (空带), 不预创建、不补默认值。
   */
  firstPageHeader?: string[]
  firstPageFooter?: string[]
  /**
   * 偶数页变体 (differentOddEven 开启时用于第 2,4,6… 页, 契约 §7.9)。
   * 加法可选字段: 缺失 ≡ 该变体无内容 (空带), 不预创建、不补默认值。
   */
  evenPageHeader?: string[]
  evenPageFooter?: string[]
  /** 页眉页脚选项 (可选, 缺失时读取方用 DEFAULT_HEADER_FOOTER_CONFIG) */
  headerFooterConfig?: HeaderFooterConfig
  footnotes?: string[]
  endnotes?: string[]
  comments?: CommentThread[]
  /** 文档级元数据 (契约 §7.7) — 权威 shape, 只约束文档级, 不约束 BaseNode.metadata */
  metadata?: DocumentMetadata
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
