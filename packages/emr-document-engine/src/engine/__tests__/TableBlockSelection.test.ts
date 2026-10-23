// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 表格整表选择 / 全选删除 (契约 §31.3.1)
//
// 旧行为: Ctrl+A 只建立文本选区, Delete 只删文字 → 表格原样留下。
// 本文件锁住:
//   - Ctrl+A 在 cell 内第一次选整表, 第二次选全文;
//   - 整表选择 Delete 删除整表 (可撤销);
//   - 全文选择 Delete 删除全部块并保留一个空段落 (一次撤销);
//   - 块级选择下输入字符 = 删块 + 插入, 一次撤销。
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
  container: HTMLElement
  p1: string
  p2: string
  tableId: string
  cellParaId: string
}

function makeEditor(options: { onlyTable?: boolean } = {}): Fixture {
  const doc = createDocument('整表选择')
  const nodes: Record<string, BaseNode> = {}
  nodes[doc.id] = doc as unknown as BaseNode

  const mkPara = (text: string): string => {
    const tn = createTextNode(text)
    const p = createParagraph([tn.id])
    nodes[tn.id] = tn as unknown as BaseNode
    nodes[p.id] = p as unknown as BaseNode
    return p.id
  }

  let cellParaId = ''
  const rows: TableRow[] = []
  for (let r = 0; r < 2; r++) {
    const cells: TableCell[] = []
    for (let c = 0; c < 2; c++) {
      const p = mkPara(`r${r}c${c}`)
      if (!cellParaId) cellParaId = p
      const cell = createTableCell([p])
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

  const p1 = mkPara('head')
  const p2 = mkPara('tail')
  doc.body.children = options.onlyTable ? [table.id] : [p1, table.id, p2]
  ;(doc as unknown as { nodes?: Record<string, BaseNode> }).nodes = nodes

  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  cleanups.push(() => { editor.destroy(); container.remove() })

  return { editor, doc, container, p1, p2, tableId: table.id, cellParaId }
}

function caretInCell(f: Fixture): void {
  const path = [f.doc.id, f.cellParaId]
  f.editor.getStore().setCursor({ paragraphPath: path, offset: 0, visible: true })
  f.editor.getStore().setSelection({
    anchor: { paragraphPath: path, offset: 0, visible: false },
    focus: { paragraphPath: path, offset: 0, visible: false },
    active: false,
    granularity: 'character',
  })
}

function press(f: Fixture, key: string, opts: KeyboardEventInit = {}): void {
  f.container.dispatchEvent(new KeyboardEvent('keydown', {
    key, bubbles: true, cancelable: true, ...opts,
  }))
}

describe('整表选择 (契约 §31.3.1)', () => {
  it('cell 内 Ctrl+A 第一次选中整表, 第二次选中全文', () => {
    const f = makeEditor()
    caretInCell(f)

    press(f, 'a', { ctrlKey: true })
    expect(f.editor.getWholeTableSelection()).toBe(f.tableId)
    expect(f.editor.isDocumentSelected()).toBe(false)

    press(f, 'a', { ctrlKey: true })
    expect(f.editor.getWholeTableSelection()).toBeNull()
    expect(f.editor.isDocumentSelected()).toBe(true)
  })

  it('整表选中 + Delete → 删除整表; undo 按下标/id 恢复', () => {
    const f = makeEditor()
    caretInCell(f)
    press(f, 'a', { ctrlKey: true })

    press(f, 'Delete')
    expect(f.doc.body.children).toEqual([f.p1, f.p2])
    expect(f.editor.getPool().nodes.has(f.tableId)).toBe(false)

    f.editor.undo()
    expect(f.doc.body.children).toEqual([f.p1, f.tableId, f.p2])
  })

  it('表格是唯一块 → 整表删除后 body 保留一个空段落', () => {
    const f = makeEditor({ onlyTable: true })
    caretInCell(f)
    press(f, 'a', { ctrlKey: true })
    press(f, 'Delete')

    expect(f.doc.body.children.length).toBe(1)
    const pool = f.editor.getPool()
    expect(pool.nodes.get(f.doc.body.children[0])?.type).toBe('paragraph')

    f.editor.undo()
    expect(f.doc.body.children).toEqual([f.tableId])
  })

  it('全文选中 + Delete → 所有块删除并保留一个空段落; undo 全部恢复', () => {
    const f = makeEditor()
    caretInCell(f)
    press(f, 'a', { ctrlKey: true })
    press(f, 'a', { ctrlKey: true })
    press(f, 'Delete')

    expect(f.doc.body.children.length).toBe(1)
    expect(f.editor.getPool().nodes.get(f.doc.body.children[0])?.type).toBe('paragraph')

    f.editor.undo()
    expect(f.doc.body.children).toEqual([f.p1, f.tableId, f.p2])
  })

  it('全文选中 + 字符 → 删全文并插入字符, 一次撤销', () => {
    const f = makeEditor()
    caretInCell(f)
    press(f, 'a', { ctrlKey: true })
    press(f, 'a', { ctrlKey: true })
    press(f, 'x')

    expect(f.doc.body.children.length).toBe(1)
    const pa = f.editor.getPool().nodes.get(f.doc.body.children[0]) as unknown as { children: string[] }
    const text = pa.children
      .map(id => f.editor.getPool().nodes.get(id) as unknown as { type: string; text?: string })
      .map(n => (n.type === 'text' ? n.text || '' : ''))
      .join('')
    expect(text).toBe('x')

    f.editor.undo()
    expect(f.doc.body.children).toEqual([f.p1, f.tableId, f.p2])
  })
})
