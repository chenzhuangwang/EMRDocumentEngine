// ============================================================
// DocumentSerializer 单元测试 (Phase 3 后只测写出)
// 反序列化测试已迁移至 __tests__/DocumentLoader.test.ts。
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildNodePool } from '../document/core/NodePool'
import { createDocument, createParagraph, createTextNode, createSmartTextNode } from '../document/factory/ElementFormatter'
import { collectDocumentNodes, serializeDocument } from '../document/io/DocumentSerializer'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'
import { CURRENT_DOCUMENT_VERSION, versionToString } from '../document/version/DocumentFormatVersion'

interface BuiltDoc {
  doc: DocumentTree
  pool: ReturnType<typeof buildNodePool>
  bodyParaId: string
  bodyTextId: string
  footParaId: string
  footTextId: string
}

function makeDoc(): BuiltDoc {
  const doc = createDocument('test')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)

  const bodyText = createTextNode('正文内容')
  const bodyPara = createParagraph([bodyText.id])
  const footText = createTextNode('页脚内容')
  const footPara = createParagraph([footText.id])

  all.set(bodyText.id, bodyText as unknown as BaseNode)
  all.set(bodyPara.id, bodyPara as unknown as BaseNode)
  all.set(footText.id, footText as unknown as BaseNode)
  all.set(footPara.id, footPara as unknown as BaseNode)

  doc.body.children = [bodyPara.id]
  doc.header = []
  doc.footer = [footPara.id]

  const pool = buildNodePool(all, { body: doc.id })
  return {
    doc, pool,
    bodyParaId: bodyPara.id, bodyTextId: bodyText.id,
    footParaId: footPara.id, footTextId: footText.id,
  }
}

describe('DocumentSerializer serializeDocument', () => {
  it('serializeDocument 内嵌 footer/body 段落与文本节点 payload', () => {
    const { doc, pool, footParaId, footTextId, bodyTextId } = makeDoc()
    const parsed = JSON.parse(serializeDocument(doc, pool))

    expect(parsed.nodes).toBeDefined()
    expect(parsed.nodes[footParaId]).toBeDefined()
    expect(parsed.nodes[footTextId].text).toBe('页脚内容')
    expect(parsed.nodes[bodyTextId].text).toBe('正文内容')
  })

  it('serializeDocument 显式声明 modelVersion = CURRENT_DOCUMENT_VERSION', () => {
    const { doc, pool } = makeDoc()
    const parsed = JSON.parse(serializeDocument(doc, pool))

    expect(parsed.modelVersion).toBe(versionToString(CURRENT_DOCUMENT_VERSION))
  })

  it('serializeDocument 保留 doc 顶层字段 (id, title, pageSetup)', () => {
    const { doc, pool } = makeDoc()
    const parsed = JSON.parse(serializeDocument(doc, pool))

    expect(parsed.id).toBe(doc.id)
    expect(parsed.title).toBe(doc.title)
    expect(parsed.pageSetup).toEqual(doc.pageSetup)
  })

  it('collectDocumentNodes 覆盖 body/header/footer, 且不含 doc 本身', () => {
    const { doc, pool, bodyParaId, footParaId } = makeDoc()
    const nodes = collectDocumentNodes(doc, pool)

    expect(nodes.has(bodyParaId)).toBe(true)
    expect(nodes.has(footParaId)).toBe(true)
    expect(nodes.has(doc.id)).toBe(false)
  })

  it('serializeDocument 透传 smarttext value (运行时值, 契约 §2.1)', () => {
    const doc = createDocument('smarttest')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)

    const element = { code: { internal: 'DE001', dataElement: 'DE001' }, name: '姓名' }
    const st = createSmartTextNode('[姓名]', element, undefined, '张三')
    const para = createParagraph([st.id])

    all.set(st.id, st as unknown as BaseNode)
    all.set(para.id, para as unknown as BaseNode)
    doc.body.children = [para.id]
    doc.header = []
    doc.footer = []

    const pool = buildNodePool(all, { body: doc.id })
    const parsed = JSON.parse(serializeDocument(doc, pool))

    expect(parsed.nodes[st.id].text).toBe('[姓名]')
    expect(parsed.nodes[st.id].value).toBe('张三')
  })
})