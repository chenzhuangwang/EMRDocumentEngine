// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// Editor.setDictionaries — 码表注入缝 (契约 §12.6.4)
//
// 覆盖: 注入后控件转为 enum-backed (VR-9 严格成员) / setDictionaries(null)
//       退回自由文本 / **换文档不重置候选** (回归: 原 setDocument 的
//       `?? null` 会在每次换文档时抹掉已注入的 provider)。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import { createDocument, createParagraph, createSmartTextNode } from '../document/factory/ElementFormatter'
import { DictionaryStore } from '../document/control/Dictionary'
import type { BaseNode, DocumentTree, ElementMeta } from '../document/core/DocumentModel'

const DICT_ID = 'ab000000a1b2c3d4e5f60718293a4b5c'
const OTHER_DICT_ID = '22610001a1b2c3d4e5f60718293a4b5c'

/** 一个绑定码表的 S1 控件所在文档 */
function makeDoc(marker: string, dictId: string = DICT_ID): { doc: DocumentTree; nodeId: string } {
  const doc = createDocument(marker)
  const element: ElementMeta = {
    code: { internal: 'CTL_血型', dataElement: 'DE04.50.001.00' },
    name: '血型',
    format: { dataType: 'S1', dictionary: dictId },
  }
  const st = createSmartTextNode('[血型]', element)
  const para = createParagraph([st.id])
  doc.body.children = [para.id]

  const nodes: Record<string, BaseNode> = {}
  nodes[doc.id] = doc as unknown as BaseNode
  nodes[st.id] = st as unknown as BaseNode
  nodes[para.id] = para as unknown as BaseNode
  ;(doc as unknown as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = nodes
  return { doc, nodeId: st.id }
}

function storeWithBlood(): DictionaryStore {
  const s = new DictionaryStore()
  s.set(DICT_ID, [
    { name: 'A 型', value: 'A' },
    { name: 'B 型', value: 'B' },
  ])
  s.set(OTHER_DICT_ID, [{ name: '男', value: 'M' }])
  return s
}

function makeEditor(): { editor: Editor; nodeId: string; doc: DocumentTree } {
  const { doc, nodeId } = makeDoc('dict')
  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  editor.setDocument(doc)
  return { editor, nodeId, doc }
}

describe('Editor.setDictionaries (契约 §12.6.4)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('未注入 → 码表不展开, 控件是自由文本 (任意值可写)', () => {
    const { editor, nodeId } = makeEditor()
    expect(editor.setControlValue(nodeId, '随便写').ok).toBe(true)
  })

  it('注入后 → 控件转为 enum-backed, 非候选值被 VR-9 拒绝', () => {
    const { editor, nodeId } = makeEditor()
    editor.setDictionaries(storeWithBlood())

    expect(editor.setControlValue(nodeId, '随便写').ok).toBe(false)
    expect(editor.setControlValue(nodeId, '随便写')).toMatchObject({
      ok: false, reason: 'enum_value_not_allowed',
    })
    expect(editor.setControlValue(nodeId, 'A').ok).toBe(true)
    expect(editor.getControlValue(nodeId)).toBe('A')
  })

  it('候选投影经 getControlSnapshot 暴露 (供 overlay/下拉消费)', () => {
    const { editor, nodeId } = makeEditor()
    editor.setDictionaries(storeWithBlood())
    expect(editor.getControlSnapshot(nodeId)?.options?.map(o => o.name)).toEqual(['A 型', 'B 型'])
  })

  it('setDictionaries(null) → 显式清空, 退回自由文本', () => {
    const { editor, nodeId } = makeEditor()
    editor.setDictionaries(storeWithBlood())
    expect(editor.setControlValue(nodeId, '随便写').ok).toBe(false)
    editor.setDictionaries(null)
    expect(editor.setControlValue(nodeId, '随便写').ok).toBe(true)
  })

  it('换文档不重置候选 —— setDocument(doc) 不传 stores 时保留已注入 provider', () => {
    const { editor, nodeId } = makeEditor()
    editor.setDictionaries(storeWithBlood())
    expect(editor.setControlValue(nodeId, 'A').ok).toBe(true)

    // 回归 P1-1: 原实现 `this.dictionaries = stores?.dictionaries ?? null`
    // 会在这里把 provider 抹成 null, 之后换的文档就再也解析不出候选。
    const next = makeDoc('第二份')
    editor.setDocument(next.doc)

    expect(editor.setControlValue(next.nodeId, '随便写')).toMatchObject({
      ok: false, reason: 'enum_value_not_allowed',
    })
    expect(editor.setControlValue(next.nodeId, 'B').ok).toBe(true)
  })

  it('setDocument 显式传 stores.dictionaries → 按传入值替换 (不是「永不替换」)', () => {
    const { editor } = makeEditor()
    editor.setDictionaries(storeWithBlood())

    const next = makeDoc('第二份')
    const replacement = new DictionaryStore()
    replacement.set(DICT_ID, [{ name: 'O 型', value: 'O' }])
    editor.setDocument(next.doc, undefined, { dictionaries: replacement })

    // 旧候选 'A' 不再合法, 新候选 'O' 合法 → 替换确实发生
    expect(editor.setControlValue(next.nodeId, 'A')).toMatchObject({
      ok: false, reason: 'enum_value_not_allowed',
    })
    expect(editor.setControlValue(next.nodeId, 'O').ok).toBe(true)
  })
})
