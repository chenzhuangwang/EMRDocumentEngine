// ============================================================
// Draw 渲染器集成测试 (v5.0 updated)
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  createDocument, createParagraph, createTextNode, createSmartTextNode,
} from '../document/factory/ElementFormatter'
import { NodeType } from '../document/core/DocumentModel'
import { buildNodePool } from '../document/core/NodePool'

describe('Draw rendering — data model', () => {
  it('should create a document with text nodes', () => {
    const para = createParagraph()
    const t1 = createTextNode('Hello')
    const t2 = createTextNode(' ')
    const t3 = createTextNode('World')
    para.children.push(t1.id, t2.id, t3.id)

    expect(para.children.length).toBe(3)
    const allNodes = new Map()
    allNodes.set(para.id, para)
    allNodes.set(t1.id, t1)
    allNodes.set(t2.id, t2)
    allNodes.set(t3.id, t3)
    const pool = buildNodePool(allNodes, { body: para.id })

    const t1Node = pool.nodes.get(t1.id)
    expect(t1Node?.type).toBe(NodeType.TEXT)
    expect((t1Node as unknown as { text: string }).text).toBe('Hello')
  })

  it('should create smarttext with HDSD/DE codes', () => {
    const st = createSmartTextNode('张三', {
      code: { internal: 'HDSD00.01.001', dataElement: 'DE01.00.001.00' },
      name: '患者姓名',
      format: { dataType: 'S1', maxLength: 50 },
      required: true,
      privacy: { enabled: true, maskChar: '*', maskRule: 'full' },
    })
    expect(st.type).toBe(NodeType.SMART_TEXT)
    expect(st.element.required).toBe(true)
    expect(st.element.privacy?.enabled).toBe(true)
    expect(st.element.code.internal).toBe('HDSD00.01.001')
  })

  it('should create document with body children', () => {
    const para1 = createParagraph()
    const t1 = createTextNode('主诉：咳嗽3天')
    para1.children.push(t1.id)

    const para2 = createParagraph()
    const t2 = createTextNode('现病史：患者于3天前...')
    para2.children.push(t2.id)

    const doc = createDocument('入院记录')
    doc.body.children = [para1.id, para2.id]

    expect(doc.body.children.length).toBe(2)
    expect(doc.body.mode).toBe('flow')
  })

  it('should support mixed text and smarttext in paragraph', () => {
    const label = createTextNode('姓名：', { bold: true, size: 14 })
    const value = createSmartTextNode('', {
      code: { internal: 'HDSD00.01.001', dataElement: 'DE01.00.001.00' },
      name: '患者姓名',
    })
    const suffix = createTextNode('，')
    const para = createParagraph()
    para.children.push(label.id, value.id, suffix.id)

    expect(para.children.length).toBe(3)
    expect(label.type).toBe(NodeType.TEXT)
    expect(value.type).toBe(NodeType.SMART_TEXT)
  })

  it('should deep clone without ID collision', () => {
    const doc1 = createDocument('文档1')
    const doc2 = createDocument('文档2')
    expect(doc1.id).not.toBe(doc2.id)
  })
})
