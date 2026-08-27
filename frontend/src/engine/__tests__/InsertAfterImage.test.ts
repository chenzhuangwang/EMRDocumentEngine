// ============================================================
// InsertAfterImage — 内联非文本节点边界插入文本
//
// 复现并防止: 图片插入段落末尾后, 继续输入会追加到图片「之前」的文本节点,
// 而非图片之后 (甚至当光标落在非文本节点后时, 旧逻辑把非文本节点当 TextNode
// 拆分而抛错)。InsertTextCommand 现按 localOffset 0=前/1=后 在非文本节点
// 边界新建 text 节点。
// ============================================================

import { describe, it, expect } from 'vitest'
import { NodePool, buildNodePool } from '../document/core/NodePool'
import { createDocument, createParagraph, createTextNode, createImageNode } from '../document/factory/ElementFormatter'
import type { DocumentTree, BaseNode } from '../document/core/DocumentModel'
import { InsertTextCommand } from '../command/commands/InsertTextCommand'
import type { CommandContext } from '../command/ICommand'

function makeCtx(pool: NodePool, doc: DocumentTree): CommandContext {
  return { mode: 'local', doc, pool }
}

function getChildren(pool: NodePool, paraId: string): string[] {
  const para = pool.nodes.get(paraId) as { children?: string[] } | undefined
  return para?.children ?? []
}

/** 拼接段落所有 text 节点的文本 */
function getParaText(pool: NodePool, paraId: string): string {
  let out = ''
  for (const cid of getChildren(pool, paraId)) {
    const n = pool.nodes.get(cid) as { type?: string; text?: string } | undefined
    if (n?.type === 'text') out += n.text || ''
  }
  return out
}

/** 段落 [textNode("abc"), image] */
function makeImagePara() {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const t1 = createTextNode('abc')
  const img = createImageNode('k1', 100, 80, 'top-bottom')
  const para = createParagraph([t1.id, img.id])
  allNodes.set(t1.id, t1 as unknown as BaseNode)
  allNodes.set(img.id, img as unknown as BaseNode)
  allNodes.set(para.id, para as unknown as BaseNode)
  doc.body.children.push(para.id)
  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool, paraId: para.id, textId: t1.id, imgId: img.id }
}

describe('InsertTextCommand 在图片边界插入', () => {
  it('图片后 (offset=4) 输入 → 新建 text 节点在图片之后', () => {
    const { doc, pool, paraId, textId, imgId } = makeImagePara()
    const cmd = new InsertTextCommand('c1', Date.now(), 'u', [doc.id, paraId], 4, 'X')
    const patch = cmd.forward(makeCtx(pool, doc))

    expect(patch).not.toBeNull()
    const children = getChildren(pool, paraId)
    expect(children).toEqual([textId, imgId, expect.any(String)])
    // 新 text 节点在图片之后
    expect(children[2]).not.toBe(imgId)
    const tail = pool.nodes.get(children[2]) as { type?: string; text?: string }
    expect(tail.type).toBe('text')
    expect(tail.text).toBe('X')
    expect(getParaText(pool, paraId)).toBe('abcX')
  })

  it('图片前 (image 为首子节点, offset=0) 输入 → 新建 text 节点在图片之前', () => {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const img = createImageNode('k2', 100, 80, 'top-bottom')
    const t1 = createTextNode('abc')
    const para = createParagraph([img.id, t1.id])
    allNodes.set(img.id, img as unknown as BaseNode)
    allNodes.set(t1.id, t1 as unknown as BaseNode)
    allNodes.set(para.id, para as unknown as BaseNode)
    doc.body.children.push(para.id)
    const pool = buildNodePool(allNodes, { body: doc.id })

    const cmd = new InsertTextCommand('c2', Date.now(), 'u', [doc.id, para.id], 0, 'X')
    cmd.forward(makeCtx(pool, doc))

    const children = getChildren(pool, para.id)
    expect(children[0]).not.toBe(img.id)
    const head = pool.nodes.get(children[0]) as { type?: string; text?: string }
    expect(head.type).toBe('text')
    expect(head.text).toBe('X')
    expect(children).toEqual([children[0], img.id, t1.id])
    expect(getParaText(pool, para.id)).toBe('Xabc')
  })

  it('图片前文本中间 (offset=1) 输入 → 仍走文本拆分/合并 (回归)', () => {
    const { doc, pool, paraId, imgId } = makeImagePara()
    const cmd = new InsertTextCommand('c3', Date.now(), 'u', [doc.id, paraId], 1, 'X')
    cmd.forward(makeCtx(pool, doc))

    // 文本仍落在图片之前, 图片位置不变 (末尾)
    expect(getParaText(pool, paraId)).toBe('aXbc')
    const children = getChildren(pool, paraId)
    expect(children[children.length - 1]).toBe(imgId)
  })

  it('图片前文本末尾 (offset=3) 输入 → 追加到图片之前文本 (原有语义)', () => {
    const { doc, pool, paraId, imgId } = makeImagePara()
    const cmd = new InsertTextCommand('c4', Date.now(), 'u', [doc.id, paraId], 3, 'X')
    cmd.forward(makeCtx(pool, doc))

    expect(getParaText(pool, paraId)).toBe('abcX')
    const children = getChildren(pool, paraId)
    expect(children[children.length - 1]).toBe(imgId)
  })
})
