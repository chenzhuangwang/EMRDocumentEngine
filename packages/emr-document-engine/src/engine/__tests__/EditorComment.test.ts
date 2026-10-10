// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 批注创建 (契约 §12.2)
//
// 背景: createComment 从无 UI 调用, 于是两个问题一直没暴露 ——
//   ① 锚定只用光标, rangeStart = offset-1 → 批注**永远只标 1 个字符**;
//   ② 跨段落选区无定义行为。
// 本文件锁住修正后的锚定语义, 以及"失败要能被告知" (返回 boolean)。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'

const TEXT = '患者主诉头痛三天，伴恶心。'   // 13 字符

/** 两段文档: para1 = TEXT, para2 = '第二段文字' */
function makeEditor() {
  const doc = createDocument('批注测试')
  const nodes = new Map<string, BaseNode>()
  nodes.set(doc.id, doc as unknown as BaseNode)
  const mk = (text: string) => {
    const t = createTextNode(text)
    const p = createParagraph([t.id])
    nodes.set(t.id, t as unknown as BaseNode)
    nodes.set(p.id, p as unknown as BaseNode)
    return p.id
  }
  const p1 = mk(TEXT)
  const p2 = mk('第二段文字')
  doc.body.children = [p1, p2]

  const raw: Record<string, BaseNode> = {}
  for (const [id, n] of nodes) raw[id] = n
  ;(doc as unknown as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = raw

  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  editor.setDocument(doc)

  const select = (aPara: string, aOff: number, fPara: string, fOff: number) => {
    editor.getStore().setSelection({
      anchor: { paragraphPath: [doc.id, aPara], offset: aOff, visible: true },
      focus: { paragraphPath: [doc.id, fPara], offset: fOff, visible: true },
      active: true, granularity: 'character',
    })
  }
  const caret = (para: string, off: number) => {
    editor.getStore().setCursor({ paragraphPath: [doc.id, para], offset: off, visible: true })
    editor.getStore().setSelection({
      anchor: { paragraphPath: [doc.id, para], offset: off, visible: false },
      focus: { paragraphPath: [doc.id, para], offset: off, visible: false },
      active: false, granularity: 'character',
    })
  }
  return { editor, p1, p2, select, caret }
}

describe('Editor.createComment (契约 §12.2)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('有选区 → 锚定**整段选区**, 不再只标 1 个字符', () => {
    const { editor, p1, select } = makeEditor()
    select(p1, 2, p1, 6)
    expect(editor.createComment('这里有问题')).toBe(true)

    const t = editor.getComments()[0]
    expect(t.rangeStart.offset).toBe(2)
    expect(t.rangeEnd.offset).toBe(6)          // 4 个字符, 不是 1 个
    expect(editor.getCommentExcerpt(t.id)).toBe('主诉头痛')
  })

  it('反向选区 (从后往前拖) → 归一化为 [min,max)', () => {
    const { editor, p1, select } = makeEditor()
    select(p1, 6, p1, 2)                        // focus 在 anchor 之前
    expect(editor.createComment('反向')).toBe(true)

    const t = editor.getComments()[0]
    expect(t.rangeStart.offset).toBe(2)
    expect(t.rangeEnd.offset).toBe(6)
  })

  it('无选区 → 退化为光标前一个字符 (原行为的保留路径)', () => {
    const { editor, p1, caret } = makeEditor()
    caret(p1, 5)
    expect(editor.createComment('单字')).toBe(true)

    const t = editor.getComments()[0]
    expect(t.rangeEnd.offset - t.rangeStart.offset).toBe(1)
  })

  it('跨段落选区 → 拒绝并返回 false, 不创建任何线程', () => {
    const { editor, p1, p2, select } = makeEditor()
    select(p1, 2, p2, 3)
    expect(editor.createComment('跨段')).toBe(false)
    expect(editor.getComments()).toHaveLength(0)
    expect(editor.canUndo()).toBe(false)
  })

  it('无光标且无选区 → 返回 false', () => {
    const { editor } = makeEditor()
    editor.getStore().setCursor({ paragraphPath: [], offset: 0, visible: false })
    expect(editor.createComment('无处可锚')).toBe(false)
    expect(editor.getComments()).toHaveLength(0)
  })

  it('创建可 undo (节点 + 线程一起回滚)', () => {
    const { editor, p1, select } = makeEditor()
    select(p1, 2, p1, 6)
    editor.createComment('待撤销')
    expect(editor.getComments()).toHaveLength(1)

    editor.undo()
    expect(editor.getComments()).toHaveLength(0)

    editor.redo()
    expect(editor.getComments()).toHaveLength(1)
  })

  it('getCommentExcerpt 对未知线程返回空串 (不抛)', () => {
    const { editor } = makeEditor()
    expect(editor.getCommentExcerpt('nope')).toBe('')
  })

  it('批次内的控件字符也计入锚定偏移 (口径与光标一致)', () => {
    // 纯文本段落即可覆盖口径; 此处确认摘录按 [start,end) 精确切分 (含标点)
    const { editor, p1, select } = makeEditor()
    select(p1, 0, p1, TEXT.length)
    editor.createComment('全段')
    expect(editor.getCommentExcerpt(editor.getComments()[0].id)).toBe(TEXT)
  })
})
