// ============================================================
// 文档编辑器引擎 - 数据模型定义
// 参考: canvas-editor IElement + DCWriter 自研DOM模型
// ============================================================

// ---- 枚举类型 ----

export enum ElementType {
  TEXT = 'text',
  IMAGE = 'image',
  TABLE = 'table',
  CONTROL = 'control',
  PAGE_BREAK = 'page_break',
  SEPARATOR = 'separator',
  HYPERLINK = 'hyperlink',
  LATEX = 'latex',
  BARCODE = 'barcode',
  QRCODE = 'qrcode',
}

export enum ControlType {
  INPUT = 'input',
  SELECT = 'select',
  DATE = 'date',
  CHECKBOX = 'checkbox',
  RADIO = 'radio',
  NUMBER = 'number',
  TEXTAREA = 'textarea',
}

export enum EditorMode {
  EDIT = 'edit',
  READONLY = 'readonly',
  FORM = 'form',
  DESIGN = 'design',
  CLEAN = 'clean',
  PRINT = 'print',
}

export enum PageMode {
  PAGING = 'paging',
  LINKAGE = 'linkage',
}

export enum RowFlex {
  LEFT = 'LEFT',
  CENTER = 'CENTER',
  RIGHT = 'RIGHT',
  JUSTIFY = 'JUSTIFY',
}

export enum ZoneType {
  HEADER = 'header',
  MAIN = 'main',
  FOOTER = 'footer',
}

// ---- 接口定义 ----

export interface IElement {
  id: string
  type: ElementType
  value: string

  // 文本样式
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

  // 段落样式
  rowFlex?: RowFlex
  rowMargin?: number
  lineHeight?: number
  indent?: number

  // 特有属性
  trList?: ITr[]
  control?: IControl
  imageData?: IImageData

  // 留痕与权限
  revision?: IRevision
  permission?: IPermission
  validation?: IValidation

  // 业务扩展
  extension?: Record<string, unknown>
}

export interface ITr {
  height: number
  tdList: ITd[]
}

export interface ITd {
  width: number
  colspan?: number
  rowspan?: number
  value: IElement[]
  isHeader?: boolean
  backgroundColor?: string
  verticalAlign?: 'top' | 'middle' | 'bottom'
  borderColor?: string
}

export interface IControl {
  controlType: ControlType
  placeholder?: string
  options?: IControlOption[]
  multiple?: boolean
  min?: number
  max?: number
  maxLength?: number
  readonly?: boolean
  required?: boolean
  dataBinding?: IDataBinding
  value?: string
  checked?: boolean
  width?: number
}

export interface IControlOption {
  label: string
  value: string
}

export interface IImageData {
  src: string
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  wrapType?: 'inline' | 'square' | 'top-bottom'
}

export interface IDataBinding {
  source: string
  property: string
  expression?: string
}

export interface IValidation {
  required?: boolean
  pattern?: string
  min?: number
  max?: number
  maxLength?: number
  message?: string
}

export interface IRevision {
  type: 'insert' | 'delete' | 'modify'
  author: string
  timestamp: number
  oldValue?: string
  style?: {
    color?: string
    underlineStyle?: string
  }
}

export interface IPermission {
  level: number
  creatorId: string
  editable: boolean
  deletable: boolean
}

export interface IPageSetup {
  width: number
  height: number
  marginTop: number
  marginBottom: number
  marginLeft: number
  marginRight: number
  orientation: 'portrait' | 'landscape'
  headerHeight?: number
  footerHeight?: number
}

export interface IDocument {
  id: string
  title: string
  templateId?: string
  header: IElement[]
  main: IElement[]
  footer: IElement[]
  pageSetup: IPageSetup
  metadata: IDocumentMetadata
}

export interface IDocumentMetadata {
  author: string
  createdAt: string
  updatedAt: string
  version: number
  status: 'draft' | 'published' | 'archived'
  tags?: string[]
}

// ---- 渲染相关接口 ----

export interface IPosition {
  index: number
  pageIndex: number
  rowIndex: number
  x: number
  y: number
  width: number
  height: number
  ascent: number
  descent: number
}

export interface IPageOffset {
  x: number
  y: number
  pageIndex: number
}

export interface ILine {
  elements: IElement[]
  width: number
  height: number
  maxAscent: number
  maxDescent: number
}

export interface IPage {
  pageIndex: number
  lines: ILine[]
  headerLines: ILine[]
  footerLines: ILine[]
  totalHeight: number
}

export interface IDrawPayload {
  isCompute?: boolean
  isSetCursor?: boolean
  isSubmitHistory?: boolean
  isLazy?: boolean
}

export interface IEditorOption {
  pageSetup?: Partial<IPageSetup>
  scale?: number
  defaultFont?: string
  defaultSize?: number
  defaultColor?: string
  historyMaxRecordCount?: number
  wordBreak?: 'break-all' | 'break-word' | 'keep-all'
  mode?: EditorMode
  pageMode?: PageMode
  readOnly?: boolean
  disabled?: boolean
}

export interface IFontConfig {
  font: string
  size: number
  bold?: boolean
  italic?: boolean
  letterSpacing?: number
}

// ---- 编辑器事件 ----

export interface EditorEventMap {
  contentChange: { type: 'contentChange'; elements: IElement[] }
  modeChange: { type: 'modeChange'; mode: EditorMode }
  pageChange: { type: 'pageChange'; pageIndex: number; total: number }
  save: { type: 'save'; document: IDocument }
  selectionChange: { type: 'selectionChange'; range: { start: number; end: number } | null }
  scroll: { type: 'scroll'; scrollTop: number }
}

// ---- 默认值 ----

export const DEFAULT_PAGE_SETUP: IPageSetup = {
  width: 794,       // A4 宽度 (210mm)
  height: 1123,     // A4 高度 (297mm)
  marginTop: 72,    // 上边距 2.54cm
  marginBottom: 72,
  marginLeft: 90,   // 左边距 3.17cm
  marginRight: 90,
  orientation: 'portrait',
  headerHeight: 50,
  footerHeight: 40,
}

export const DEFAULT_EDITOR_OPTIONS: IEditorOption = {
  pageSetup: DEFAULT_PAGE_SETUP,
  scale: 1,
  defaultFont: 'SimSun',
  defaultSize: 16,
  defaultColor: '#000000',
  historyMaxRecordCount: 100,
  wordBreak: 'break-all',
  mode: EditorMode.EDIT,
  pageMode: PageMode.PAGING,
}

export const DEFAULT_FONT_CONFIG: IFontConfig = {
  font: 'SimSun',
  size: 16,
}

// ---- 元素工厂 ----

let elementIdCounter = 0

export function generateElementId(): string {
  return `el_${Date.now()}_${++elementIdCounter}`
}

export function createTextElement(value: string, overrides?: Partial<IElement>): IElement {
  return {
    id: generateElementId(),
    type: ElementType.TEXT,
    value,
    size: DEFAULT_FONT_CONFIG.size,
    font: DEFAULT_FONT_CONFIG.font,
    ...overrides,
  }
}

export function createPageBreakElement(): IElement {
  return {
    id: generateElementId(),
    type: ElementType.PAGE_BREAK,
    value: '',
  }
}

export function createControlElement(
  controlType: ControlType,
  overrides?: Partial<IElement>
): IElement {
  return {
    id: generateElementId(),
    type: ElementType.CONTROL,
    value: '',
    size: DEFAULT_FONT_CONFIG.size,
    font: DEFAULT_FONT_CONFIG.font,
    control: {
      controlType,
      placeholder: '',
    },
    ...overrides,
  }
}

export function createBlankDocument(title: string, author: string): IDocument {
  const now = new Date().toISOString()
  return {
    id: `doc_${Date.now()}`,
    title,
    header: [],
    main: [createTextElement('')],
    footer: [],
    pageSetup: { ...DEFAULT_PAGE_SETUP },
    metadata: {
      author,
      createdAt: now,
      updatedAt: now,
      version: 1,
      status: 'draft',
    },
  }
}

export function createDocumentFromTemplate(
  template: IDocument,
  title: string,
  author: string
): IDocument {
  const now = new Date().toISOString()
  return {
    ...template,
    id: `doc_${Date.now()}`,
    title,
    templateId: template.id,
    metadata: {
      author,
      createdAt: now,
      updatedAt: now,
      version: 1,
      status: 'draft',
    },
  }
}
