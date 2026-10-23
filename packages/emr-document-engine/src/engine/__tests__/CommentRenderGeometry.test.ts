// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 批注渲染几何 (契约 §12.14)
//
// 锁住三类「明明有批注却画不出来 / 画歪」的锚点:
//   ① 空段落 —— 布局占位行的 nodeId 是段 id, 不是子节点;
//   ② 原子内联 (控件/图片/域) —— 在模型里占 1 个偏移单位, 但没有文本 run;
//   ③ 点批注 —— 产出满行高的竖条矩形 (不是铺半边字的底色)。
// 同时确认范围批注仍是正常宽度的文字底色。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import {
  createDocument, createParagraph, createTextNode, createSmartTextNode,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

interface Fixture {
  editor: Editor
  doc: DocumentTree
  emptyPara: string
  textPara: string
  controlPara: string
}

function makeEditor(): Fixture {
  const doc = createDocument('批注几何')
  const nodes: Record<string, BaseNode> = {}
  nodes[doc.id] = doc as unknown as BaseNode

  const mkPara = (children: string[] = []): string => {
    const p = createParagraph(children)
    nodes[p.id] = p as unknown as BaseNode
    return p.id
  }

  const emptyPara = mkPara()

  const t1 = createTextNode('主诉：胸痛')
  nodes[t1.id] = t1 as unknown as BaseNode
  const textPara = mkPara([t1.id])

  const label = createTextNode('姓名：')
  nodes[label.id] = label as unknown as BaseNode
  const control = createSmartTextNode('', {
    code: { internal: 'HDSD00.01.001', dataElement: 'DE01.00.001.00' },
    name: '患者姓名',
  })
  nodes[control.id] = control as unknown as BaseNode
  const controlPara = mkPara([label.id, control.id])

  doc.body.children = [emptyPara, textPara, controlPara]
  ;(doc as unknown as { nodes?: Record<string, BaseNode> }).nodes = nodes

  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  cleanups.push(() => { editor.destroy(); container.remove() })

  return { editor, doc, emptyPara, textPara, controlPara }
}

function caret(f: Fixture, paraId: string, offset: number): void {
  const path = [f.doc.id, paraId]
  f.editor.getStore().setCursor({ paragraphPath: path, offset, visible: true })
  f.editor.getStore().setSelection({
    anchor: { paragraphPath: path, offset, visible: false },
    focus: { paragraphPath: path, offset, visible: false },
    active: false,
    granularity: 'character',
  })
}

function select(f: Fixture, paraId: string, from: number, to: number): void {
  const path = [f.doc.id, paraId]
  f.editor.getStore().setCursor({ paragraphPath: path, offset: to, visible: true })
  f.editor.getStore().setSelection({
    anchor: { paragraphPath: path, offset: from, visible: true },
    focus: { paragraphPath: path, offset: to, visible: true },
    active: true,
    granularity: 'character',
  })
}

/** 最后一条线程的矩形 (按创建顺序取, 测试里一次只关心一条) */
function rectsOf(f: Fixture, threadId: string) {
  return f.editor.getCommentClientRects().get(threadId) ?? []
}

describe('批注渲染几何 (契约 §12.14)', () => {
  it('空段落里的点批注 → 有矩形 (占位行的 nodeId 就是段 id)', () => {
    const f = makeEditor()
    caret(f, f.emptyPara, 0)
    expect(f.editor.createComment('空段落')).toBe(true)
    const thread = f.editor.getComments()[0]

    const rects = rectsOf(f, thread.id)
    expect(rects.length).toBeGreaterThan(0)
    expect(rects[0].height).toBeGreaterThan(0)
    // 点批注的矩形是 2px 竖条, 不是铺半边字的 10px 色块
    expect(rects[0].width).toBeLessThanOrEqual(2)
  })

  it('文字上的点批注 → 2px 竖条, 高度覆盖整行', () => {
    const f = makeEditor()
    caret(f, f.textPara, 2)
    expect(f.editor.createComment('文字点')).toBe(true)
    const thread = f.editor.getComments()[0]

    const rects = rectsOf(f, thread.id)
    expect(rects.length).toBeGreaterThan(0)
    expect(rects[0].width).toBeLessThanOrEqual(2)
    // 行高 (ascent+descent) 而不是 0 高度
    expect(rects[0].height).toBeGreaterThan(8)
  })

  it('控件前后的点批注 → 都能拿到矩形 (原子内联不是渲染黑洞)', () => {
    const f = makeEditor()
    // '姓名：' 占 0..3, 控件占 3..4
    caret(f, f.controlPara, 3)
    expect(f.editor.createComment('控件前')).toBe(true)
    caret(f, f.controlPara, 4)
    expect(f.editor.createComment('控件后')).toBe(true)

    const [before, after] = f.editor.getComments()
    expect(rectsOf(f, before.id).length).toBeGreaterThan(0)
    expect(rectsOf(f, after.id).length).toBeGreaterThan(0)
  })

  it('范围批注仍是文字宽度的底色矩形 (不是 2px 竖条)', () => {
    const f = makeEditor()
    select(f, f.textPara, 0, 2)
    expect(f.editor.createComment('范围')).toBe(true)
    const thread = f.editor.getComments()[0]

    const rects = rectsOf(f, thread.id)
    expect(rects.length).toBeGreaterThan(0)
    expect(rects[0].width).toBeGreaterThan(10)
    expect(rects[0].height).toBeGreaterThan(8)
  })
})
