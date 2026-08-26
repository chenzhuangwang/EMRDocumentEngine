// ============================================================
// DocumentSerializer — 序列化/反序列化往返 (页脚无法输入根因修复)
//
// 复现并防止: DocumentTree 仅存 ID 引用, 真实节点在 NodePool 中。
// 旧实现保存只 JSON.stringify(doc) 丢光节点 payload, 加载只注册 doc.id,
// 导致 InsertTextCommand.forward 找不到段落 → 页脚/正文无法输入。
//
// 修复: serializeDocument 内嵌节点扁平表, buildDocumentPool 从序列化数据
//       重建 NodePool, 使加载后的页脚/正文段落可寻址。
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildNodePool } from '../document/NodePool'
import { createDocument, createParagraph, createTextNode } from '../document/ElementFormatter'
import {
  collectDocumentNodes, serializeDocument, buildDocumentPool,
} from '../document/DocumentSerializer'
import type { BaseNode, DocumentTree } from '../document/DocumentModel'

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

describe('DocumentSerializer 序列化/反序列化', () => {
  it('serializeDocument 内嵌 footer/body 段落与文本节点 payload', () => {
    const { doc, pool, footParaId, footTextId, bodyTextId } = makeDoc()
    const parsed = JSON.parse(serializeDocument(doc, pool))

    expect(parsed.nodes).toBeDefined()
    expect(parsed.nodes[footParaId]).toBeDefined()
    expect(parsed.nodes[footTextId].text).toBe('页脚内容')
    expect(parsed.nodes[bodyTextId].text).toBe('正文内容')
  })

  it('collectDocumentNodes 覆盖 body/header/footer, 且不含 doc 本身', () => {
    const { doc, pool, bodyParaId, footParaId } = makeDoc()
    const nodes = collectDocumentNodes(doc, pool)

    expect(nodes.has(bodyParaId)).toBe(true)
    expect(nodes.has(footParaId)).toBe(true)
    expect(nodes.has(doc.id)).toBe(false)
  })

  it('buildDocumentPool 从序列化数据重建池 → 页脚段落可寻址 (输入不再丢失)', () => {
    const { doc, pool, footParaId, footTextId } = makeDoc()
    const parsed = JSON.parse(serializeDocument(doc, pool)) as
      DocumentTree & { nodes?: Record<string, BaseNode> }
    const rebuilt = buildDocumentPool(parsed)

    // 页脚段落及其文本节点都在重建后的池中 (InsertTextCommand 不再返回 null)
    expect(rebuilt.nodes.get(footParaId)).toBeDefined()
    expect(rebuilt.nodes.get(footTextId)).toBeDefined()
    expect((rebuilt.nodes.get(footTextId) as unknown as { text: string }).text).toBe('页脚内容')
    // 页脚段落仍在 doc.footer 数组
    expect(parsed.footer).toContain(footParaId)
  })

  it('buildDocumentPool 兼容无 nodes 字段的旧数据 (不抛异常)', () => {
    const { doc } = makeDoc()
    // 模拟旧格式: 移除 nodes 字段
    const legacy = JSON.parse(JSON.stringify(doc)) as DocumentTree
    const rebuilt = buildDocumentPool(legacy)
    // 至少 doc 本身注册 (旧数据无节点 payload, 由调用方兜底)
    expect(rebuilt.nodes.get(doc.id)).toBeDefined()
  })
})
