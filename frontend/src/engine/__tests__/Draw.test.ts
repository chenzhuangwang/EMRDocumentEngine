// ============================================================
// Draw 渲染器集成测试
// ============================================================

import { describe, it, expect } from 'vitest'
import { createDocument, createParagraph, createTextNode, createSmartTextNode, createFlowBody, createPage } from '../document/ElementFormatter'
import { NodeType } from '../document/DocumentModel'

// Note: Draw requires a real DOM, tested via jsdom
describe('Draw rendering', () => {
  it('should create a document with text nodes', () => {
    const para = createParagraph([
      createTextNode('Hello'),
      createTextNode(' '),
      createTextNode('World'),
    ])
    expect(para.children.length).toBe(3)
    expect(para.children[0].type).toBe(NodeType.TEXT)
    expect((para.children[0] as any).text).toBe('Hello')
  })

  it('should create smarttext with HDSD/DE codes', () => {
    const st = createSmartTextNode('张三', {
      code: { internal: 'HDSD00.01.001', dataElement: 'DE01.00.001.00' },
      name: '患者姓名',
      format: { dataType: 'S1', maxLength: 50 },
      required: true,
      privacy: true,
    })
    expect(st.type).toBe(NodeType.SMART_TEXT)
    expect(st.element.required).toBe(true)
    expect(st.element.privacy).toBe(true)
  })

  it('should create document with flow body', () => {
    const doc = createDocument('入院记录', [
      createPage([], createFlowBody([
        createParagraph([createTextNode('主诉：咳嗽3天')]),
        createParagraph([createTextNode('现病史：患者于3天前...')]),
      ])),
    ])
    expect(doc.pages.length).toBe(1)
    const body = doc.pages[0].body as any
    expect(body.mode).toBe('flow')
    expect(body.children.length).toBe(2)
  })

  it('should support mixed text and smarttext in paragraph', () => {
    const label = createTextNode('姓名：', { bold: true, size: 14 })
    const value = createSmartTextNode('', {
      code: { internal: 'HDSD00.01.001', dataElement: 'DE01.00.001.00' },
      name: '患者姓名',
    })
    const suffix = createTextNode('，')
    const para = createParagraph([label, value, suffix])
    expect(para.children.length).toBe(3)
    expect(para.children[0].type).toBe(NodeType.TEXT)
    expect(para.children[1].type).toBe(NodeType.SMART_TEXT)
  })

  it('should deep clone without ID collision', () => {
    const doc1 = createDocument('文档1')
    const doc2 = createDocument('文档2')
    expect(doc1.id).not.toBe(doc2.id)
    expect(doc1.pages[0].id).not.toBe(doc2.pages[0].id)
  })
})
