// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// Editor 标题投影同步 (契约 §7.7/§7.8, P2-C)
//
// 验证 engine `doc.title` 作为唯一 canonical 时, store.documentTitle 投影
// 在所有变更路径下保持同步:
//   1. 构造时初始化为 doc.title。
//   2. setDocumentTitle (命令) → commitDocumentChange 同步。
//   3. undo 还原标题 → 同步。
//   4. setDocument (加载/模板切换) → 同步。
//   5. applyDocumentProperties 标题变化 → 同步。
// ============================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost, type DomEditorHost } from '../../platform/dom'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'

const cleanups: Array<() => void> = []

/** 构造含单个正文段的文档 + Editor (与 ApplyDocumentProperties.test.ts 同模式) */
function makeEditor(title: string): { editor: Editor; doc: DocumentTree } {
  const doc = createDocument(title)
  const text = createTextNode('正文')
  const para = createParagraph([text.id])
  doc.body.children = [para.id]
  const nodes: Record<string, BaseNode> = {}
  for (const n of [doc, para, text]) nodes[n.id] = n as unknown as BaseNode
  ;(doc as unknown as { nodes?: Record<string, BaseNode> }).nodes = nodes

  const host: DomEditorHost = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  cleanups.push(() => { editor.destroy(); container.remove() })
  return { editor, doc }
}

/** 构造第二个合法文档 (供 setDocument 加载) */
function makeSecondDoc(title: string): DocumentTree {
  const doc = createDocument(title)
  const text = createTextNode('正文2')
  const para = createParagraph([text.id])
  doc.body.children = [para.id]
  const nodes: Record<string, BaseNode> = {}
  for (const n of [doc, para, text]) nodes[n.id] = n as unknown as BaseNode
  ;(doc as unknown as { nodes?: Record<string, BaseNode> }).nodes = nodes
  return doc
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

describe('Editor 标题投影同步 (P2-C, 契约 §7.7/§7.8)', () => {
  it('构造时 store.documentTitle 初始化为 doc.title', () => {
    const { editor } = makeEditor('初始标题')
    expect(editor.getStore().state.documentTitle).toBe('初始标题')
  })

  it('setDocumentTitle (命令) 同步 store.documentTitle', () => {
    const { editor } = makeEditor('初始标题')
    editor.setDocumentTitle('新标题')
    expect(editor.getStore().state.documentTitle).toBe('新标题')
    expect(editor.getDocumentTitle()).toBe('新标题')
  })

  it('undo 还原 store.documentTitle 与 doc.title', () => {
    const { editor } = makeEditor('初始标题')
    editor.setDocumentTitle('新标题')
    expect(editor.getStore().state.documentTitle).toBe('新标题')

    editor.undo()
    expect(editor.getStore().state.documentTitle).toBe('初始标题')
    expect(editor.getDocumentTitle()).toBe('初始标题')
  })

  it('setDocument (加载/模板切换) 同步 store.documentTitle', () => {
    const { editor } = makeEditor('初始标题')
    const doc2 = makeSecondDoc('第二文档')

    editor.setDocument(doc2)
    expect(editor.getStore().state.documentTitle).toBe('第二文档')
    expect(editor.getDocumentTitle()).toBe('第二文档')
  })

  it('applyDocumentProperties 标题变化同步 store.documentTitle', () => {
    const { editor } = makeEditor('初始标题')
    editor.applyDocumentProperties('对话框标题', undefined)
    expect(editor.getStore().state.documentTitle).toBe('对话框标题')
  })
})
