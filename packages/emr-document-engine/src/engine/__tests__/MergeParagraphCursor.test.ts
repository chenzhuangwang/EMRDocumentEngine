// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// MergeParagraphCommand 光标落点 (契约 §8.1/§8.2)
//
// 退格并段后, 光标必须落在两段的**接缝** (上一段原文本结尾), 而不是
// 合并后整段的末尾。旧实现数的是合并后的总字符数, 于是:
//   - "abc" + "def" 退格 → 光标跑到 6 (应为 3);
//   - 空段落 + "主诉：…" 退格 → 光标跑到内容末尾 (应为 0)。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import { MergeParagraphCommand } from '../command/commands/MergeParagraphCommand'
import { createDocument, createParagraph, createTextNode, createSmartTextNode } from '../document/factory/ElementFormatter'
import { generateCommandId } from '../command/ICommand'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

interface Fixture {
  editor: Editor
  doc: DocumentTree
  first: string
  second: string
}

function makeEditor(firstText: string, secondText: string, firstHasControl = false): Fixture {
  const doc = createDocument('并段光标')
  const nodes: Record<string, BaseNode> = {}
  nodes[doc.id] = doc as unknown as BaseNode

  const mk = (text: string, control = false): string => {
    const tn = createTextNode(text)
    const children = [tn.id]
    nodes[tn.id] = tn as unknown as BaseNode
    if (control) {
      const c = createSmartTextNode('', {
        code: { internal: 'HDSD00.01.001', dataElement: 'DE01.00.001.00' },
        name: '患者姓名',
      })
      nodes[c.id] = c as unknown as BaseNode
      children.push(c.id)
    }
    const p = createParagraph(children)
    nodes[p.id] = p as unknown as BaseNode
    return p.id
  }
  const first = mk(firstText, firstHasControl)
  const second = mk(secondText)
  doc.body.children = [first, second]
  ;(doc as unknown as { nodes?: Record<string, BaseNode> }).nodes = nodes

  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  cleanups.push(() => { editor.destroy(); container.remove() })

  return { editor, doc, first, second }
}

function mergeSecond(f: Fixture): void {
  const path = [f.doc.id, f.second]
  f.editor.getStore().setCursor({ paragraphPath: path, offset: 0, visible: true })
  f.editor.execCommand(new MergeParagraphCommand(generateCommandId(), Date.now(), 'test', path))
}

describe('MergeParagraphCommand 光标接缝', () => {
  it('"abc" + "def" 退格 → 光标在接缝 3, 而不是合并末尾 6', () => {
    const f = makeEditor('abc', 'def')
    mergeSecond(f)

    const cursor = f.editor.getStore().state.runtime.cursor
    expect(cursor.paragraphPath).toEqual([f.doc.id, f.first])
    expect(cursor.offset).toBe(3)
    expect(f.doc.body.children).toEqual([f.first])
  })

  it('空段落 + "主诉：..." 退格 → 光标在 0, 不跳到内容末尾', () => {
    const f = makeEditor('', '主诉：胸痛')
    mergeSecond(f)

    const cursor = f.editor.getStore().state.runtime.cursor
    expect(cursor.paragraphPath).toEqual([f.doc.id, f.first])
    expect(cursor.offset).toBe(0)
  })

  it('接缝偏移按「非文本计 1」的口径计算', () => {
    // 上一段 = 文本 "ab" + 控件 (模型占 1 个偏移单位) → 接缝 3
    const f = makeEditor('ab', 'cd', true)
    mergeSecond(f)

    expect(f.editor.getStore().state.runtime.cursor.offset).toBe(3)
  })

  it('并段可撤销, 两段按原顺序恢复', () => {
    const f = makeEditor('abc', 'def')
    mergeSecond(f)
    f.editor.undo()

    expect(f.doc.body.children).toEqual([f.first, f.second])
    expect(f.editor.getPool().nodes.has(f.second)).toBe(true)
  })
})
