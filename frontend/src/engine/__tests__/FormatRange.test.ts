// ============================================================
// FormatTextRangeCommand — 段内局部选区格式化测试
//
// 复现并防止: 选中单行内一小段字符点击格式按钮, 整行文字被格式化
// (旧实现 collectSelectionTextNodeIds 只返回选区重叠的整段 TextNode id)。
// 验证: 边界拆分 + 仅选中片段应用格式 + invert 精确还原结构。
// ============================================================

import { describe, it, expect } from 'vitest'
import { NodePool, buildNodePool } from '../document/core/NodePool'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import type { DocumentTree, BaseNode } from '../document/core/DocumentModel'
import { FormatTextRangeCommand } from '../command/commands/FormatTextCommand'
import type { CommandContext } from '../command/ICommand'

interface Run { text: string; bold?: boolean }

function makeDoc(text: string): { doc: DocumentTree; pool: NodePool; paraId: string; textNodeId: string } {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const textNode = createTextNode(text)
  const para = createParagraph([textNode.id])
  allNodes.set(textNode.id, textNode as unknown as BaseNode)
  allNodes.set(para.id, para as unknown as BaseNode)
  doc.body.children = [para.id]
  return { doc, pool: buildNodePool(allNodes, { body: doc.id }), paraId: para.id, textNodeId: textNode.id }
}

function makeCtx(pool: NodePool, doc: DocumentTree): CommandContext {
  return { mode: 'local', doc, pool }
}

function runs(pool: NodePool, paraId: string): Run[] {
  const para = pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
  const out: Run[] = []
  for (const cid of para?.children ?? []) {
    const n = pool.nodes.get(cid) as { type?: string; text?: string; bold?: boolean } | undefined
    if (n?.type === 'text') out.push({ text: n.text || '', bold: n.bold })
  }
  return out
}

function paraText(pool: NodePool, paraId: string): string {
  return runs(pool, paraId).map(r => r.text).join('')
}

function childrenCount(pool: NodePool, paraId: string): number {
  const para = pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
  return para?.children?.length ?? 0
}

describe('FormatTextRangeCommand — 段内局部选区格式化', () => {
  it('局部选区 "ell"(1-4) in "Hello" → 只 "ell" 加粗, 拆成 3 段, 文本不变', () => {
    const { doc, pool, paraId } = makeDoc('Hello')
    const cmd = new FormatTextRangeCommand(
      'f1', Date.now(), 'test', [{ path: [doc.id, paraId], start: 1, end: 4 }], { bold: true }, 'merge',
    )
    const patch = cmd.forward(makeCtx(pool, doc))

    expect(patch).not.toBeNull()
    expect(paraText(pool, paraId)).toBe('Hello')          // 文本内容不变
    expect(runs(pool, paraId)).toEqual([
      { text: 'H', bold: undefined },
      { text: 'ell', bold: true },
      { text: 'o', bold: undefined },
    ])
  })

  it('完整选区 "Hello"(0-5) → 整段加粗, 不拆分', () => {
    const { doc, pool, paraId } = makeDoc('Hello')
    const cmd = new FormatTextRangeCommand(
      'f2', Date.now(), 'test', [{ path: [doc.id, paraId], start: 0, end: 5 }], { bold: true }, 'merge',
    )
    cmd.forward(makeCtx(pool, doc))

    expect(childrenCount(pool, paraId)).toBe(1)           // 未拆分
    expect(runs(pool, paraId)).toEqual([{ text: 'Hello', bold: true }])
  })

  it('局部选区跨两个 TextNode "B"+"C"(1-3) in "AB"+"CD" → 只 "BC" 加粗', () => {
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

    const cmd = new FormatTextRangeCommand(
      'f3', Date.now(), 'test', [{ path: [doc.id, para.id], start: 1, end: 3 }], { bold: true }, 'merge',
    )
    cmd.forward(makeCtx(pool, doc))

    expect(paraText(pool, para.id)).toBe('ABCD')
    expect(runs(pool, para.id)).toEqual([
      { text: 'A', bold: undefined },
      { text: 'B', bold: true },
      { text: 'C', bold: true },
      { text: 'D', bold: undefined },
    ])
  })

  it('invert 后精确还原: 单节点 + 原样式 (拆分合并回)', () => {
    const { doc, pool, paraId } = makeDoc('Hello')
    const cmd = new FormatTextRangeCommand(
      'f4', Date.now(), 'test', [{ path: [doc.id, paraId], start: 1, end: 4 }], { bold: true }, 'merge',
    )
    const ctx = makeCtx(pool, doc)
    cmd.forward(ctx)

    const inv = cmd.invert()
    expect(inv).not.toBeNull()
    inv!.forward(ctx)

    expect(paraText(pool, paraId)).toBe('Hello')
    expect(childrenCount(pool, paraId)).toBe(1)           // 拆分已合并
    expect(runs(pool, paraId)).toEqual([{ text: 'Hello', bold: undefined }])
  })

  it('invert 后再 forward (重做) → 重新拆分并加粗', () => {
    const { doc, pool, paraId } = makeDoc('Hello')
    const ctx = makeCtx(pool, doc)
    const cmd = new FormatTextRangeCommand(
      'f5', Date.now(), 'test', [{ path: [doc.id, paraId], start: 1, end: 4 }], { bold: true }, 'merge',
    )
    cmd.forward(ctx)
    cmd.invert()!.forward(ctx)                            // 撤销
    cmd.forward(ctx)                                      // 重做 (同命令 forward)

    expect(paraText(pool, paraId)).toBe('Hello')
    expect(runs(pool, paraId)).toEqual([
      { text: 'H', bold: undefined },
      { text: 'ell', bold: true },
      { text: 'o', bold: undefined },
    ])
  })

  it('局部清除格式 (replace 模式): 已加粗 "Hello" 只清除 "ell"', () => {
    const { doc, pool, paraId, textNodeId } = makeDoc('Hello')
    pool.updateNode(textNodeId, { bold: true } as Partial<import('../document/core/DocumentModel').TextNode>)

    const cmd = new FormatTextRangeCommand(
      'f6', Date.now(), 'test', [{ path: [doc.id, paraId], start: 1, end: 4 }], {}, 'replace',
    )
    cmd.forward(makeCtx(pool, doc))

    expect(paraText(pool, paraId)).toBe('Hello')
    expect(runs(pool, paraId)).toEqual([
      { text: 'H', bold: true },
      { text: 'ell', bold: undefined },   // 清除后 bold 为 undefined
      { text: 'o', bold: true },
    ])
  })

  it('跨段落两个区间 → 各自局部加粗, 互不影响', () => {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const t1 = createTextNode('AAA')
    const p1 = createParagraph([t1.id])
    const t2 = createTextNode('BBB')
    const p2 = createParagraph([t2.id])
    for (const n of [t1, p1, t2, p2]) allNodes.set(n.id, n as unknown as BaseNode)
    doc.body.children = [p1.id, p2.id]
    const pool = buildNodePool(allNodes, { body: doc.id })

    const cmd = new FormatTextRangeCommand(
      'f7', Date.now(), 'test',
      [
        { path: [doc.id, p1.id], start: 1, end: 2 },
        { path: [doc.id, p2.id], start: 0, end: 1 },
      ],
      { bold: true }, 'merge',
    )
    cmd.forward(makeCtx(pool, doc))

    expect(runs(pool, p1.id)).toEqual([
      { text: 'A', bold: undefined },
      { text: 'A', bold: true },
      { text: 'A', bold: undefined },
    ])
    expect(runs(pool, p2.id)).toEqual([
      { text: 'B', bold: true },
      { text: 'BB', bold: undefined },
    ])
  })
})
