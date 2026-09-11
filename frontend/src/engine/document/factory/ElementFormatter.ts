// ============================================================
// ElementFormatter — 节点工厂 + 树操作 + 快照 (架构 §2.4, v20.34)
//
// 存储去分页化, 树操作统一走 NodePool
// ============================================================

import type {
  DocumentTree, Paragraph, TextNode, SmartTextNode,
  ImageNode, Table, TableRow, TableCell, SeparatorNode,
  SectionBreak, PageSetup, TextStyle, ParagraphStyle,
  ElementMeta, ColumnDefinition, FlowBody,
  FieldNode, FieldType, FootnoteRef, FootnoteContent,
  ControlValue,
} from '../core/DocumentModel'
import { NodeType, generateId, DEFAULT_PAGE_SETUP, DEFAULT_HEADER_FOOTER_CONFIG } from '../core/DocumentModel'
import { NodePool } from '../core/NodePool'
import { CURRENT_DOCUMENT_VERSION, versionToString } from '../version/DocumentFormatVersion'

// ================================================================
// 工厂函数
// ================================================================

export function createDocument(title: string, body?: FlowBody, pageSetup?: PageSetup): DocumentTree {
  return {
    type: NodeType.DOCUMENT, id: generateId(), title,
    pageSetup: pageSetup ?? { ...DEFAULT_PAGE_SETUP },
    body: body ?? { mode: 'flow', children: [] },
    header: [],
    footer: [],
    headerFooterConfig: { ...DEFAULT_HEADER_FOOTER_CONFIG },
    // 显式声明当前格式版本 — DocumentLoader 加载时无需升级
    modelVersion: versionToString(CURRENT_DOCUMENT_VERSION),
  }
}

export function createParagraph(children?: readonly string[], style?: ParagraphStyle): Paragraph {
  return { type: NodeType.PARAGRAPH, id: generateId(), children: children ?? [], ...style }
}

export function createTextNode(text: string, style?: TextStyle): TextNode {
  return { type: NodeType.TEXT, id: generateId(), text, ...style }
}

export function createSmartTextNode(text: string, element: ElementMeta, style?: TextStyle, value?: ControlValue): SmartTextNode {
  const node: SmartTextNode = { type: NodeType.SMART_TEXT, id: generateId(), text, element, ...style }
  if (value !== undefined) node.value = value
  return node
}

/**
 * SmartTextNode 有效显示文本: 有值时显示值, 否则显示占位符 (契约 §2.1)。
 * value 为 undefined / '' / [] 时视为「未填」, 回退到 text 占位符。
 * number → String(n); string[] → 以 '、' 连接 (多选候选展示)。
 */
export function smartTextDisplayValue(node: { text: string; value?: ControlValue }): string {
  const v = node.value
  if (v === undefined || v === '') return node.text
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) return v.length > 0 ? v.join('、') : node.text
  return v
}

/**
 * 控件显示文本 (渲染用) — 枚举值映射回候选 name:
 *   - 空 (undefined/'') → fallbackText (占位符)
 *   - 有 enums: 单值 → 该候选 name; 多值 → 各候选 name 以 '、' 连接
 *     (找不到对应候选则回退原值)
 *   - 无 enums: number→String(n); 其余原值
 * 使下拉/单选/复选在页面上显示候选名称而非内部 value (如 汉族 而非 hz)。
 */
export function controlValueDisplay(
  element: ElementMeta | undefined,
  value: ControlValue | undefined,
  fallbackText: string,
): string {
  if (value === undefined || value === '') return fallbackText
  if (typeof value === 'number') return String(value)
  const data = element?.format?.enums?.data
  const nameOf = (v: string): string => data?.find((o) => o.value === v)?.name ?? v
  if (Array.isArray(value)) return value.length > 0 ? value.map(nameOf).join('、') : fallbackText
  return nameOf(value)
}

/**
 * SmartTextNode 在查找替换中的参与文本 (契约 §26), 与 smartTextDisplayValue 分离:
 *
 *   - value === undefined   → null (占位符非用户内容, 排除出查找替换)
 *   - value 为 string        → 该字符串 (S1/S2/S3 自由文本 / D 日期 / 单选枚举值)
 *   - value 为 number        → String(n) (数字值的显示形式, 可查找; 替换经 number 归并)
 *   - value 为 string[]      → join('、') (多选显示形式, 可查找; 替换在命令层拒绝并报理由)
 *
 * 返回 null 表示该控件不参与查找替换 (仅占位符/未填态)。已填值一律可查找,
 * 能否替换由 ReplaceTextCommand 按值语义归并/拒绝 (§26)。
 * FindReplaceEngine.getParagraphText 与 ReplaceTextCommand.resolveEditLocation 共用
 * 本函数, 保证查找命中偏移与替换落点偏移一致。
 */
export function smartTextFindReplaceText(node: { text: string; value?: ControlValue }): string | null {
  const v = node.value
  if (v === undefined) return null
  if (typeof v === 'string') return v === '' ? null : v
  if (typeof v === 'number') return String(v)
  return v.length > 0 ? v.join('、') : null
}

export function createFieldNode(fieldType: FieldType, format?: string, style?: TextStyle): FieldNode {
  const labels: Record<string, string> = {
    page_number: '[页码]', total_pages: '[总页数]',
    current_date: '[日期]', current_time: '[时间]',
    author_name: '[作者]', document_title: '[标题]',
    last_saved_date: '[保存日期]', print_date: '[打印日期]',
  }
  return {
    type: NodeType.FIELD, id: generateId(),
    fieldType, format,
    cachedValue: labels[fieldType] || `[${fieldType}]`,
    ...style,
  }
}

export function createImageNode(objectKey: string, width: number, height: number, wrap: 'inline' | 'square' | 'top-bottom' = 'inline'): ImageNode {
  return { type: NodeType.IMAGE, id: generateId(), objectKey, width, height, wrapMode: wrap }
}

export function createTable(columns: ColumnDefinition[] = [], rows?: TableRow[]): Table {
  const id = generateId()
  return { type: NodeType.TABLE, id, columns, children: (rows ?? []).map(r => r.id) }
}

export function createTableRow(cells?: TableCell[], height?: number): TableRow {
  const id = generateId()
  return { type: NodeType.ROW, id, height, children: (cells ?? []).map(c => c.id) }
}

export function createTableCell(blockIds?: string[], opts?: Partial<TableCell>): TableCell {
  return { type: NodeType.CELL, id: generateId(), children: blockIds ?? [], ...opts }
}

export function createSimpleTable(rows: number, cols: number): Table {
  const tableId = generateId()
  const allNodes: Record<string, object> = {}
  const rowIds: string[] = []

  for (let r = 0; r < rows; r++) {
    const cellIds: string[] = []
    for (let c = 0; c < cols; c++) {
      const cell = createTableCell([])
      cellIds.push(cell.id)
      allNodes[cell.id] = cell
    }
    const row = createTableRow()
    row.children = cellIds
    allNodes[row.id] = row
    rowIds.push(row.id)
  }

  const table: Table = {
    type: NodeType.TABLE, id: tableId,
    columns: Array.from({ length: cols }, () => ({ width: 100 / cols, mode: 'percentage' as const })),
    children: rowIds,
  }
  return table
}

export function createSeparatorNode(style?: Partial<SeparatorNode>): SeparatorNode {
  return { type: NodeType.SEPARATOR, id: generateId(), ...style }
}

export function createSectionBreak(breakType: SectionBreak['breakType']): SectionBreak {
  return { type: NodeType.SECTION_BREAK, id: generateId(), breakType }
}

export function createFootnoteRef(footnoteId: string): FootnoteRef {
  return { type: NodeType.FOOTNOTE_REF, id: generateId(), footnoteId }
}

export function createFootnoteContent(refId: string, children?: readonly string[]): FootnoteContent {
  return { type: NodeType.FOOTNOTE_CONTENT, id: generateId(), refId, children: children ?? [] }
}

// ================================================================
// 树操作 — 基于 NodePool
// ================================================================

export function insertAt(pool: NodePool, parentId: string, childId: string, index: number): boolean {
  try { pool.insertChild(parentId, childId, index); return true } catch { return false }
}

export function removeAt(pool: NodePool, parentId: string, index: number): boolean {
  try { pool.removeChild(parentId, index); return true } catch { return false }
}

export function findById(pool: NodePool, id: string): object | undefined {
  return pool.nodes.get(id)
}

export function findByDE(pool: NodePool, deCode: string): SmartTextNode[] {
  const results: SmartTextNode[] = []
  for (const node of pool.nodes.values()) {
    if ((node.type as string) === 'smarttext' && (node as SmartTextNode).element?.code?.dataElement === deCode) {
      results.push(node as SmartTextNode)
    }
  }
  return results
}

export function findByInternal(pool: NodePool, internalCode: string): SmartTextNode[] {
  const results: SmartTextNode[] = []
  for (const node of pool.nodes.values()) {
    if ((node.type as string) === 'smarttext' && (node as SmartTextNode).element?.code?.internal === internalCode) {
      results.push(node as SmartTextNode)
    }
  }
  return results
}

// ================================================================
// 快照 + 样式工具
// ================================================================

export function takeSnapshot(tree: DocumentTree): string { return JSON.stringify(tree) }
export function restoreSnapshot(json: string): DocumentTree { return JSON.parse(json) as DocumentTree }

export function extractStyle(node: TextNode): TextStyle {
  return {
    font: node.font, size: node.size, bold: node.bold, italic: node.italic,
    color: node.color, underline: node.underline, strikeout: node.strikeout,
    underlineStyle: node.underlineStyle, highlight: node.highlight,
    superscript: node.superscript, subscript: node.subscript, letterSpacing: node.letterSpacing,
  }
}

export function sameStyle(a: TextStyle, b: TextStyle): boolean {
  return a.font === b.font && a.size === b.size && a.bold === b.bold &&
    a.italic === b.italic && a.color === b.color &&
    a.underline === b.underline && a.strikeout === b.strikeout
}

/**
 * 选区样式快照: 各字段全部一致 → 返回该值; 任一字段不一致 → 该字段置 undefined
 * (混合/不定态, 供工具栏按钮保持未激活)。空数组 → 返回 {}。
 */
const TEXT_STYLE_KEYS = [
  'font', 'size', 'bold', 'italic', 'underline', 'underlineStyle',
  'strikeout', 'color', 'highlight', 'superscript', 'subscript', 'letterSpacing',
] as const

export function uniformTextStyle(styles: TextStyle[]): TextStyle {
  const out: TextStyle = {}
  if (styles.length === 0) return out
  const target = out as Record<string, unknown>
  const first = styles[0] as Record<string, unknown>
  for (const k of TEXT_STYLE_KEYS) target[k] = first[k]
  for (let i = 1; i < styles.length; i++) {
    const s = styles[i] as Record<string, unknown>
    for (const k of TEXT_STYLE_KEYS) {
      if (target[k] !== s[k]) target[k] = undefined
    }
  }
  return out
}
