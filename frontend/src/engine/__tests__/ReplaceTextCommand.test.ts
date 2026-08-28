// ================================================================
// ReplaceTextCommand — 查找替换命令化单元测试 (v20.37)
//
// 覆盖「查找替换经 Command」改造:
//   - 单段单节点字面替换 forward / invert
//   - 同一节点多匹配 (全部替换) 的逆序应用与整体撤销
//   - 跨段落多匹配
//   - smarttext 节点偏移语义 (与 FindReplaceEngine.findAll 一致)
//   - 无操作 / collab 模式 / 空 edits
//   - FindReplaceEngine.computeReplacement 正则 $n 展开
// ================================================================

import { describe, it, expect } from 'vitest'
import { ReplaceTextCommand } from '../command/commands/ReplaceTextCommand'
import { FindReplaceEngine } from '../FindReplaceEngine'
import { buildNodePool } from '../document/core/NodePool'
import type { NodePool } from '../document/core/NodePool'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'
import type { CommandContext } from '../command/ICommand'

// ---- fixtures ----

function ctxOf(doc: DocumentTree, pool: NodePool): CommandContext {
  return { mode: 'local', doc, pool }
}

/** 单段落单文本节点: body = [para] */
function makePara(text: string): { doc: DocumentTree; pool: NodePool; paraId: string; textId: string } {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const tn = createTextNode(text)
  const para = createParagraph([tn.id])
  allNodes.set(tn.id, tn as unknown as BaseNode)
  allNodes.set(para.id, para as unknown as BaseNode)
  doc.body.children = [para.id]
  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool, paraId: para.id, textId: tn.id }
}

function textOf(pool: NodePool, textId: string): string {
  return (pool.nodes.get(textId) as { text?: string } | undefined)?.text ?? ''
}

/** 段落 = [smarttext("AB"), text(text)] — 验证 smarttext 按全文计入偏移 */
function makeParaWithSmartText(text: string): {
  doc: DocumentTree; pool: NodePool; paraId: string; textId: string
} {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const smart = { type: 'smarttext' as const, id: 'smart1', text: 'AB', font: 'SimSun', size: 16 } as unknown as BaseNode
  const tn = createTextNode(text)
  const para = createParagraph([smart.id, tn.id])
  allNodes.set(smart.id, smart)
  allNodes.set(tn.id, tn as unknown as BaseNode)
  allNodes.set(para.id, para as unknown as BaseNode)
  doc.body.children = [para.id]
  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool, paraId: para.id, textId: tn.id }
}

// ---- ReplaceTextCommand ----

describe('ReplaceTextCommand — 单段替换', () => {
  it('forward 替换 [start,end) 并返回光标 + flowbody 失效', () => {
    const { doc, pool, paraId, textId } = makePara('hello world')
    const cmd = new ReplaceTextCommand('c1', 1, 'u', [
      { paragraphPath: [doc.id, paraId], startOffset: 0, endOffset: 5, newText: 'HELLO' },
    ])
    const patch = cmd.forward(ctxOf(doc, pool))

    expect(textOf(pool, textId)).toBe('HELLO world')
    expect(patch?.cursor?.paragraphPath).toEqual([doc.id, paraId])
    expect(patch?.cursor?.offset).toBe(5)
    expect(patch?.invalidation).toBe('flowbody')
  })

  it('invert 恢复旧文本', () => {
    const { doc, pool, paraId, textId } = makePara('hello world')
    const cmd = new ReplaceTextCommand('c1', 1, 'u', [
      { paragraphPath: [doc.id, paraId], startOffset: 0, endOffset: 5, newText: 'HELLO' },
    ])
    cmd.forward(ctxOf(doc, pool))

    const inverse = cmd.invert(ctxOf(doc, pool))
    expect(inverse).not.toBeNull()
    const patch = inverse!.forward(ctxOf(doc, pool))

    expect(textOf(pool, textId)).toBe('hello world')
    expect(patch?.cursor?.offset).toBe(5)
  })

  it('偏移越界 → forward 返回 null (无操作)', () => {
    const { doc, pool, paraId } = makePara('hi')
    const cmd = new ReplaceTextCommand('c1', 1, 'u', [
      { paragraphPath: [doc.id, paraId], startOffset: 10, endOffset: 12, newText: 'X' },
    ])
    expect(cmd.forward(ctxOf(doc, pool))).toBeNull()
  })

  it('collab 模式 forward 返回 null', () => {
    const { doc, paraId } = makePara('hi')
    const cmd = new ReplaceTextCommand('c1', 1, 'u', [
      { paragraphPath: [doc.id, paraId], startOffset: 0, endOffset: 2, newText: 'X' },
    ])
    const collabCtx = { mode: 'collab' as const, ydoc: {}, origin: 'remote' }
    expect(cmd.forward(collabCtx)).toBeNull()
  })

  it('空 edits forward 返回 null', () => {
    const { doc, pool } = makePara('hi')
    const cmd = new ReplaceTextCommand('c1', 1, 'u', [])
    expect(cmd.forward(ctxOf(doc, pool))).toBeNull()
  })
})

describe('ReplaceTextCommand — 全部替换 (多 edit)', () => {
  it('同一段落多个匹配, forward 逆序应用, invert 整体恢复', () => {
    const { doc, pool, paraId, textId } = makePara('a a a')
    const cmd = new ReplaceTextCommand('c1', 1, 'u', [
      { paragraphPath: [doc.id, paraId], startOffset: 0, endOffset: 1, newText: 'X' },
      { paragraphPath: [doc.id, paraId], startOffset: 2, endOffset: 3, newText: 'X' },
      { paragraphPath: [doc.id, paraId], startOffset: 4, endOffset: 5, newText: 'X' },
    ])
    cmd.forward(ctxOf(doc, pool))
    expect(textOf(pool, textId)).toBe('X X X')

    const inverse = cmd.invert(ctxOf(doc, pool))!
    inverse.forward(ctxOf(doc, pool))
    expect(textOf(pool, textId)).toBe('a a a')
  })

  it('跨段落多匹配, 各段独立替换', () => {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)

    const t1 = createTextNode('a')
    const p1 = createParagraph([t1.id])
    const t2 = createTextNode('a')
    const p2 = createParagraph([t2.id])
    for (const n of [t1, p1, t2, p2]) allNodes.set(n.id, n as unknown as BaseNode)
    doc.body.children = [p1.id, p2.id]
    const pool = buildNodePool(allNodes, { body: doc.id })

    const cmd = new ReplaceTextCommand('c1', 1, 'u', [
      { paragraphPath: [doc.id, p1.id], startOffset: 0, endOffset: 1, newText: 'X' },
      { paragraphPath: [doc.id, p2.id], startOffset: 0, endOffset: 1, newText: 'Y' },
    ])
    cmd.forward(ctxOf(doc, pool))

    expect(textOf(pool, t1.id)).toBe('X')
    expect(textOf(pool, t2.id)).toBe('Y')
  })

  it('不同长度替换 (变长) 后 invert 仍精确恢复', () => {
    const { doc, pool, paraId, textId } = makePara('abcabc')
    const cmd = new ReplaceTextCommand('c1', 1, 'u', [
      { paragraphPath: [doc.id, paraId], startOffset: 0, endOffset: 3, newText: 'Z' },
      { paragraphPath: [doc.id, paraId], startOffset: 3, endOffset: 6, newText: 'WWW' },
    ])
    cmd.forward(ctxOf(doc, pool))
    expect(textOf(pool, textId)).toBe('ZWWW')

    cmd.invert(ctxOf(doc, pool))!.forward(ctxOf(doc, pool))
    expect(textOf(pool, textId)).toBe('abcabc')
  })
})

describe('ReplaceTextCommand — 非文本节点偏移', () => {
  it('smarttext 计入全文长度, 后续 text 偏移正确', () => {
    const { doc, pool, paraId, textId } = makeParaWithSmartText('cd')
    // smarttext "AB" 占 [0,2), text "cd" 占 [2,4); 替换 "c" → "X"
    const cmd = new ReplaceTextCommand('c1', 1, 'u', [
      { paragraphPath: [doc.id, paraId], startOffset: 2, endOffset: 3, newText: 'X' },
    ])
    cmd.forward(ctxOf(doc, pool))
    expect(textOf(pool, textId)).toBe('Xd')
  })
})

describe('FindReplaceEngine.computeReplacement', () => {
  const engine = new FindReplaceEngine()

  it('字面替换直接返回 replacement', () => {
    expect(engine.computeReplacement('a', 'a', 'X')).toBe('X')
  })

  it('正则替换展开 $n 分组引用', () => {
    expect(engine.computeReplacement('(a)(b)', 'ab', '$2$1', { useRegex: true })).toBe('ba')
  })
})
