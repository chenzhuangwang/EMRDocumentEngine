// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 表格边缘交互 (契约 §31.3.1)
//
//   1. 表格是容器首块时, 首格首段段首回车 → 在表格上方建段 (Word)
//   2. 点击表格行右侧空白 → 光标落到该行末尾 (含最后一行)
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
  tableId: string
  /** cellParas[row][col] */
  cellParas: string[][]
}

const ROWS = 3
const COLS = 3

function makeEditor(parts: Array<'p1' | 'table'>): Fixture {
  const doc = createDocument('表格边缘')
  const nodes: Record<string, BaseNode> = {}
  nodes[doc.id] = doc as unknown as BaseNode

  const mkPara = (text: string): string => {
    const tn = createTextNode(text)
    const p = createParagraph([tn.id])
    nodes[tn.id] = tn as unknown as BaseNode
    nodes[p.id] = p as unknown as BaseNode
    return p.id
  }

  const cellParas: string[][] = []
  const rows: TableRow[] = []
  for (let r = 0; r < ROWS; r++) {
    const cells: TableCell[] = []
    const rowParas: string[] = []
    for (let c = 0; c < COLS; c++) {
      const p = mkPara(`r${r}c${c}`)
      rowParas.push(p)
      const cell = createTableCell([p])
      nodes[cell.id] = cell as unknown as BaseNode
      cells.push(cell)
    }
    cellParas.push(rowParas)
    const row = createTableRow(cells)
    nodes[row.id] = row as unknown as BaseNode
    rows.push(row)
  }
  const table = createTable(
    [{ width: 33.3, mode: 'percentage' }, { width: 33.3, mode: 'percentage' }, { width: 33.3, mode: 'percentage' }],
    rows,
  )
  nodes[table.id] = table as unknown as BaseNode

  const p1 = mkPara('head')
  const ids: Record<string, string> = { p1, table: table.id }
  doc.body.children = parts.map(part => ids[part])
  ;(doc as unknown as Record<string, BaseNode>).nodes = nodes

  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  cleanups.push(() => { editor.destroy(); container.remove() })

  return { editor, doc, container, p1, tableId: table.id, cellParas }
}

function press(f: Fixture, key: string): void {
  f.container.dispatchEvent(new KeyboardEvent('keydown', {
    key, bubbles: true, cancelable: true,
  }))
}

function caretAt(f: Fixture, paraId: string, offset: number): void {
  f.editor.getStore().setCursor({
    paragraphPath: [f.doc.id, paraId], offset, visible: true,
  })
}

function bodyIds(f: Fixture): string[] {
  return [...f.doc.body.children]
}

function clickAt(f: Fixture, x: number, y: number): void {
  f.container.dispatchEvent(new MouseEvent('click', {
    clientX: x, clientY: y, bubbles: true, cancelable: true,
  }))
}

describe('表格首格回车 (Word 逃生口)', () => {
  it('表格是首块: 首格首段段首回车 → 在表格上方建段, 光标进新段, 可撤销', () => {
    const f = makeEditor(['table'])
    caretAt(f, f.cellParas[0][0], 0)

    press(f, 'Enter')

    const body = bodyIds(f)
    expect(body.length).toBe(2)
    expect(body[1]).toBe(f.tableId)
    expect(f.editor.getPool().nodes.get(body[0])?.type).toBe('paragraph')
    const cursor = f.editor.getStore().state.runtime.cursor
    expect(cursor.paragraphPath).toEqual([f.doc.id, body[0]])
    expect(cursor.offset).toBe(0)

    f.editor.undo()
    expect(bodyIds(f)).toEqual([f.tableId])
  })

  it('表格不是首块: 同样位置回车仍拆 cell 段落, 文档块不变', () => {
    const f = makeEditor(['p1', 'table'])
    const before = bodyIds(f)
    caretAt(f, f.cellParas[0][0], 0)

    press(f, 'Enter')

    expect(bodyIds(f)).toEqual(before)
    const cellParaCount = f.editor.getPool().getChildren(
      f.editor.getPool().getChildren(f.editor.getPool().getChildren(f.tableId)[0])[0],
    ).length
    expect(cellParaCount).toBe(2)
  })

  it('首格首段段中回车 (offset>0) 也走普通拆段', () => {
    const f = makeEditor(['table'])
    caretAt(f, f.cellParas[0][0], 2)

    press(f, 'Enter')

    expect(bodyIds(f)).toEqual([f.tableId])
    const cellParaCount = f.editor.getPool().getChildren(
      f.editor.getPool().getChildren(f.editor.getPool().getChildren(f.tableId)[0])[0],
    ).length
    expect(cellParaCount).toBe(2)
  })
})

describe('表格行右侧点击', () => {
  it('点击第 2 行右侧空白 → 落该行末格段尾, 不改文档', () => {
    const f = makeEditor(['p1', 'table'])
    const rect = f.editor.getTableClientRects().get(f.tableId)!
    const rowH = rect.height / ROWS
    const before = bodyIds(f)

    clickAt(f, rect.left + rect.width + 20, rect.top + rowH * 1.5)

    const cursor = f.editor.getStore().state.runtime.cursor
    expect(cursor.paragraphPath).toEqual([f.doc.id, f.cellParas[1][COLS - 1]])
    expect(cursor.offset).toBe(4) // 'r1c2'
    expect(bodyIds(f)).toEqual(before)
    expect(f.editor.getBlockCaret()).toBeNull()
    // 行尾光标: 绘制在行右边界之外, 几何来自该行带
    const rec = f.editor.getRowEndCaret()
    expect(rec?.tableId).toBe(f.tableId)
    expect(rec?.height ?? 0).toBeGreaterThan(0)
    expect(rec?.top ?? -1).toBeGreaterThanOrEqual(rect.top)
  })

  it('行尾光标: 任意按键清除它, 字符落进该行末格', () => {
    const f = makeEditor(['p1', 'table'])
    const rect = f.editor.getTableClientRects().get(f.tableId)!
    const rowH = rect.height / ROWS
    clickAt(f, rect.left + rect.width + 20, rect.top + rowH * 1.5)
    expect(f.editor.getRowEndCaret()).not.toBeNull()

    press(f, 'Z')

    expect(f.editor.getRowEndCaret()).toBeNull()
    const para = f.editor.getPool().nodes.get(f.cellParas[1][COLS - 1]) as unknown as {
      children: string[]
    }
    const text = para.children
      .map(id => f.editor.getPool().nodes.get(id) as unknown as { type: string; text?: string })
      .map(n => (n.type === 'text' ? n.text || '' : ''))
      .join('')
    expect(text).toBe('r1c2Z')
  })

  it('点击其它位置清除行尾光标', () => {
    const f = makeEditor(['p1', 'table'])
    const rect = f.editor.getTableClientRects().get(f.tableId)!
    const rowH = rect.height / ROWS
    clickAt(f, rect.left + rect.width + 20, rect.top + rowH * 1.5)
    expect(f.editor.getRowEndCaret()).not.toBeNull()

    clickAt(f, rect.left + 10, rect.top + 5)

    expect(f.editor.getRowEndCaret()).toBeNull()
  })

  it('最后一行右侧同样可以落光标', () => {
    const f = makeEditor(['p1', 'table'])
    const rect = f.editor.getTableClientRects().get(f.tableId)!
    const rowH = rect.height / ROWS

    clickAt(f, rect.left + rect.width + 20, rect.top + rowH * 2.5)

    const cursor = f.editor.getStore().state.runtime.cursor
    expect(cursor.paragraphPath).toEqual([f.doc.id, f.cellParas[ROWS - 1][COLS - 1]])
    expect(cursor.offset).toBe(4) // 'r2c2'
  })

  it('点击表格左侧不会误判为行尾', () => {
    const f = makeEditor(['p1', 'table'])
    const rect = f.editor.getTableClientRects().get(f.tableId)!
    const rowH = rect.height / ROWS
    caretAt(f, f.p1, 0)

    clickAt(f, rect.left - 20, rect.top + rowH * 1.5)

    const cursor = f.editor.getStore().state.runtime.cursor
    // 左侧空白不属于行尾点击: 光标不应跳到行末段落
    expect(cursor.paragraphPath).not.toEqual([f.doc.id, f.cellParas[1][COLS - 1]])
  })
})

describe('行尾光标 + Enter (Word)', () => {
  it('非末行行尾回车 → 在当前行下方插入一行, 光标进新行首格, 可撤销', () => {
    const f = makeEditor(['p1', 'table'])
    const rect = f.editor.getTableClientRects().get(f.tableId)!
    const rowH = rect.height / ROWS
    clickAt(f, rect.left + rect.width + 20, rect.top + rowH * 0.5)
    expect(f.editor.getRowEndCaret()?.rowIndex).toBe(0)

    press(f, 'Enter')

    const pool = f.editor.getPool()
    const rows = pool.getChildren(f.tableId)
    expect(rows.length).toBe(ROWS + 1)
    const newRow = rows[1]
    const newCell = pool.getChildren(newRow)[0]
    const newPara = pool.getChildren(newCell)[0]
    expect(pool.nodes.get(newPara)?.type).toBe('paragraph')
    const cursor = f.editor.getStore().state.runtime.cursor
    expect(cursor.paragraphPath).toEqual([f.doc.id, newPara])
    expect(cursor.offset).toBe(0)
    expect(f.editor.getRowEndCaret()).toBeNull()

    f.editor.undo()
    expect(pool.getChildren(f.tableId).length).toBe(ROWS)
  })

  it('末行行尾回车 → 在表格下方建一个空段落, 光标进新段, 可撤销', () => {
    const f = makeEditor(['p1', 'table'])
    const rect = f.editor.getTableClientRects().get(f.tableId)!
    const rowH = rect.height / ROWS
    clickAt(f, rect.left + rect.width + 20, rect.top + rowH * 2.5)
    expect(f.editor.getRowEndCaret()?.rowIndex).toBe(ROWS - 1)

    press(f, 'Enter')

    const body = bodyIds(f)
    expect(body.length).toBe(3)
    expect(body[1]).toBe(f.tableId)
    expect(f.editor.getPool().nodes.get(body[2])?.type).toBe('paragraph')
    const cursor = f.editor.getStore().state.runtime.cursor
    expect(cursor.paragraphPath).toEqual([f.doc.id, body[2]])
    expect(cursor.offset).toBe(0)
    expect(f.editor.getPool().getChildren(f.tableId).length).toBe(ROWS)

    f.editor.undo()
    expect(bodyIds(f)).toEqual([f.p1, f.tableId])
  })

  it('末行行尾回车不会进入单元格拆段', () => {
    const f = makeEditor(['p1', 'table'])
    const rect = f.editor.getTableClientRects().get(f.tableId)!
    const rowH = rect.height / ROWS
    clickAt(f, rect.left + rect.width + 20, rect.top + rowH * 2.5)

    press(f, 'Enter')

    const lastRow = f.editor.getPool().getChildren(f.tableId)[ROWS - 1]
    const lastCell = f.editor.getPool().getChildren(lastRow)[COLS - 1]
    expect(f.editor.getPool().getChildren(lastCell).length).toBe(1)
  })
})
