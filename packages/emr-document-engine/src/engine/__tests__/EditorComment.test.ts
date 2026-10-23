// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 批注创建/删除/命中 (契约 §12.14)
//
// 背景:
//   ① 旧实现把 comment_marker 插到「文本节点之后」而不是锚点处, 且该节点按
//      1 个字符偏移单位计 —— 新建一条批注会把同段其它批注的区间整体挤歪;
//   ② 跨段落选区被直接拒绝;
//   ③ 作者恒为 'user';
//   ④ 只能解决, 不能重开/删除。
// 本文件锁住修正后的锚定、跨段落、作者、删除与双向命中。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'

const TEXT = '患者主诉头痛三天，伴恶心。'   // 13 字符
const TEXT2 = '第二段文字'

/** 两段正文 + 一段页眉: para1 = TEXT, para2 = TEXT2, hp = '页眉' */
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
  const p2 = mk(TEXT2)
  const hp = mk('页眉')
  doc.body.children = [p1, p2]
  doc.header = [hp]

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
  return { editor, doc, p1, p2, hp, select, caret }
}

function markersIn(editor: Editor): BaseNode[] {
  return [...editor.getPool().nodes.values()].filter(n => n.type === 'comment_marker')
}

describe('Editor.createComment (契约 §12.14)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('有选区 → 锚定整段选区', () => {
    const { editor, p1, select } = makeEditor()
    select(p1, 2, p1, 6)
    expect(editor.createComment('这里有问题')).toBe(true)

    const t = editor.getComments()[0]
    expect(t.rangeStart.offset).toBe(2)
    expect(t.rangeEnd.offset).toBe(6)
    expect(editor.getCommentExcerpt(t.id)).toBe('主诉头痛')
  })

  it('反向选区 → 归一化为 [min,max)', () => {
    const { editor, p1, select } = makeEditor()
    select(p1, 6, p1, 2)
    expect(editor.createComment('反向')).toBe(true)

    const t = editor.getComments()[0]
    expect(t.rangeStart.offset).toBe(2)
    expect(t.rangeEnd.offset).toBe(6)
  })

  it('无选区 → 光标处零长度点批注 (不需要先选文字)', () => {
    const { editor, p1, caret } = makeEditor()
    caret(p1, 5)
    expect(editor.createComment('光标处')).toBe(true)

    const t = editor.getComments()[0]
    expect(t.rangeStart.offset).toBe(5)
    expect(t.rangeEnd.offset).toBe(5)
    expect(t.rangeStart.path).toEqual(t.rangeEnd.path)
    expect(editor.getCommentExcerpt(t.id)).toBe('')
  })

  it('跨段落选区 → 创建一条跨段批注 (首/末段路径都保留)', () => {
    const { editor, doc, p1, p2, select } = makeEditor()
    select(p1, 10, p2, 3)
    expect(editor.createComment('跨段')).toBe(true)

    const t = editor.getComments()[0]
    expect(t.rangeStart.path).toEqual([doc.id, p1])
    expect(t.rangeStart.offset).toBe(10)
    expect(t.rangeEnd.path).toEqual([doc.id, p2])
    expect(t.rangeEnd.offset).toBe(3)
    // 首段 "恶心。" + 末段 "第二段"
    expect(editor.getCommentExcerpt(t.id)).toBe('恶心。 第二段')
  })

  it('跨区 (正文 ↔ 页眉) 选区 → 拒绝并返回 false, 不创建线程', () => {
    const { editor, p1, hp, select } = makeEditor()
    select(p1, 2, hp, 1)
    expect(editor.createComment('跨区')).toBe(false)
    expect(editor.getComments()).toHaveLength(0)
  })

  it('无光标且无选区 → 返回 false', () => {
    const { editor } = makeEditor()
    editor.getStore().setCursor({ paragraphPath: [], offset: 0, visible: false })
    expect(editor.createComment('无处可锚')).toBe(false)
    expect(editor.getComments()).toHaveLength(0)
  })

  it('光标在段首 (offset 0) → 仍可在光标处建点批注', () => {
    const { editor, p1, caret } = makeEditor()
    caret(p1, 0)
    expect(editor.createComment('段首')).toBe(true)
    const t = editor.getComments()[0]
    expect(t.rangeStart.offset).toBe(0)
    expect(t.rangeEnd.offset).toBe(0)
  })

  it('新建批注不再插入 comment_marker 节点 (漂移根因)', () => {
    const { editor, p1, select } = makeEditor()
    select(p1, 2, p1, 6)
    editor.createComment('无标记')
    expect(markersIn(editor)).toHaveLength(0)
  })

  it('同段再建一条靠前的批注, 不会挤歪先建批注的区间与摘录', () => {
    const { editor, p1, select } = makeEditor()
    select(p1, 2, p1, 4)
    editor.createComment('先建')
    const first = editor.getComments()[0]
    const firstId = first.id

    select(p1, 0, p1, 2)
    editor.createComment('后建')

    const after = editor.getComments().find(t => t.id === firstId)!
    expect(after.rangeStart.offset).toBe(2)
    expect(after.rangeEnd.offset).toBe(4)
    expect(editor.getCommentExcerpt(firstId)).toBe('主诉')
    expect(editor.getComments()).toHaveLength(2)
  })

  it('作者取当前用户, 回复同源; 未设置时回退 user', () => {
    const { editor, p1, select } = makeEditor()
    editor.setCurrentUser({ name: '李医生', id: 'u1' })
    select(p1, 2, p1, 6)
    editor.createComment('署名')

    const thread = editor.getComments()[0]
    expect(thread.author).toBe('李医生')
    expect(thread.comments[0].author).toBe('李医生')

    editor.addCommentReply(thread.id, '回复')
    expect(editor.getComments()[0].comments[1].author).toBe('李医生')
  })

  it('未设置当前用户 → 回退 user', () => {
    const { editor, p1, select } = makeEditor()
    select(p1, 2, p1, 6)
    editor.createComment('匿名')
    expect(editor.getComments()[0].author).toBe('user')
  })

  it('创建可 undo/redo (线程整体回滚)', () => {
    const { editor, p1, select } = makeEditor()
    select(p1, 2, p1, 6)
    editor.createComment('待撤销')
    expect(editor.getComments()).toHaveLength(1)

    editor.undo()
    expect(editor.getComments()).toHaveLength(0)

    editor.redo()
    expect(editor.getComments()).toHaveLength(1)
  })

  it('删除线程可 undo/redo', () => {
    const { editor, p1, select } = makeEditor()
    select(p1, 2, p1, 6)
    editor.createComment('待删除')
    const threadId = editor.getComments()[0].id

    expect(editor.deleteComment(threadId)).toBe(true)
    expect(editor.getComments()).toHaveLength(0)

    editor.undo()
    expect(editor.getComments()).toHaveLength(1)
    expect(editor.getComments()[0].id).toBe(threadId)

    editor.redo()
    expect(editor.getComments()).toHaveLength(0)
  })

  it('删除回复可 undo/redo, 保留原 id/时间/作者', () => {
    const { editor, p1, select } = makeEditor()
    select(p1, 2, p1, 6)
    editor.createComment('原批注')
    const threadId = editor.getComments()[0].id
    editor.addCommentReply(threadId, '回复一')

    const reply = editor.getComments()[0].comments[1]
    expect(editor.deleteCommentReply(threadId, reply.id)).toBe(true)
    expect(editor.getComments()[0].comments).toHaveLength(1)

    editor.undo()
    const restored = editor.getComments()[0].comments[1]
    expect(restored).toEqual(reply)

    editor.redo()
    expect(editor.getComments()[0].comments).toHaveLength(1)
  })
})

describe('Editor.getCommentThreadAt (契约 §12.14)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('同段命中包含端点; 范围之外为 null', () => {
    const { editor, doc, p1, select } = makeEditor()
    select(p1, 2, p1, 6)
    editor.createComment('命中')
    const threadId = editor.getComments()[0].id

    expect(editor.getCommentThreadAt([doc.id, p1], 2)).toBe(threadId)
    expect(editor.getCommentThreadAt([doc.id, p1], 4)).toBe(threadId)
    expect(editor.getCommentThreadAt([doc.id, p1], 6)).toBe(threadId)
    expect(editor.getCommentThreadAt([doc.id, p1], 7)).toBeNull()
  })

  it('跨段批注在中间段整段命中', () => {
    const { editor, doc, p1, p2, select } = makeEditor()
    select(p1, 10, p2, 3)
    editor.createComment('跨段')
    const threadId = editor.getComments()[0].id

    expect(editor.getCommentThreadAt([doc.id, p1], 11)).toBe(threadId)
    expect(editor.getCommentThreadAt([doc.id, p2], 0)).toBe(threadId)
    expect(editor.getCommentThreadAt([doc.id, p2], 3)).toBe(threadId)
    expect(editor.getCommentThreadAt([doc.id, p2], 4)).toBeNull()
  })

  it('点批注只命中自己的插入点', () => {
    const { editor, doc, p1, caret } = makeEditor()
    caret(p1, 5)
    editor.createComment('点')
    const threadId = editor.getComments()[0].id

    expect(editor.getCommentThreadAt([doc.id, p1], 4)).toBeNull()
    expect(editor.getCommentThreadAt([doc.id, p1], 5)).toBe(threadId)
    expect(editor.getCommentThreadAt([doc.id, p1], 6)).toBeNull()
  })
})
