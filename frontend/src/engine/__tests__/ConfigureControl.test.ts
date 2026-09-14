// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ConfigureControl — Editor.applyControlConfig 编排测试 (契约 §12.7)
//
// 真实 Editor + createDomEditorHost 驱动 (不 mock Command/校验):
//   语义层整体替换 → 设计期 def 替换 → 值语义不兼容自动清空 (VR-3) →
//   宏单步 undo 一次还原 element+def+value。对齐「一层一命令 + 宏」边界。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import { createDocument, createParagraph, createSmartTextNode } from '../document/factory/ElementFormatter'
import { TemplateDefinitionStore } from '../template/TemplateDefinition'
import type { TemplateDefinition } from '../template/TemplateDefinition'
import type { BaseNode, DocumentTree, ElementMeta, ElementFormat, SmartTextNode } from '../document/core/DocumentModel'

function baseElement(name: string, dataType: ElementFormat['dataType']): ElementMeta {
  return { code: { internal: `CTL_${name}`, dataElement: 'DE99.99.001' }, name, format: { dataType } }
}

function makeEditor(
  element: ElementMeta,
  def?: TemplateDefinition,
  text?: string,
): { editor: Editor; nodeId: string } {
  const doc = createDocument('cfg')
  const defs = new TemplateDefinitionStore()
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)

  const st = createSmartTextNode(text ?? `[${element.name}]`, element)
  allNodes.set(st.id, st as unknown as BaseNode)
  if (def) defs.set(st.id, def)

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
  editor.setDocument(doc, undefined, { templateDefinitions: defs })
  return { editor, nodeId: st.id }
}

const EDITABLE: TemplateDefinition = { controlType: 'input', label: '字段：', editable: true }

function valueOf(editor: Editor, nodeId: string): unknown {
  return (editor.getPool()?.nodes.get(nodeId) as SmartTextNode | undefined)?.value
}
function elementOf(editor: Editor, nodeId: string): ElementMeta | undefined {
  return (editor.getPool()?.nodes.get(nodeId) as SmartTextNode | undefined)?.element
}

describe('Editor.applyControlConfig (契约 §12.7)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('element/def 均无实质变化 → 不产生命令', () => {
    const el = baseElement('文本', 'S1')
    const { editor, nodeId } = makeEditor(el, EDITABLE)
    expect(editor.canUndo()).toBe(false)
    // 传入语义相同的 element / def (弹框重建可能带 undefined 可选键) → 应视为无变化
    editor.applyControlConfig(nodeId, { ...el, required: undefined }, { controlType: 'input', label: '字段：', editable: true, deletable: undefined })
    expect(editor.canUndo()).toBe(false)
    expect(valueOf(editor, nodeId)).toBeUndefined()
  })

  it('dataType S1→N + 旧 string 值 → 自动清空, 且可一步 undo 还原', () => {
    const { editor, nodeId } = makeEditor(baseElement('数字', 'S1'), EDITABLE)
    expect(editor.setControlValue(nodeId, '张三').ok).toBe(true)

    editor.applyControlConfig(nodeId, baseElement('数字', 'N'), { ...EDITABLE, controlType: 'number' })
    expect((elementOf(editor, nodeId) as ElementMeta).format?.dataType).toBe('N')
    expect(valueOf(editor, nodeId)).toBeUndefined()

    // 单步 undo: element + value 一起还原
    editor.undo()
    expect((elementOf(editor, nodeId) as ElementMeta).format?.dataType).toBe('S1')
    expect(valueOf(editor, nodeId)).toBe('张三')
  })

  it('只读 (write_locked) 保留旧值不清空', () => {
    const { editor, nodeId } = makeEditor(baseElement('只读', 'S1'), EDITABLE)
    expect(editor.setControlValue(nodeId, '张三').ok).toBe(true)
    // 切成 readonly: value 复校验 → write_locked → 保留
    const ro = { ...baseElement('只读', 'S1'), readonly: true }
    editor.applyControlConfig(nodeId, ro, EDITABLE)
    expect(valueOf(editor, nodeId)).toBe('张三')
    expect((elementOf(editor, nodeId) as ElementMeta).readonly).toBe(true)
    editor.undo()
    expect(valueOf(editor, nodeId)).toBe('张三')
    expect((elementOf(editor, nodeId) as ElementMeta).readonly).toBeUndefined()
  })

  it('单选删掉当前选中候选 → 值清空', () => {
    const el: ElementMeta = {
      code: { internal: 'CTL_SEL', dataElement: 'DE99.99.004' }, name: '下拉',
      format: { dataType: 'S1', enums: { data: [{ name: '轻度', value: 'mild' }, { name: '中度', value: 'moderate' }] } },
    }
    const { editor, nodeId } = makeEditor(el, { ...EDITABLE, controlType: 'select' })
    expect(editor.setControlValue(nodeId, 'mild').ok).toBe(true)

    const next = structuredClone(el) as ElementMeta
    next.format!.enums!.data = [{ name: '中度', value: 'moderate' }]
    editor.applyControlConfig(nodeId, next, { ...EDITABLE, controlType: 'select' })
    expect(valueOf(editor, nodeId)).toBeUndefined()
    expect(editor.canRedo()).toBe(false) // 未 undo 前无 redo
    editor.undo()
    expect(valueOf(editor, nodeId)).toBe('mild')
    expect(editor.canRedo()).toBe(true)
  })

  it('name 变更 + 空值 + text=`[oldName]` → 占位符同步为 `[newName]`', () => {
    const { editor, nodeId } = makeEditor(baseElement('旧名', 'S1'), EDITABLE, '[旧名]')
    editor.applyControlConfig(nodeId, baseElement('新名', 'S1'), EDITABLE)
    const node = editor.getPool()!.nodes.get(nodeId) as SmartTextNode
    expect(node.text).toBe('[新名]')
    editor.undo()
    expect((editor.getPool()!.nodes.get(nodeId) as SmartTextNode).text).toBe('[旧名]')
  })

  it('name 变更但值已填 → 不改 text (占位符只服务空态)', () => {
    const { editor, nodeId } = makeEditor(baseElement('旧名', 'S1'), EDITABLE, '[旧名]')
    expect(editor.setControlValue(nodeId, '已填').ok).toBe(true)
    editor.applyControlConfig(nodeId, baseElement('新名', 'S1'), EDITABLE)
    const node = editor.getPool()!.nodes.get(nodeId) as SmartTextNode
    expect(node.text).toBe('[旧名]')
    expect(node.value).toBe('已填')
  })

  it('name 变更 + 自定义占位符 (非 `[oldName]`) → 不改 text', () => {
    const { editor, nodeId } = makeEditor(baseElement('旧名', 'S1'), EDITABLE, '[自定义占位]')
    editor.applyControlConfig(nodeId, baseElement('新名', 'S1'), EDITABLE)
    const node = editor.getPool()!.nodes.get(nodeId) as SmartTextNode
    expect(node.text).toBe('[自定义占位]')
  })

  it('纯 def 变更 (label) → element/value 不动', () => {
    const { editor, nodeId } = makeEditor(baseElement('字段', 'S1'), EDITABLE)
    expect(editor.setControlValue(nodeId, '张三').ok).toBe(true)
    editor.applyControlConfig(nodeId, baseElement('字段', 'S1'), { controlType: 'input', label: '新标签：', editable: true })
    expect(valueOf(editor, nodeId)).toBe('张三')
    expect((elementOf(editor, nodeId) as ElementMeta).name).toBe('字段')
    expect(editor.getControlDefinition(nodeId)?.label).toBe('新标签：')
    editor.undo()
    expect(editor.getControlDefinition(nodeId)?.label).toBe('字段：')
    expect(valueOf(editor, nodeId)).toBe('张三')
  })

  it('非 smarttext nodeId → 静默 no-op', () => {
    const { editor } = makeEditor(baseElement('字段', 'S1'), EDITABLE)
    const pool = editor.getPool()!
    let paraId: string | null = null
    for (const [id, n] of pool.nodes) {
      if ((n as { type?: string }).type === 'paragraph') { paraId = id; break }
    }
    expect(paraId).toBeTruthy()
    expect(() => editor.applyControlConfig(paraId!, baseElement('任意', 'S1'), EDITABLE)).not.toThrow()
    expect(editor.canUndo()).toBe(false)
  })
})
