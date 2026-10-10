// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// Editor.applyDocumentProperties — 文档属性原子应用 (契约 §7.7/§7.8, RULE 11)
//
// 覆盖:
//   1. 标题+元数据同改 → 单个 undo 单元, undo 一次还原两者。
//   2. 仅改标题 / 仅改元数据 (空→删除) → 只发对应命令。
//   3. 无变化 → 不产生任何命令 (metadataEquals 守卫)。
//   4. getDocumentTitle 读取当前标题。
// ============================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost, type DomEditorHost } from '../../platform/dom'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'

const cleanups: Array<() => void> = []

function makeEditor(): { editor: Editor; doc: DocumentTree } {
  const doc = createDocument('初始标题')
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

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

describe('Editor.applyDocumentProperties (契约 §7.7/§7.8, RULE 11)', () => {
  it('标题+元数据同改 → 单个 undo 单元, undo 一次还原两者', () => {
    const { editor, doc } = makeEditor()
    editor.applyDocumentProperties('新标题', { author: '张三', keywords: ['a', 'b'] })

    expect(doc.title).toBe('新标题')
    expect(doc.metadata).toEqual({ author: '张三', keywords: ['a', 'b'] })
    expect(editor.canUndo()).toBe(true)

    editor.undo()
    expect(doc.title).toBe('初始标题')
    expect(doc.metadata).toBeUndefined()
    expect(editor.canUndo()).toBe(false)
  })

  it('仅改标题 → 不产生 metadata 命令; undo 还原标题', () => {
    const { editor, doc } = makeEditor()
    editor.applyDocumentProperties('只改标题', undefined)

    expect(doc.title).toBe('只改标题')
    expect(doc.metadata).toBeUndefined()

    editor.undo()
    expect(doc.title).toBe('初始标题')
    expect(doc.metadata).toBeUndefined()
  })

  it('仅改元数据 (清空→删除) → 只产生 metadata 命令', () => {
    const { editor, doc } = makeEditor()
    doc.metadata = { author: '旧作者' }

    editor.applyDocumentProperties('初始标题', undefined)
    expect(doc.metadata).toBeUndefined()
    expect(doc.title).toBe('初始标题')

    editor.undo()
    expect(doc.metadata).toEqual({ author: '旧作者' })
    expect(doc.title).toBe('初始标题')
  })

  it('无变化 → 不产生任何命令 (metadataEquals 守卫)', () => {
    const { editor, doc } = makeEditor()
    doc.metadata = { author: '张三' }

    expect(editor.canUndo()).toBe(false)
    editor.applyDocumentProperties('初始标题', { author: '张三' })

    expect(editor.canUndo()).toBe(false)
    expect(doc.title).toBe('初始标题')
    expect(doc.metadata).toEqual({ author: '张三' })
  })

  it('keywords 数组顺序相关 (不同顺序视为变化)', () => {
    const { editor, doc } = makeEditor()
    doc.metadata = { keywords: ['a', 'b'] }

    editor.applyDocumentProperties('初始标题', { keywords: ['b', 'a'] })
    expect(doc.metadata).toEqual({ keywords: ['b', 'a'] })

    editor.undo()
    expect(doc.metadata).toEqual({ keywords: ['a', 'b'] })
  })

  it('getDocumentTitle 读取当前标题', () => {
    const { editor } = makeEditor()
    expect(editor.getDocumentTitle()).toBe('初始标题')
  })
})
