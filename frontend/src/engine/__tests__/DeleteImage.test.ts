// ============================================================
// DeleteImage — 删除选区中的图片 (修复「能选中了但是删除有问题」)
//
// 根因: DeleteRangeCommand 只处理 type='text' 节点。内联图片 (image)
// 在段内占 1 字符, 但:
//   - 单节点命中 (start/end 均解析到同一 image) 时走 node.text.slice,
//     对无 text 字段的 image 节点抛 TypeError;
//   - 跨节点删除时, image 落入范围却被跳过 (不加入 toRemove), 图片静默遗留。
//
// 修复: DeleteRangeCommand 对非文本原子节点 (image/field/smarttext 等)
// 与文本节点一视同仁——单节点命中整体删除, 跨节点落入范围整体删除;
// 且删除范围触及非文本节点时快照整段, undo 用 RestoreDeleteRangeCommand
// 精确还原 (含图片字段与位置)。
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildNodePool } from '../document/core/NodePool'
import type { NodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode, createImageNode,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'
import type { CommandContext } from '../command/ICommand'
import { DeleteRangeCommand } from '../command/commands/DeleteRangeCommand'
import { CommandManager } from '../command/CommandManager'
import { EventBus } from '../interaction/EventBus'

function makeDoc(children: BaseNode[]): { doc: DocumentTree; pool: NodePool } {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const para = createParagraph(children.map(c => c.id))
  for (const n of children) allNodes.set(n.id, n)
  allNodes.set(para.id, para as unknown as BaseNode)
  doc.body.children = [para.id]
  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool }
}

function ctxOf(doc: DocumentTree, pool: NodePool): CommandContext {
  return { mode: 'local', doc, pool }
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

function imageChild(pool: NodePool, paraId: string): { id: string; objectKey: string; width: number; height: number; wrapMode: string } | null {
  const para = pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
  if (!para?.children) return null
  for (const cid of para.children) {
    const n = pool.nodes.get(cid) as unknown as Record<string, unknown> | undefined
    if (n?.type === 'image') {
      return { id: cid, objectKey: n.objectKey as string, width: n.width as number, height: n.height as number, wrapMode: n.wrapMode as string }
    }
  }
  return null
}

describe('DeleteRangeCommand — 删除图片选区', () => {
  it('单图片段落 [image] 删除 [0,1] → 图片移除, 段落保留空文本节点 (不僵尸)', () => {
    const img = createImageNode('img-key', 200, 120, 'top-bottom')
    const { doc, pool } = makeDoc([img])
    const paraId = doc.body.children[0]

    const cmd = new DeleteRangeCommand('del', Date.now(), 'user', [doc.id, paraId], 0, 1)
    const patch = cmd.forward(ctxOf(doc, pool))

    expect(patch).not.toBeNull()
    expect(imageChild(pool, paraId)).toBeNull()
    expect(pool.nodes.has(img.id)).toBe(false)
    // 段落至少保留一个空文本节点
    const para = pool.nodes.get(paraId) as { children?: readonly string[] }
    expect(para.children!.length).toBeGreaterThan(0)
    expect(paraText(pool, paraId)).toBe('')
  })

  it('文本 + 图片, 只删图片 [3,4] → 文本保留, 图片移除', () => {
    const tn = createTextNode('abc')
    const img = createImageNode('k1', 100, 80, 'top-bottom')
    const { doc, pool } = makeDoc([tn, img])
    const paraId = doc.body.children[0]

    const cmd = new DeleteRangeCommand('del', Date.now(), 'user', [doc.id, paraId], 3, 4)
    cmd.forward(ctxOf(doc, pool))

    expect(paraText(pool, paraId)).toBe('abc')
    expect(imageChild(pool, paraId)).toBeNull()
    expect(pool.nodes.has(img.id)).toBe(false)
  })

  it('文本 + 图片, 全选删除 [0,4] → 段落清空', () => {
    const tn = createTextNode('abc')
    const img = createImageNode('k1', 100, 80, 'top-bottom')
    const { doc, pool } = makeDoc([tn, img])
    const paraId = doc.body.children[0]

    const cmd = new DeleteRangeCommand('del', Date.now(), 'user', [doc.id, paraId], 0, 4)
    cmd.forward(ctxOf(doc, pool))

    expect(paraText(pool, paraId)).toBe('')
    expect(imageChild(pool, paraId)).toBeNull()
  })

  it('文本 + 图片 + 文本, 跨图片删除 [1,5] → 两端文本残留拼接, 图片移除', () => {
    const t1 = createTextNode('abc')
    const img = createImageNode('k1', 100, 80, 'top-bottom')
    const t2 = createTextNode('def')
    const { doc, pool } = makeDoc([t1, img, t2])
    const paraId = doc.body.children[0]

    // 偏移: a(0) b(1) c(2) img(3) d(4) e(5) f(6); 删 [1,5) = b c img d → 残留 a + ef
    const cmd = new DeleteRangeCommand('del', Date.now(), 'user', [doc.id, paraId], 1, 5)
    cmd.forward(ctxOf(doc, pool))

    expect(paraText(pool, paraId)).toBe('aef')
    expect(imageChild(pool, paraId)).toBeNull()
    expect(pool.nodes.has(img.id)).toBe(false)
  })
})

describe('DeleteRangeCommand — 图片删除 undo 精确还原', () => {
  it('单图片删除后 undo → 图片节点完整还原 (字段保留)', () => {
    const img = createImageNode('img-key', 200, 120, 'top-bottom')
    const { doc, pool } = makeDoc([img])
    const paraId = doc.body.children[0]

    const bus = new EventBus()
    const manager = new CommandManager(bus, () => doc, () => pool)
    manager.execute(new DeleteRangeCommand('del', Date.now(), 'user', [doc.id, paraId], 0, 1))
    expect(imageChild(pool, paraId)).toBeNull()

    manager.undo()

    const restored = imageChild(pool, paraId)
    expect(restored).not.toBeNull()
    expect(restored!.id).toBe(img.id)
    expect(restored!.objectKey).toBe('img-key')
    expect(restored!.width).toBe(200)
    expect(restored!.height).toBe(120)
    expect(restored!.wrapMode).toBe('top-bottom')
  })

  it('文本 + 图片 + 文本 跨图删除 undo → 整段精确还原', () => {
    const t1 = createTextNode('abc')
    const img = createImageNode('k1', 100, 80, 'top-bottom')
    const t2 = createTextNode('def')
    const { doc, pool } = makeDoc([t1, img, t2])
    const paraId = doc.body.children[0]

    const bus = new EventBus()
    const manager = new CommandManager(bus, () => doc, () => pool)
    manager.execute(new DeleteRangeCommand('del', Date.now(), 'user', [doc.id, paraId], 1, 5))
    expect(paraText(pool, paraId)).toBe('aef')
    expect(imageChild(pool, paraId)).toBeNull()

    manager.undo()

    expect(paraText(pool, paraId)).toBe('abcdef')
    const restored = imageChild(pool, paraId)
    expect(restored).not.toBeNull()
    // 图片插回原位置 (t1 "abc" 之后, t2 "def" 之前)
    const para = pool.nodes.get(paraId) as { children?: readonly string[] }
    const childIds = para.children!
    expect(childIds.indexOf(img.id)).toBe(1)
    expect(paraText(pool, paraId)).toBe('abcdef')
  })
})
