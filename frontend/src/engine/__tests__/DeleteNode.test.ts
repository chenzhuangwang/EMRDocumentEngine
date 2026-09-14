// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// Editor.deleteNode 门面测试 (设计 v2 §6 / P1-c)
//
// 验证节点删除路由 + 守卫 + 光标回落:
//   - body 段落删除 (RemoveNodesCommand), body 保留 ≥1 段落守卫
//   - 删除后光标回落到最近段落 (后一个优先, 否则前一个)
//   - body 级 image 删除
//   - 非 body 段落 (cell 内) 拒绝
//   - 未知节点拒绝
// ============================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost, type DomEditorHost } from '../../platform/dom'
import {
  createDocument, createParagraph, createTextNode, createImageNode,
  createTable, createTableRow, createTableCell,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'

/** 构造带内嵌 nodes 的文档 (Editor 构造走 loadDocumentFromObject) */
function makeDoc(): { doc: DocumentTree; ids: Record<string, string> } {
  const doc = createDocument('dn')

  const text1 = createTextNode('第一段')
  const para1 = createParagraph([text1.id])
  const img = createImageNode('img-key', 100, 100, 'top-bottom')
  const text2 = createTextNode('第二段')
  const inlineImg = createImageNode('inline-key', 80, 60, 'top-bottom')
  const para2 = createParagraph([text2.id, inlineImg.id])
  const text3 = createTextNode('第三段')
  const para3 = createParagraph([text3.id])

  // cell 内段落 (非 body)
  const cellText = createTextNode('cell')
  const cellPara = createParagraph([cellText.id])
  const cell = createTableCell([cellPara.id])
  const row = createTableRow([cell])
  const table = createTable([{ width: 100, mode: 'percentage' }], [row])

  doc.body.children = [para1.id, img.id, para2.id, para3.id, table.id]

  const nodes: Record<string, BaseNode> = {}
  for (const n of [doc, text1, para1, img, text2, inlineImg, para2, text3, para3, cellText, cellPara, cell, row, table]) {
    nodes[n.id] = n as unknown as BaseNode
  }
  ;(doc as unknown as { nodes?: Record<string, BaseNode> }).nodes = nodes

  return {
    doc,
    ids: {
      para1: para1.id, para2: para2.id, para3: para3.id,
      img: img.id, inlineImg: inlineImg.id, cellPara: cellPara.id, table: table.id,
    },
  }
}

// 每测独立 host/container, 记录以供 afterEach 清理 (避免 window/container 监听泄漏)
const cleanups: Array<() => void> = []

function makeEditor() {
  const { doc, ids } = makeDoc()
  const host: DomEditorHost = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  cleanups.push(() => { editor.destroy(); container.remove() })
  return { editor, ids }
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

function bodyChildren(editor: Editor): string[] {
  return [...editor.getPool().getChildren(editor.getPool().rootIds.body)]
}

describe('Editor.deleteNode — body 段落删除', () => {
  it('删除中间段落: 段落移除, 光标回落到后一段落开头', () => {
    const { editor, ids } = makeEditor()
    expect(editor.deleteNode(ids.para2)).toBe(true)
    expect(bodyChildren(editor)).toEqual([ids.para1, ids.img, ids.para3, ids.table])
    expect(editor.getStore().state.runtime.cursor.paragraphPath).toEqual([editor.getPool().rootIds.body, ids.para3])
    expect(editor.getStore().state.runtime.cursor.offset).toBe(0)
  })

  it('删除最后一段落: 光标回落到前一段落 (无后一段落)', () => {
    const { editor, ids } = makeEditor()
    // 先删表格让 para3 成为最后一段 (表格后无段落, 回落取前一段 para2)
    expect(editor.deleteNode(ids.table)).toBe(true)
    expect(editor.deleteNode(ids.para3)).toBe(true)
    expect(bodyChildren(editor)).toEqual([ids.para1, ids.img, ids.para2])
    expect(editor.getStore().state.runtime.cursor.paragraphPath).toEqual([editor.getPool().rootIds.body, ids.para2])
  })

  it('删除最后一个 body 段落被守卫拒绝 (body 保留 ≥1 段落)', () => {
    const { editor, ids } = makeEditor()
    // 清到只剩 para1 一个段落
    for (const id of [ids.table, ids.img, ids.para3, ids.para2]) {
      editor.deleteNode(id)
    }
    expect(bodyChildren(editor)).toEqual([ids.para1])
    // 删除最后一个段落 → 拒绝, 返回 false, body 不变
    expect(editor.deleteNode(ids.para1)).toBe(false)
    expect(bodyChildren(editor)).toEqual([ids.para1])
  })

  it('未知节点 id → 返回 false', () => {
    const { editor } = makeEditor()
    expect(editor.deleteNode('ghost')).toBe(false)
  })
})

describe('Editor.deleteNode — image / cell 路由', () => {
  it('body 级 image 删除: image 移除', () => {
    const { editor, ids } = makeEditor()
    expect(editor.deleteNode(ids.img)).toBe(true)
    expect(bodyChildren(editor)).toEqual([ids.para1, ids.para2, ids.para3, ids.table])
    expect(editor.getPool().nodes.has(ids.img)).toBe(false)
  })

  it('段落内联 image 删除: 从所属段落摘除, 光标回落原位', () => {
    const { editor, ids } = makeEditor()
    // inlineImg 在 para2 内, 位于 text2('第二段', 3 字) 之后 → 偏移 3
    expect(editor.deleteNode(ids.inlineImg)).toBe(true)
    // body 结构不变 (para2 仍在)
    expect(bodyChildren(editor)).toEqual([ids.para1, ids.img, ids.para2, ids.para3, ids.table])
    // inlineImg 已从 para2 摘除并从 pool 注销
    expect(editor.getPool().getChildren(ids.para2)).not.toContain(ids.inlineImg)
    expect(editor.getPool().nodes.has(ids.inlineImg)).toBe(false)
    // 光标回落到 para2 的 inlineImg 原偏移
    expect(editor.getStore().state.runtime.cursor.paragraphPath).toEqual([editor.getPool().rootIds.body, ids.para2])
    expect(editor.getStore().state.runtime.cursor.offset).toBe(3)
  })

  it('cell 内段落拒绝 (非 body 段落, P2 再定)', () => {
    const { editor, ids } = makeEditor()
    expect(editor.deleteNode(ids.cellPara)).toBe(false)
    expect(editor.getPool().nodes.has(ids.cellPara)).toBe(true)
  })
})

describe('Editor.deleteNode — 撤销 (RULE 8: undo 需恢复文档)', () => {
  it('删除段落后 undo 恢复段落与原 body 顺序', () => {
    const { editor, ids } = makeEditor()
    expect(editor.deleteNode(ids.para2)).toBe(true)
    expect(bodyChildren(editor)).toEqual([ids.para1, ids.img, ids.para3, ids.table])
    editor.undo()
    expect(bodyChildren(editor)).toEqual([ids.para1, ids.img, ids.para2, ids.para3, ids.table])
    expect(editor.getPool().nodes.has(ids.para2)).toBe(true)
  })

  it('删除 body 图片后 undo 恢复图片', () => {
    const { editor, ids } = makeEditor()
    expect(editor.deleteNode(ids.img)).toBe(true)
    expect(editor.getPool().nodes.has(ids.img)).toBe(false)
    editor.undo()
    expect(bodyChildren(editor)).toEqual([ids.para1, ids.img, ids.para2, ids.para3, ids.table])
    expect(editor.getPool().nodes.has(ids.img)).toBe(true)
  })

  it('删除内联图片后 undo 恢复图片回段落 children', () => {
    const { editor, ids } = makeEditor()
    expect(editor.deleteNode(ids.inlineImg)).toBe(true)
    expect(editor.getPool().nodes.has(ids.inlineImg)).toBe(false)
    editor.undo()
    expect(editor.getPool().getChildren(ids.para2)).toContain(ids.inlineImg)
    expect(editor.getPool().nodes.has(ids.inlineImg)).toBe(true)
  })
})
