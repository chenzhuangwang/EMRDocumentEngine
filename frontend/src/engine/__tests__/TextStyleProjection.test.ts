// ================================================================
// getTextStyle 投影 — 读出「实际字号」(节点未显式设时用段落 run 默认)
// ================================================================

import { describe, it, expect } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree, TextNode } from '../document/core/DocumentModel'

function makeEditor(textSize?: number): { editor: Editor; paraId: string } {
  const doc = createDocument('ts')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)
  const tn = createTextNode('甲乙')
  if (textSize) (tn as unknown as TextNode).size = textSize
  const para = createParagraph([tn.id])
  all.set(tn.id, tn as unknown as BaseNode)
  all.set(para.id, para as unknown as BaseNode)
  doc.body.children = [para.id]
  const nodes: Record<string, BaseNode> = {}
  for (const [id, n] of all) nodes[id] = n
  ;(doc as unknown as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = nodes
  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container); host.input.mount(container)
  const editor = new Editor(host, doc)
  editor.setDocument(doc)
  return { editor, paraId: para.id }
}

describe('getTextStyle 投影读实际字号', () => {
  it('文本 run 显式 size=18 → 投影 size 18', () => {
    const { editor, paraId } = makeEditor(18)
    editor.getStore().setCursor({ paragraphPath: [editor.getDocument().id, paraId], offset: 0, visible: true })
    expect(editor.getTextStyle()?.size).toBe(18)
    editor.destroy()
  })
  it('未显式设字号 → 投影 16 (实际渲染默认)', () => {
    const { editor, paraId } = makeEditor()
    editor.getStore().setCursor({ paragraphPath: [editor.getDocument().id, paraId], offset: 0, visible: true })
    expect(editor.getTextStyle()?.size).toBe(16)
    editor.destroy()
  })
})
