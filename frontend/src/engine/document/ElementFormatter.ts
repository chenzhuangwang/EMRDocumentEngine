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
} from './DocumentModel'
import { NodeType, generateId, DEFAULT_PAGE_SETUP } from './DocumentModel'
import { NodePool } from './NodePool'
import { CURRENT_DOCUMENT_VERSION, versionToString } from './DocumentFormatVersion'

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
    // 显式声明当前格式版本 — DocumentLoader 加载时无需升级
    modelVersion: versionToString(CURRENT_DOCUMENT_VERSION),
  }
}

export function createParagraph(children?: string[], style?: ParagraphStyle): Paragraph {
  return { type: NodeType.PARAGRAPH, id: generateId(), children: children ?? [], ...style }
}

export function createTextNode(text: string, style?: TextStyle): TextNode {
  return { type: NodeType.TEXT, id: generateId(), text, ...style }
}

export function createSmartTextNode(text: string, element: ElementMeta, style?: TextStyle): SmartTextNode {
  return { type: NodeType.SMART_TEXT, id: generateId(), text, element, ...style }
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

export function createFootnoteContent(refId: string, children?: string[]): FootnoteContent {
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
