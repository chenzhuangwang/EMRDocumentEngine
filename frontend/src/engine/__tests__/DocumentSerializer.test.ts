// ============================================================
// DocumentSerializer 单元测试 (Phase 3 后只测写出)
// 反序列化测试已迁移至 __tests__/DocumentLoader.test.ts。
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildNodePool } from '../document/NodePool'
import { createDocument, createParagraph, createTextNode } from '../document/ElementFormatter'
import { collectDocumentNodes, serializeDocument } from '../document/DocumentSerializer'
import type { BaseNode, DocumentTree } from '../document/DocumentModel'
import { CURRENT_DOCUMENT_VERSION, versionToString } from '../document/DocumentFormatVersion'

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
})