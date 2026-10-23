// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// Delete 键删除「非段落块之间的空段落」(契约 §8.1 键盘 → Command)
//
// 复现: 模板正文第一块是空段落, 紧跟一个表格。光标在该空段落时按 Delete
// 原本什么都不做 —— 因为键盘分支只会 MergeParagraphCommand, 而下一个块
// 是表格, 无法并段。Word 的行为是删掉这条空行、表格上移。
//
// 只对**空段落**生效: 非空段落按 Delete 不允许整段消失; 末尾空段落没有
// 下一块, 也保持原样。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import {
  createDocument, createParagraph, createTextNode,
  createTable, createTableRow, createTableCell,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

interface Fixture {
  editor: Editor
  doc: DocumentTree
  container: HTMLElement
  emptyPara: string
  tableId: string
  tailPara: string
}

/** body = [emptyPara, table, tailPara] / [tailPara, table, tail2] / [tailPara, table, emptyPara] / [emptyPara, contentPara] */
function makeEditor(body: 'empty-first' | 'text-first' | 'empty-last' | 'empty-before-text'): Fixture {
  const doc = createDocument('删除空段')
  const nodes: Record<string, BaseNode> = {}
  nodes[doc.id] = doc as unknown as BaseNode

  const mkPara = (text: string): string => {
    const tn = createTextNode(text)
    const p = createParagraph([tn.id])
    nodes[tn.id] = tn as unknown as BaseNode
    nodes[p.id] = p as unknown as BaseNode
    return p.id
  }

  const cellPara = mkPara('cell-text')
  const cell = createTableCell([cellPara])
  nodes[cell.id] = cell as unknown as BaseNode
  const row = createTableRow([cell])
  nodes[row.id] = row as unknown as BaseNode
  const table = createTable([{ width: 100, mode: 'percentage' }], [row])
  nodes[table.id] = table as unknown as BaseNode

  const emptyPara = mkPara('')
  const tailPara = mkPara('tail')

  doc.body.children = body === 'empty-first'
    ? [emptyPara, table.id, tailPara]
    : body === 'text-first'
      ? [tailPara, table.id, mkPara('tail2')]
      : body === 'empty-before-text'
        ? [emptyPara, mkPara('主诉：胸痛')]
        : [tailPara, table.id, emptyPara]
  ;(doc as unknown as { nodes?: Record<string, BaseNode> }).nodes = nodes

  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  cleanups.push(() => { editor.destroy(); container.remove() })

  return { editor, doc, container, emptyPara, tableId: table.id, tailPara }
}

function caret(f: Fixture, paraId: string, offset = 0): void {
  const path = [f.doc.id, paraId]
  f.editor.getStore().setCursor({ paragraphPath: path, offset, visible: true })
  f.editor.getStore().setSelection({
    anchor: { paragraphPath: path, offset, visible: false },
    focus: { paragraphPath: path, offset, visible: false },
    active: false,
    granularity: 'character',
  })
}

function pressDelete(f: Fixture, target: HTMLElement = f.container): void {
  target.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Delete', bubbles: true, cancelable: true,
  }))
}

function pressBackspace(f: Fixture, target: HTMLElement = f.container): void {
  target.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Backspace', bubbles: true, cancelable: true,
  }))
}

describe('Delete 删除非段落块前的空段落', () => {
  it('空段落 + 下一个块是表格 → 删除空段落, 表格上移', () => {
    const f = makeEditor('empty-first')
    caret(f, f.emptyPara)
    pressDelete(f)

    expect(f.doc.body.children).toEqual([f.tableId, f.tailPara])
    expect(f.editor.getPool().nodes.has(f.emptyPara)).toBe(false)
  })

  it('删除后可撤销, 空段落回到原下标', () => {
    const f = makeEditor('empty-first')
    caret(f, f.emptyPara)
    pressDelete(f)
    f.editor.undo()

    expect(f.doc.body.children).toEqual([f.emptyPara, f.tableId, f.tailPara])
    expect(f.editor.getPool().nodes.has(f.emptyPara)).toBe(true)
  })

  it('非空段落 + 下一个块是表格 → 不整段删除', () => {
    const f = makeEditor('text-first')
    const textPara = f.doc.body.children[0]
    caret(f, textPara, 2)
    pressDelete(f)

    // 光标在段中 → 只删一个字符, 段落仍存在
    expect(f.doc.body.children[0]).toBe(textPara)
    expect(f.editor.getPool().nodes.has(textPara)).toBe(true)
  })

  it('末尾空段落没有下一块 → 保持原样', () => {
    const f = makeEditor('empty-last')
    caret(f, f.emptyPara)
    pressDelete(f)

    expect(f.doc.body.children[f.doc.body.children.length - 1]).toBe(f.emptyPara)
  })
})

describe('Backspace 删除没有可并段落的空段落', () => {
  it('文档首段是空段落 → Backspace 删除它', () => {
    const f = makeEditor('empty-first')
    caret(f, f.emptyPara)
    pressBackspace(f)

    expect(f.doc.body.children).toEqual([f.tableId, f.tailPara])
    expect(f.editor.getPool().nodes.has(f.emptyPara)).toBe(false)
  })

  it('空段落前面是表格 (没有可并的段落) → Backspace 删除它', () => {
    const f = makeEditor('empty-last')
    caret(f, f.emptyPara)
    pressBackspace(f)

    expect(f.doc.body.children).not.toContain(f.emptyPara)
  })

  it('内容行段首 Backspace → 删除上面空行, 内容段保留原 id 与格式, 光标在 0', () => {
    const f = makeEditor('empty-before-text')
    const content = f.doc.body.children[1]
    caret(f, content, 0)
    pressBackspace(f)

    expect(f.doc.body.children).toEqual([content])
    expect(f.editor.getPool().nodes.has(f.emptyPara)).toBe(false)
    const cursor = f.editor.getStore().state.runtime.cursor
    expect(cursor.paragraphPath).toEqual([f.doc.id, content])
    expect(cursor.offset).toBe(0)
  })

  it('文档首段非空 → Backspace 在段首不整段删除', () => {
    const f = makeEditor('text-first')
    const textPara = f.doc.body.children[0]
    caret(f, textPara, 0)
    pressBackspace(f)

    expect(f.doc.body.children[0]).toBe(textPara)
    expect(f.editor.getPool().nodes.has(textPara)).toBe(true)
  })
})
