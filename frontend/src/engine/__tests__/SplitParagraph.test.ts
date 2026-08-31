// ============================================================
// SplitParagraphCommand 拆段测试
// 验证 Enter 回车拆分段落 — 包括 offset=0 边界 bug 修复
// ============================================================

import { describe, it, expect } from 'vitest'
import { NodePool, buildNodePool } from '../document/core/NodePool'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import type { DocumentTree, BaseNode } from '../document/core/DocumentModel'
import { SplitParagraphCommand } from '../command/commands/SplitParagraphCommand'
import type { CommandContext } from '../command/ICommand'

function makeDoc(text: string): { doc: DocumentTree; pool: NodePool; paraId: string } {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const textNode = createTextNode(text)
  const para = createParagraph([textNode.id])
  allNodes.set(textNode.id, textNode as unknown as BaseNode)
  allNodes.set(para.id, para as unknown as BaseNode)
  doc.body.children = [para.id]
  return { doc, pool: buildNodePool(allNodes, { body: doc.id }), paraId: para.id }
}

function getParaText(pool: NodePool, paraId: string): string {
  const para = pool.nodes.get(paraId) as unknown as Record<string, unknown> | undefined
  if (!para?.children) return ''
  let text = ''
  for (const cid of para.children as readonly string[]) {
    const n = pool.nodes.get(cid) as { type?: string; text?: string } | undefined
    if (n?.type === 'text') text += n.text || ''
  }
  return text
}

function getChildren(pool: NodePool, paraId: string): readonly string[] {
  const para = pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
  return para?.children ?? []
}

function makeCtx(pool: NodePool, doc: DocumentTree): CommandContext {
  return { mode: 'local', doc, pool }
}

describe('SplitParagraphCommand', () => {
  // ---- 核心拆分场景 ----

  it('中点拆分 "HelloWorld" offset=5 → 第1段 "Hello", 第2段 "World"', () => {
    const { doc, pool, paraId } = makeDoc('HelloWorld')
    const cmd = new SplitParagraphCommand('sp1', Date.now(), 'test', [doc.id, paraId], 5)
    const patch = cmd.forward(makeCtx(pool, doc))

    expect(patch).not.toBeNull()
    expect(patch!.cursor?.offset).toBe(0)
    // 第1段内容为 "Hello"
    expect(getParaText(pool, paraId)).toBe('Hello')
    // 第2段内容为 "World"
    const newParaId = patch!.cursor!.paragraphPath![patch!.cursor!.paragraphPath!.length - 1]
    expect(getParaText(pool, newParaId)).toBe('World')
    // 第1段 + 第2段 children 不共享 textNode
    expect(getChildren(pool, paraId)).not.toEqual(getChildren(pool, newParaId))
  })

  // ---- 边界: offset=0 (bug 修复) ----

  it('offset=0 拆分 "Hello" → 第1段为空, 第2段为 "Hello" (不变相重复)', () => {
    const { doc, pool, paraId } = makeDoc('Hello')
    const cmd = new SplitParagraphCommand('sp2', Date.now(), 'test', [doc.id, paraId], 0)
    const patch = cmd.forward(makeCtx(pool, doc))

    expect(patch).not.toBeNull()
    expect(patch!.cursor?.offset).toBe(0)
    // 第1段应为空 (修复: beforeText='' 也必须更新 TextNode)
    expect(getParaText(pool, paraId)).toBe('')
    // 第2段应有完整内容
    const newParaId = patch!.cursor!.paragraphPath![patch!.cursor!.paragraphPath!.length - 1]
    expect(getParaText(pool, newParaId)).toBe('Hello')
    // 第1段不能为空段落僵尸
    expect(getChildren(pool, paraId).length).toBeGreaterThan(0)
  })

  it('offset=0 拆分 "ABC" → 第1段空, 第2段 "ABC", 不重复', () => {
    const { doc, pool, paraId } = makeDoc('ABC')
    const cmd = new SplitParagraphCommand('sp3', Date.now(), 'test', [doc.id, paraId], 0)
    const patch = cmd.forward(makeCtx(pool, doc))

    expect(patch).not.toBeNull()
    expect(getParaText(pool, paraId)).toBe('')
    const newParaId = patch!.cursor!.paragraphPath![patch!.cursor!.paragraphPath!.length - 1]
    expect(getParaText(pool, newParaId)).toBe('ABC')
  })

  // ---- 边界: offset=textLen (末尾) ----

  it('offset=len 拆分 "Hello" at end → 第1段 "Hello", 第2段空', () => {
    const { doc, pool, paraId } = makeDoc('Hello')
    const cmd = new SplitParagraphCommand('sp4', Date.now(), 'test', [doc.id, paraId], 5)
    const patch = cmd.forward(makeCtx(pool, doc))

    expect(patch).not.toBeNull()
    expect(patch!.cursor?.offset).toBe(0)
    expect(getParaText(pool, paraId)).toBe('Hello')
    const newParaId = patch!.cursor!.paragraphPath![patch!.cursor!.paragraphPath!.length - 1]
    expect(getParaText(pool, newParaId)).toBe('')
  })

  // ---- 空段落拆分 ----

  it('空段落拆分 → 两段都为空', () => {
    const { doc, pool, paraId } = makeDoc('')
    const cmd = new SplitParagraphCommand('sp5', Date.now(), 'test', [doc.id, paraId], 0)
    const patch = cmd.forward(makeCtx(pool, doc))

    expect(patch).not.toBeNull()
    expect(patch!.cursor?.offset).toBe(0)
    // 第1段空
    expect(getParaText(pool, paraId)).toBe('')
    // 第2段也空
    const newParaId = patch!.cursor!.paragraphPath![patch!.cursor!.paragraphPath!.length - 1]
    if (getChildren(pool, newParaId).length > 0) {
      expect(getParaText(pool, newParaId)).toBe('')
    }
  })

  // ---- 多 TextNode 段落拆分 ----

  it('多 TextNode 段落: "AB"+"CD" offset=2 (在 t1 末尾) → 第1段 "AB", 第2段 "CD"', () => {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const t1 = createTextNode('AB')
    const t2 = createTextNode('CD')
    const para = createParagraph([t1.id, t2.id])
    allNodes.set(t1.id, t1 as unknown as BaseNode)
    allNodes.set(t2.id, t2 as unknown as BaseNode)
    allNodes.set(para.id, para as unknown as BaseNode)
    doc.body.children = [para.id]
    const pool = buildNodePool(allNodes, { body: doc.id })

    const cmd = new SplitParagraphCommand('sp6', Date.now(), 'test', [doc.id, para.id], 2)
    const patch = cmd.forward(makeCtx(pool, doc))

    expect(patch).not.toBeNull()
    expect(getParaText(pool, para.id)).toBe('AB')
    const newParaId = patch!.cursor!.paragraphPath![patch!.cursor!.paragraphPath!.length - 1]
    expect(getParaText(pool, newParaId)).toBe('CD')
  })

  it('多 TextNode: "AB"+"CD" offset=0 (t1 起始) → 第1段空, 第2段 "ABCD"', () => {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const t1 = createTextNode('AB')
    const t2 = createTextNode('CD')
    const para = createParagraph([t1.id, t2.id])
    allNodes.set(t1.id, t1 as unknown as BaseNode)
    allNodes.set(t2.id, t2 as unknown as BaseNode)
    allNodes.set(para.id, para as unknown as BaseNode)
    doc.body.children = [para.id]
    const pool = buildNodePool(allNodes, { body: doc.id })

    const cmd = new SplitParagraphCommand('sp7', Date.now(), 'test', [doc.id, para.id], 0)
    const patch = cmd.forward(makeCtx(pool, doc))

    expect(patch).not.toBeNull()
    // 第1段应为空 (关键 bug 修复: beforeText='' 也必须更新)
    expect(getParaText(pool, para.id)).toBe('')
    const newParaId = patch!.cursor!.paragraphPath![patch!.cursor!.paragraphPath!.length - 1]
    expect(getParaText(pool, newParaId)).toBe('ABCD')
  })

  // ---- 样式继承 ----

  it('拆分后新段落继承原段落样式 (alignment, indent)', () => {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const textNode = createTextNode('Test')
    const para = createParagraph([textNode.id])
    para.alignment = 'center'
    para.indent = 2
    allNodes.set(textNode.id, textNode as unknown as BaseNode)
    allNodes.set(para.id, para as unknown as BaseNode)
    doc.body.children = [para.id]
    const pool = buildNodePool(allNodes, { body: doc.id })

    const cmd = new SplitParagraphCommand('sp8', Date.now(), 'test', [doc.id, para.id], 2)
    const patch = cmd.forward(makeCtx(pool, doc))

    expect(patch).not.toBeNull()
    const newParaId = patch!.cursor!.paragraphPath![patch!.cursor!.paragraphPath!.length - 1]
    const newPara = pool.nodes.get(newParaId) as unknown as { alignment?: string; indent?: number }
    expect(newPara.alignment).toBe('center')
    expect(newPara.indent).toBe(2)
  })

  // ---- invert 逆操作 ----

  it('invert() 返回 MergeParagraphCommand (拆段后可合并回)', () => {
    const { doc, pool, paraId } = makeDoc('HelloWorld')
    const cmd = new SplitParagraphCommand('sp9', Date.now(), 'test', [doc.id, paraId], 5)
    cmd.forward(makeCtx(pool, doc))

    const inv = cmd.invert()
    expect(inv).not.toBeNull()
    expect(inv!.type).toBe('merge-paragraph')
  })

  // ---- cursor 位置验证 ----

  it('拆分后光标移至新段落 offset=0', () => {
    const { doc, pool, paraId } = makeDoc('Test')
    const cmd = new SplitParagraphCommand('sp10', Date.now(), 'test', [doc.id, paraId], 2)
    const patch = cmd.forward(makeCtx(pool, doc))

    expect(patch).not.toBeNull()
    const newParaId = patch!.cursor!.paragraphPath![patch!.cursor!.paragraphPath!.length - 1]
    expect(patch!.cursor).toEqual({
      paragraphPath: [doc.id, newParaId],
      offset: 0,
    })
  })
})
