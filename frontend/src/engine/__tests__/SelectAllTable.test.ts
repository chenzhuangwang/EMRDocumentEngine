// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// SelectAllTable — 全选覆盖表格 (修复「正文 + 表格, 全选选不中表格」)
//
// 根因: 选区模型线性定位基于 doc.body.children (顶层块), 而表格的
// 文本在 cell 内段落, 不在 body.children。selectAll 锚定 body[0]→
// body[last] (last 为 table 时 textLength=0), render/copy/count 的
// indexOf 对 cell 段落返回 -1 被整体丢弃。
//
// 修复: SelectionCollector.flattenTextContainers 把表格展开为 cell
// 段落 (行主序/列序), selectAll / collectSelectionTextNodeIds /
// ClipboardManager.copy / Draw.renderSelectionUnified 统一基于展平
// spine 定位。本测试用真实 Editor 断言 selectAll 的选区状态与字数
// 统计覆盖表格内容。
// ============================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost, type DomEditorHost } from '../../platform/dom'
import {
  createDocument, createParagraph, createTextNode,
  createTable, createTableRow, createTableCell,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree, TableCell } from '../document/core/DocumentModel'

const cleanups: Array<() => void> = []

/** 正文段落 + 换行 + 表格 (1×2): body = [para("第一段文本"), table(cell0 "hello world" / cell1 "right")] */
function makeEditor(): { editor: Editor; doc: DocumentTree; paraId: string; cell1ParaId: string } {
  const doc = createDocument('dn')
  const nodes: Record<string, BaseNode> = {}
  nodes[doc.id] = doc as unknown as BaseNode

  const mkCell = (text: string): TableCell => {
    const tn = createTextNode(text)
    const para = createParagraph([tn.id])
    nodes[tn.id] = tn as unknown as BaseNode
    nodes[para.id] = para as unknown as BaseNode
    const cell = createTableCell([para.id])
    nodes[cell.id] = cell as unknown as BaseNode
    return cell
  }

  const tn1 = createTextNode('第一段文本')
  const para = createParagraph([tn1.id])
  nodes[tn1.id] = tn1 as unknown as BaseNode
  nodes[para.id] = para as unknown as BaseNode

  const cell0 = mkCell('hello world')
  const cell1 = mkCell('right')
  const row = createTableRow([cell0, cell1])
  nodes[row.id] = row as unknown as BaseNode
  const table = createTable(
    [{ width: 50, mode: 'percentage' as const }, { width: 50, mode: 'percentage' as const }],
    [row],
  )
  nodes[table.id] = table as unknown as BaseNode

  doc.body.children = [para.id, table.id]
  ;(doc as unknown as { nodes?: Record<string, BaseNode> }).nodes = nodes

  const host: DomEditorHost = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  cleanups.push(() => { editor.destroy(); container.remove() })

  const cell1ParaId = (cell1 as unknown as { children: readonly string[] }).children[0]
  return { editor, doc, paraId: para.id, cell1ParaId }
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

describe('全选覆盖表格 (正文 + 表格)', () => {
  it('selectAll 锚定首段→末个 cell 段落, 选区覆盖表格内容', () => {
    const { editor, doc, paraId, cell1ParaId } = makeEditor()

    editor.selectAll()
    const sel = editor.getStore().state.runtime.selection

    expect(sel.active).toBe(true)
    expect(sel.anchor.paragraphPath).toEqual([doc.id, paraId])
    expect(sel.anchor.offset).toBe(0)
    expect(sel.focus.paragraphPath).toEqual([doc.id, cell1ParaId])
    expect(sel.focus.offset).toBe('right'.length)
  })

  it('selectAll 后字数统计 (selectedChars) 覆盖表格 cell 文本', () => {
    const { editor } = makeEditor()

    editor.selectAll()
    // "第一段文本"(5) + "hello world"(11) + "right"(5) = 21
    expect(editor.getWordCount().selectedChars).toBe(21)
  })
})
