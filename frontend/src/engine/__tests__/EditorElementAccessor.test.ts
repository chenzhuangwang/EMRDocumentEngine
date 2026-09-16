// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// Editor.getElement — 语义层 by-nodeId 只读访问器 (契约 §12.5)
//
// 存在的理由: UI 不应经 getPool() 裸强转读节点再取 .element。
// 与 getControlValue / getControlDefinition 同族, 非 smarttext / 缺失
// 一律 undefined (不抛)。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import { createDocument, createParagraph, createSmartTextNode } from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree, ElementMeta } from '../document/core/DocumentModel'

function makeEditor(): { editor: Editor; nodeId: string; paraId: string } {
  const doc = createDocument('getElement')
  const element: ElementMeta = {
    code: { internal: 'CTL_姓名', dataElement: 'DE02.01.039.00' },
    name: '姓名',
    format: { dataType: 'S1' },
  }
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)

  const st = createSmartTextNode('[姓名]', element)
  allNodes.set(st.id, st as unknown as BaseNode)

  const para = createParagraph([st.id])
  allNodes.set(para.id, para as unknown as BaseNode)
  doc.body.children = [para.id]

  const nodes: Record<string, BaseNode> = {}
  for (const [id, n] of allNodes) nodes[id] = n
  ;(doc as unknown as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = nodes

  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  editor.setDocument(doc, undefined)
  return { editor, nodeId: st.id, paraId: para.id }
}

describe('Editor.getElement (契约 §12.5)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('smarttext → 返回语义层 element (身份字段一致)', () => {
    const { editor, nodeId } = makeEditor()
    const el = editor.getElement(nodeId)
    expect(el).toBeDefined()
    expect(el?.name).toBe('姓名')
    expect(el?.code.dataElement).toBe('DE02.01.039.00')
    expect(el?.format?.dataType).toBe('S1')
  })

  it('读取的是活状态 (applyControlConfig 后立即可见), 非快照', () => {
    const { editor, nodeId } = makeEditor()
    const next: ElementMeta = {
      code: { internal: 'CTL_姓名', dataElement: 'DE02.01.039.00' },
      name: '患者姓名',
      format: { dataType: 'S1' },
    }
    editor.applyControlConfig(nodeId, next)
    expect(editor.getElement(nodeId)?.name).toBe('患者姓名')
  })

  it('非 smarttext 节点 (段落) → undefined, 不抛', () => {
    const { editor, paraId } = makeEditor()
    expect(editor.getElement(paraId)).toBeUndefined()
  })

  it('未知 nodeId → undefined, 不抛', () => {
    const { editor } = makeEditor()
    expect(editor.getElement('nope')).toBeUndefined()
  })
})
