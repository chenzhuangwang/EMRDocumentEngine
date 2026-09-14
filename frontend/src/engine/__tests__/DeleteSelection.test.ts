// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// Editor.deleteSelection 门面测试 (契约 RULE 11)
//
// 验证跨段落选区删除的原子性:
//   - deleteSelection() 将 deleteSelectedRange 发出的多条
//     DeleteRange + MergeParagraph 命令合并为单个 undo 单元
//   - 一次 undo 完整还原文档 (回归: 右键「删除」跨段落选区
//     曾需多次 Ctrl+Z 才能还原)
// ============================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost, type DomEditorHost } from '../../platform/dom'
import {
  createDocument, createParagraph, createTextNode,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'

/** 构造两段连续段落 (无图片/表格穿插) 的文档 */
function makeDoc(): { doc: DocumentTree; ids: { p1: string; p2: string } } {
  const doc = createDocument('dn')
  const t1 = createTextNode('AAAA')
  const t2 = createTextNode('BBBB')
  const p1 = createParagraph([t1.id])
  const p2 = createParagraph([t2.id])
  doc.body.children = [p1.id, p2.id]

  const nodes: Record<string, BaseNode> = {}
  for (const n of [doc, t1, t2, p1, p2]) nodes[n.id] = n as unknown as BaseNode
  ;(doc as unknown as { nodes?: Record<string, BaseNode> }).nodes = nodes

  return { doc, ids: { p1: p1.id, p2: p2.id } }
}

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

function paraText(editor: Editor, paraId: string): string {
  const para = editor.getPool().nodes.get(paraId) as { children?: readonly string[] } | undefined
  if (!para?.children) return ''
  let text = ''
  for (const cid of para.children) {
    const n = editor.getPool().nodes.get(cid) as { type?: string; text?: string } | undefined
    if (n?.type === 'text') text += n.text || ''
  }
  return text
}

describe('Editor.deleteSelection — 跨段落选区原子删除 (RULE 11)', () => {
  it('跨段落选区删除 = 单个 undo 单元, 一次 undo 完整还原', () => {
    const { editor, ids } = makeEditor()
    const docId = editor.getDocument().id

    // 选区 p1[1]..p2[2] (跨两段)
    editor.getStore().setSelection({
      anchor: { paragraphPath: [docId, ids.p1], offset: 1, visible: false },
      focus: { paragraphPath: [docId, ids.p2], offset: 2, visible: false },
      active: true,
      granularity: 'character',
    })

    expect(editor.deleteSelection()).toBe(true)

    // 删除后: p1 = "A" + p2 残留 "BB" 合并为 "ABB", p2 被移除
    expect(bodyChildren(editor)).toEqual([ids.p1])
    expect(paraText(editor, ids.p1)).toBe('ABB')
    expect(editor.getPool().nodes.has(ids.p2)).toBe(false)

    // 关键断言: 整次删除只占一个 undo 单元
    expect(editor.getStore().state.runtime.history.undoDepth).toBe(1)

    // 一次 undo 完整还原
    editor.undo()
    expect(bodyChildren(editor)).toEqual([ids.p1, ids.p2])
    expect(paraText(editor, ids.p1)).toBe('AAAA')
    expect(paraText(editor, ids.p2)).toBe('BBBB')
    expect(editor.getStore().state.runtime.history.undoDepth).toBe(0)
  })
})
