// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 表外光标 (契约 §31.3.1)
//
// 点击表格前/后的空白: 有相邻段落 → 落段尾/段首; 没有 → 只画表外光标,
// 不改文档结构; 用户输入字符/Enter 时才物化一个空段落 (命令, 可撤销)。
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

function makeEditor(parts: Array<'p1' | 'table' | 'p2'>): Fixture {
  const doc = createDocument('表外光标')
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
  const ids: Record<string, string> = { p1, p2, table: table.id }
  doc.body.children = parts.map(part => ids[part])
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

function press(f: Fixture, key: string): void {
  f.container.dispatchEvent(new KeyboardEvent('keydown', {
    key, bubbles: true, cancelable: true,
  }))
}

function bodyIds(f: Fixture): string[] {
  return [...f.doc.body.children]
}

describe('表外光标物化 (契约 §31.3.1)', () => {
  it('点击表前空白不插节点; Enter 才在表前建段并落光标', () => {
    const f = makeEditor(['table'])
    f.editor.setBlockCaret({ blockId: f.tableId, side: 'before' })
    expect(bodyIds(f)).toEqual([f.tableId])

    press(f, 'Enter')
    expect(bodyIds(f).length).toBe(2)
    expect(bodyIds(f)[1]).toBe(f.tableId)
    const cursor = f.editor.getStore().state.runtime.cursor
    expect(cursor.paragraphPath).toEqual([f.doc.id, bodyIds(f)[0]])
    expect(cursor.offset).toBe(0)
    expect(f.editor.getBlockCaret()).toBeNull()

    f.editor.undo()
    expect(bodyIds(f)).toEqual([f.tableId])
  })

  it('表后表外光标同构: materialize 在表后建段, undo 移除', () => {
    const f = makeEditor(['table'])
    f.editor.setBlockCaret({ blockId: f.tableId, side: 'after' })
    expect(f.editor.materializeBlockCaret()).toBe(true)

    expect(bodyIds(f)).toEqual([f.tableId, f.doc.body.children[1]])
    expect(bodyIds(f)[0]).toBe(f.tableId)
    expect(bodyIds(f).length).toBe(2)

    f.editor.undo()
    expect(bodyIds(f)).toEqual([f.tableId])
  })

  it('表前表外光标 + Delete → 删除该表 (回到一个空段落)', () => {
    const f = makeEditor(['table'])
    f.editor.setBlockCaret({ blockId: f.tableId, side: 'before' })
    press(f, 'Delete')

    expect(bodyIds(f).length).toBe(1)
    expect(f.editor.getPool().nodes.get(bodyIds(f)[0])?.type).toBe('paragraph')
    f.editor.undo()
    expect(bodyIds(f)).toEqual([f.tableId])
  })

  it('表外光标方向键进入表格首格', () => {
    const f = makeEditor(['table'])
    f.editor.setBlockCaret({ blockId: f.tableId, side: 'before' })
    press(f, 'ArrowDown')

    const cursor = f.editor.getStore().state.runtime.cursor
    expect(cursor.paragraphPath).toEqual([f.doc.id, f.cellParaId])
    expect(f.editor.getBlockCaret()).toBeNull()
  })
})

describe('点击块间空白落点', () => {
  it('表格上方点击 (表格是首块) → 表外光标, 不插节点', () => {
    const f = makeEditor(['table'])
    const rect = f.editor.getTableClientRects().get(f.tableId)!
    const y = rect.top - 5

    f.container.dispatchEvent(new MouseEvent('click', {
      clientX: rect.left + 10, clientY: y, bubbles: true, cancelable: true,
    }))

    expect(bodyIds(f)).toEqual([f.tableId])
    expect(f.editor.getBlockCaret()).toEqual({ blockId: f.tableId, side: 'before' })
  })

  it('内容下方空白 (上方是表格) → 表外光标在表后', () => {
    const f = makeEditor(['table'])
    const rect = f.editor.getTableClientRects().get(f.tableId)!
    const y = rect.top + rect.height + 10

    f.container.dispatchEvent(new MouseEvent('click', {
      clientX: rect.left + 10, clientY: y, bubbles: true, cancelable: true,
    }))

    expect(bodyIds(f)).toEqual([f.tableId])
    expect(f.editor.getBlockCaret()).toEqual({ blockId: f.tableId, side: 'after' })
  })

  it('内容上方空白 (下方是段落) → 落到首段段首, 不建表外光标', () => {
    const f = makeEditor(['p1', 'table'])
    const rect = f.editor.getTableClientRects().get(f.tableId)!

    f.container.dispatchEvent(new MouseEvent('click', {
      clientX: rect.left + 10, clientY: 10, bubbles: true, cancelable: true,
    }))

    const cursor = f.editor.getStore().state.runtime.cursor
    expect(cursor.paragraphPath).toEqual([f.doc.id, f.p1])
    expect(cursor.offset).toBe(0)
    expect(f.editor.getBlockCaret()).toBeNull()
  })

  it('内容下方空白 (上方是段落) → 落到末段段尾, 不建表外光标', () => {
    const f = makeEditor(['table', 'p2'])
    const rect = f.editor.getTableClientRects().get(f.tableId)!
    const y = rect.top + rect.height + 16 + 10

    f.container.dispatchEvent(new MouseEvent('click', {
      clientX: rect.left + 10, clientY: y, bubbles: true, cancelable: true,
    }))

    const cursor = f.editor.getStore().state.runtime.cursor
    expect(cursor.paragraphPath).toEqual([f.doc.id, f.p2])
    expect(cursor.offset).toBe(4) // 'tail'
    expect(f.editor.getBlockCaret()).toBeNull()
  })

  it('点表格正上方的段落行 → 光标落在该段落 (不误判为表外光标)', () => {
    const f = makeEditor(['p1', 'table'])
    const rect = f.editor.getTableClientRects().get(f.tableId)!

    f.container.dispatchEvent(new MouseEvent('click', {
      clientX: rect.left + 10, clientY: rect.top - 3, bubbles: true, cancelable: true,
    }))

    const cursor = f.editor.getStore().state.runtime.cursor
    expect(cursor.paragraphPath).toEqual([f.doc.id, f.p1])
    expect(cursor.offset).toBeGreaterThanOrEqual(0)
    expect(cursor.offset).toBeLessThanOrEqual(4)
    expect(f.editor.getBlockCaret()).toBeNull()
  })
})
