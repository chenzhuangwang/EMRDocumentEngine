// ================================================================
// ControlTypeMapping — dataType↔controlType 映射 + numericValue 序列化往返
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import { createDocument, createParagraph, createSmartTextNode } from '../document/factory/ElementFormatter'
import { TemplateDefinitionStore } from '../template/TemplateDefinition'
import { loadDocumentFromObject } from '../document/io/DocumentLoader'
import { controlTypeForDataType, controlTypeForMultiple } from '../template/ControlTypeMapping'
import type { TemplateDefinition } from '../template/TemplateDefinition'
import type { BaseNode, DocumentTree, ElementMeta, SmartTextNode } from '../document/core/DocumentModel'

describe('controlTypeForDataType / controlTypeForMultiple', () => {
  it('输入域家族映射: S1→input, S2/S3→textarea, N→number, D→date', () => {
    expect(controlTypeForDataType('S1')).toBe('input')
    expect(controlTypeForDataType('S2')).toBe('textarea')
    expect(controlTypeForDataType('S3')).toBe('textarea')
    expect(controlTypeForDataType('N')).toBe('number')
    expect(controlTypeForDataType('D')).toBe('date')
  })
  it('枚举家族: multiple→checkbox, 否则→radio', () => {
    expect(controlTypeForMultiple(true)).toBe('checkbox')
    expect(controlTypeForMultiple(false)).toBe('radio')
  })
})

describe('ElementEnumOption.numericValue 序列化往返 (契约 §12.7)', () => {
  const el: ElementMeta = {
    code: { internal: 'CTL_CB', dataElement: 'DE99.99.006' }, name: '症状',
    format: {
      dataType: 'S1',
      enums: { multiple: true, data: [
        { name: '发热', value: 'fever', numericValue: 1 },
        { name: '咳嗽', value: 'cough', numericValue: 2 },
      ] },
    },
  }
  const DEF: TemplateDefinition = { controlType: 'checkbox', label: '症状：', editable: true }

  function makeEditor(): { editor: Editor; id: string } {
    const doc = createDocument('num')
    const defs = new TemplateDefinitionStore()
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const st = createSmartTextNode('[症状]', el)
    allNodes.set(st.id, st as unknown as BaseNode)
    defs.set(st.id, DEF)
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
    return { editor, id: st.id }
  }

  afterEach(() => { document.body.innerHTML = '' })

  it('serialize → load 往返: numericValue/controlType 无损', () => {
    const { editor, id } = makeEditor()
    expect(editor.setControlValue(id, ['cough', 'fever']).ok).toBe(true)

    const parsed = JSON.parse(editor.getSerializedDocument())
    const opt = (parsed.nodes[id].element as ElementMeta).format!.enums!.data as Array<{ name: string; value: string; numericValue?: number }>
    expect(opt.find((o) => o.value === 'fever')?.numericValue).toBe(1)
    expect(opt.find((o) => o.value === 'cough')?.numericValue).toBe(2)

    const loaded = loadDocumentFromObject(parsed)
    const loadedNode = loaded.pool.nodes.get(id) as SmartTextNode
    const loadedOpt = (loadedNode.element.format!.enums!.data as Array<{ name: string; value: string; numericValue?: number }>)
    expect(loadedOpt.find((o) => o.value === 'fever')?.numericValue).toBe(1)
    expect(loaded.templateDefinitions?.get(id)?.controlType).toBe('checkbox')
  })
})
