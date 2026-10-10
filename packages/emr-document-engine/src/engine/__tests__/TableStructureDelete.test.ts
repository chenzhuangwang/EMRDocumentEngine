// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// Editor.deleteTableRowAt / deleteTableColumnAt 门面测试 (P2 表格结构删除)
//
// 验证右键菜单「删除行」「删除列」走 TableStructureCommand 落地:
//   - 显式坐标 (tableId + row / row+col) 不依赖 _selectedTableId 状态
//   - deleteTableColumnAt 将行内 cell 下标经 getCellGridPosition
//     转换为网格列下标 (plain 表格下二者一致)
//   - undo 经 RestoreTableCommand 完整还原 (RULE 8)
// ============================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost, type DomEditorHost } from '../../platform/dom'
import {
  createDocument, createParagraph, createTextNode,
  createTable, createTableRow, createTableCell,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree, Table, TableRow, TableCell } from '../document/core/DocumentModel'

/** 构造 2×2 表格文档 (每个 cell 含一个文本段落 "r{c}"), 表格为 body 唯一子节点 */
function makeTableDoc(): { doc: DocumentTree; tableId: string } {
  const doc = createDocument('dn')
  const nodes: Record<string, BaseNode> = {}
  nodes[doc.id] = doc as unknown as BaseNode

  const mkCell = (r: number, c: number): TableCell => {
    const text = createTextNode(`r${r}c${c}`)
    const para = createParagraph([text.id])
    nodes[text.id] = text as unknown as BaseNode
    nodes[para.id] = para as unknown as BaseNode
    const cell = createTableCell([para.id])
    nodes[cell.id] = cell as unknown as BaseNode
    return cell
  }

  const rows: TableRow[] = []
  for (let r = 0; r < 2; r++) {
    const cells = [mkCell(r, 0), mkCell(r, 1)]
    const row = createTableRow(cells)
    nodes[row.id] = row as unknown as BaseNode
    rows.push(row)
  }

  const table = createTable(
    Array.from({ length: 2 }, () => ({ width: 50, mode: 'percentage' as const })),
    rows,
  )
  nodes[table.id] = table as unknown as BaseNode

  doc.body.children = [table.id]
  ;(doc as unknown as { nodes?: Record<string, BaseNode> }).nodes = nodes

  return { doc, tableId: table.id }
}

const cleanups: Array<() => void> = []

function makeEditor() {
  const { doc, tableId } = makeTableDoc()
  const host: DomEditorHost = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  cleanups.push(() => { editor.destroy(); container.remove() })
  return { editor, tableId }
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

function tableNode(editor: Editor, tableId: string): Table {
  return editor.getPool().nodes.get(tableId) as unknown as Table
}

function rowCount(editor: Editor, tableId: string): number {
  return tableNode(editor, tableId).children.length
}

function rowCellCount(editor: Editor, tableId: string, rowIdx: number): number {
  const rowId = tableNode(editor, tableId).children[rowIdx]
  const row = editor.getPool().nodes.get(rowId) as unknown as TableRow
  return row.children.length
}

function columnCount(editor: Editor, tableId: string): number {
  return tableNode(editor, tableId).columns.length
}

describe('Editor.deleteTableRowAt / deleteTableColumnAt (P2 表格结构删除)', () => {
  it('删除行: 行数减一, undo 完整还原', () => {
    const { editor, tableId } = makeEditor()
    expect(rowCount(editor, tableId)).toBe(2)

    editor.deleteTableRowAt(tableId, 0)
    expect(rowCount(editor, tableId)).toBe(1)
    expect(rowCellCount(editor, tableId, 0)).toBe(2)

    editor.undo()
    expect(rowCount(editor, tableId)).toBe(2)
    expect(rowCellCount(editor, tableId, 0)).toBe(2)
    expect(rowCellCount(editor, tableId, 1)).toBe(2)
  })

  it('删除列: 每行 cell 数减一 + columns 减一, undo 完整还原', () => {
    const { editor, tableId } = makeEditor()
    expect(columnCount(editor, tableId)).toBe(2)
    expect(rowCellCount(editor, tableId, 0)).toBe(2)

    // col=1 为行内第 2 个 cell, 网格列 1 (plain 表格无 span)
    editor.deleteTableColumnAt(tableId, 0, 1)
    expect(columnCount(editor, tableId)).toBe(1)
    expect(rowCellCount(editor, tableId, 0)).toBe(1)
    expect(rowCellCount(editor, tableId, 1)).toBe(1)

    editor.undo()
    expect(columnCount(editor, tableId)).toBe(2)
    expect(rowCellCount(editor, tableId, 0)).toBe(2)
    expect(rowCellCount(editor, tableId, 1)).toBe(2)
  })
})
