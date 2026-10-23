// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 表格「上方插入行 / 左侧插入列」(契约 §8.1 命令门)
//
// 原有 insertTableRow / insertTableColumn 只会在选中格下方/右侧插入,
// 第一行上方、第一列左侧没有入口 —— 用户无法给表头再加一行。
// 本文件锁住 Editor 门面与 At 变体 (右键菜单用) 都走命令、可撤销。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import {
  createDocument, createParagraph, createTextNode,
  createTable, createTableRow, createTableCell,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree, TableCell, TableRow } from '../document/core/DocumentModel'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

interface Fixture {
  editor: Editor
  doc: DocumentTree
  tableId: string
}

function makeEditor(): Fixture {
  const doc = createDocument('插行插列')
  const nodes: Record<string, BaseNode> = {}
  nodes[doc.id] = doc as unknown as BaseNode

  const rows: TableRow[] = []
  for (let r = 0; r < 2; r++) {
    const cells: TableCell[] = []
    for (let c = 0; c < 2; c++) {
      const tn = createTextNode(`r${r}c${c}`)
      const p = createParagraph([tn.id])
      const cell = createTableCell([p.id])
      nodes[tn.id] = tn as unknown as BaseNode
      nodes[p.id] = p as unknown as BaseNode
      nodes[cell.id] = cell as unknown as BaseNode
      cells.push(cell)
    }
    const row = createTableRow(cells)
    nodes[row.id] = row as unknown as BaseNode
    rows.push(row)
  }
  const table = createTable(
    [{ width: 50, mode: 'percentage' }, { width: 50, mode: 'percentage' }],
    rows,
  )
  nodes[table.id] = table as unknown as BaseNode
  doc.body.children = [table.id]
  ;(doc as unknown as { nodes?: Record<string, BaseNode> }).nodes = nodes

  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  cleanups.push(() => { editor.destroy(); container.remove() })

  return { editor, doc, tableId: table.id }
}

function rowCount(f: Fixture): number {
  return f.editor.getPool().getChildren(f.tableId).length
}

describe('表格上方插行 / 左侧插列', () => {
  it('insertTableRowAbove: 选中第一行 → 表首新增一行 (原第一行下移)', () => {
    const f = makeEditor()
    const oldFirst = f.editor.getPool().getChildren(f.tableId)[0]

    f.editor.selectTableCell(f.tableId, 0, 0)
    f.editor.insertTableRowAbove()

    expect(rowCount(f)).toBe(3)
    expect(f.editor.getPool().getChildren(f.tableId)[0]).not.toBe(oldFirst)
    expect(f.editor.getPool().getChildren(f.tableId)[1]).toBe(oldFirst)
  })

  it('insertTableRowAboveAt: 右键菜单路径同样插到指定行上方', () => {
    const f = makeEditor()
    const oldFirst = f.editor.getPool().getChildren(f.tableId)[0]

    f.editor.insertTableRowAboveAt(f.tableId, 0)

    expect(rowCount(f)).toBe(3)
    expect(f.editor.getPool().getChildren(f.tableId)[1]).toBe(oldFirst)
  })

  it('insertTableColumnLeft: 选中第一列 → 表首新增一列', () => {
    const f = makeEditor()
    f.editor.selectTableCell(f.tableId, 0, 0)
    f.editor.insertTableColumnLeft()

    const grid = f.editor.getPool().getChildren(f.tableId).map((rowId) => {
      const row = f.editor.getPool().nodes.get(rowId) as unknown as TableRow
      return row.children.length
    })
    expect(grid).toEqual([3, 3])
    const table = f.editor.getPool().nodes.get(f.tableId) as unknown as { columns: unknown[] }
    expect(table.columns.length).toBe(3)
  })

  it('上方插行可撤销', () => {
    const f = makeEditor()
    const oldFirst = f.editor.getPool().getChildren(f.tableId)[0]
    f.editor.insertTableRowAboveAt(f.tableId, 0)
    f.editor.undo()

    expect(rowCount(f)).toBe(2)
    expect(f.editor.getPool().getChildren(f.tableId)[0]).toBe(oldFirst)
  })
})
