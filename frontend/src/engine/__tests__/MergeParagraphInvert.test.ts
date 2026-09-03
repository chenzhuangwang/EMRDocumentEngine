// ============================================================
// MergeParagraphCommand invert + 跨段落剪切原子撤销 (RULE 11)
//
// 验证:
//   1. MergeParagraphCommand.forward/invert 往返恢复 (含同样式边界合并)
//   2. CommandManager 事务 (beginMacro/endMacro) 把「跨段落删除 + 并段」
//      打包为单个 undo 单元, 一次 undo 完整还原 (剪切的核心不变量)。
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildNodePool } from '../document/core/NodePool'
import type { NodePool } from '../document/core/NodePool'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'
import type { CommandContext } from '../command/ICommand'
import { MergeParagraphCommand } from '../command/commands/MergeParagraphCommand'
import { DeleteRangeCommand } from '../command/commands/DeleteRangeCommand'
import { CommandManager } from '../command/CommandManager'
import { EventBus } from '../interaction/EventBus'

function makeTwoParaDoc(t1: string, t2: string): { doc: DocumentTree; pool: NodePool; p1: string; p2: string } {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const tn1 = createTextNode(t1)
  const tn2 = createTextNode(t2)
  const p1 = createParagraph([tn1.id])
  const p2 = createParagraph([tn2.id])
  for (const n of [tn1, tn2, p1, p2]) allNodes.set(n.id, n as unknown as BaseNode)
  doc.body.children = [p1.id, p2.id]
  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool, p1: p1.id, p2: p2.id }
}

function paraText(pool: NodePool, paraId: string): string {
  const para = pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
  if (!para?.children) return ''
  let text = ''
  for (const cid of para.children) {
    const n = pool.nodes.get(cid) as { type?: string; text?: string } | undefined
    if (n?.type === 'text') text += n.text || ''
  }
  return text
}

function ctxOf(doc: DocumentTree, pool: NodePool): CommandContext {
  return { mode: 'local', doc, pool }
}

describe('MergeParagraphCommand invert — 往返恢复', () => {
  it('同样式边界 (normalize 合并文本节点) 也能精确还原', () => {
    const { doc, pool, p1, p2 } = makeTwoParaDoc('Hello', 'World')

    const merge = new MergeParagraphCommand('m1', Date.now(), 'user', [doc.id, p2])
    const patch = merge.forward(ctxOf(doc, pool))
    expect(patch).not.toBeNull()
    // 合并后: p2 被移除, p1 = "HelloWorld"
    expect(pool.nodes.has(p2)).toBe(false)
    expect(doc.body.children).toEqual([p1])
    expect(paraText(pool, p1)).toBe('HelloWorld')

    // invert → 恢复命令 forward → 精确还原
    const inv = merge.invert(ctxOf(doc, pool))
    expect(inv).not.toBeNull()
    const invPatch = inv!.forward(ctxOf(doc, pool))
    expect(invPatch).not.toBeNull()

    expect(pool.nodes.has(p2)).toBe(true)
    expect(doc.body.children).toEqual([p1, p2])
    expect(paraText(pool, p1)).toBe('Hello')
    expect(paraText(pool, p2)).toBe('World')
  })

  it('不同样式边界 (无合并) 也能还原', () => {
    const { doc, pool, p1, p2 } = makeTwoParaDoc('AAA', 'BBB')
    // 给 p1 文本节点加粗, 使边界样式不同
    const p1Para = pool.nodes.get(p1) as { children?: readonly string[] }
    const tn = pool.nodes.get(p1Para.children![0]) as { bold?: boolean }
    tn.bold = true

    const merge = new MergeParagraphCommand('m2', Date.now(), 'user', [doc.id, p2])
    merge.forward(ctxOf(doc, pool))
    expect(paraText(pool, p1)).toBe('AAABBB')

    const inv = merge.invert(ctxOf(doc, pool))!
    inv.forward(ctxOf(doc, pool))

    expect(doc.body.children).toEqual([p1, p2])
    expect(paraText(pool, p1)).toBe('AAA')
    expect(paraText(pool, p2)).toBe('BBB')
  })
})

describe('跨段落剪切原子撤销 (CommandManager 事务)', () => {
  it('删除+并段 → 一次 undo 完整还原', () => {
    const { doc, pool, p1, p2 } = makeTwoParaDoc('AAAA', 'BBBB')
    const bus = new EventBus()
    const manager = new CommandManager(bus, () => doc, () => pool)

    // 模拟 cut() 内的跨段落删除 (选区 p1[2]..p2[2]):
    manager.beginMacro()
    // 1. 删尾段头 (p2 0..2) → p2 = "BB"
    manager.execute(new DeleteRangeCommand('d1', Date.now(), 'user', [doc.id, p2], 0, 2))
    // 2. 删首段尾 (p1 2..4) → p1 = "AA"
    manager.execute(new DeleteRangeCommand('d2', Date.now(), 'user', [doc.id, p1], 2, 4))
    // 3. 并段 (p2 并入 p1) → p1 = "AABB"
    manager.execute(new MergeParagraphCommand('d3', Date.now(), 'user', [doc.id, p2]))
    manager.endMacro()

    expect(manager.undoStack.getUndoDepth()).toBe(1)
    expect(paraText(pool, p1)).toBe('AABB')
    expect(pool.nodes.has(p2)).toBe(false)

    // 一次 undo
    manager.undo()

    expect(manager.undoStack.getUndoDepth()).toBe(0)
    expect(pool.nodes.has(p2)).toBe(true)
    expect(doc.body.children).toEqual([p1, p2])
    expect(paraText(pool, p1)).toBe('AAAA')
    expect(paraText(pool, p2)).toBe('BBBB')
  })
})
