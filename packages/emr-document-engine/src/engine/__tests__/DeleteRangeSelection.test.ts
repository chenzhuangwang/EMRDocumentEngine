// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// DeleteRange + Selection 端到端测试
// 验证 loOff/hiOff 同段落选区修复
// ============================================================

import { describe, it, expect } from 'vitest'
import { NodePool, buildNodePool } from '../document/core/NodePool'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import type { DocumentTree, BaseNode } from '../document/core/DocumentModel'
import { DeleteRangeCommand } from '../command/commands/DeleteRangeCommand'
import type { CommandContext } from '../command/ICommand'

function makeDoc(text: string): { doc: DocumentTree; pool: NodePool } {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const textNode = createTextNode(text)
  const para = createParagraph([textNode.id])
  allNodes.set(textNode.id, textNode as unknown as BaseNode)
  allNodes.set(para.id, para as unknown as BaseNode)
  doc.body.children = [para.id]
  return { doc, pool: buildNodePool(allNodes, { body: doc.id }) }
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

function makeCtx(pool: NodePool, doc: DocumentTree): CommandContext {
  return { mode: 'local', doc, pool }
}

describe('DeleteRangeCommand — 选区删除', () => {
  it('select all (0-5) in "Hello" → deletes all, leaves empty text node', () => {
    const { doc, pool } = makeDoc('Hello')
    const paraId = doc.body.children[0]
    const cmd = new DeleteRangeCommand('del1', Date.now(), 'test', [doc.id, paraId], 0, 5)
    const patch = cmd.forward(makeCtx(pool, doc))
    expect(patch).not.toBeNull()
    expect(patch!.cursor?.offset).toBe(0)
    expect(patch!.selection?.active).toBe(false)   // 选区已清除
    expect(getParaText(pool, paraId)).toBe('')       // 内容已删除

    // 空文本节点存在, paragraphs children 不为空
    const para = pool.nodes.get(paraId) as unknown as Record<string, unknown>
    expect(Array.isArray(para.children)).toBe(true)
    expect((para.children as readonly string[]).length).toBeGreaterThan(0)
  })

  it('select partial "ell" (1-4) in "Hello" → leaves "Ho"', () => {
    const { doc, pool } = makeDoc('Hello')
    const paraId = doc.body.children[0]
    const cmd = new DeleteRangeCommand('del2', Date.now(), 'test', [doc.id, paraId], 1, 4)
    const patch = cmd.forward(makeCtx(pool, doc))
    expect(patch).not.toBeNull()
    expect(patch!.cursor?.offset).toBe(1)
    expect(patch!.selection?.active).toBe(false)
    expect(getParaText(pool, paraId)).toBe('Ho')
  })

  it('select all in multi-textNode paragraph → deletes all', () => {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const t1 = createTextNode('Hello ')
    const t2 = createTextNode('World')
    const para = createParagraph([t1.id, t2.id])
    allNodes.set(t1.id, t1 as unknown as BaseNode)
    allNodes.set(t2.id, t2 as unknown as BaseNode)
    allNodes.set(para.id, para as unknown as BaseNode)
    doc.body.children = [para.id]
    const pool = buildNodePool(allNodes, { body: doc.id })

    const cmd = new DeleteRangeCommand('del3', Date.now(), 'test', [doc.id, para.id], 0, 11)
    const patch = cmd.forward(makeCtx(pool, doc))
    expect(patch).not.toBeNull()
    expect(patch!.cursor?.offset).toBe(0)
    expect(patch!.selection?.active).toBe(false)
    expect(getParaText(pool, para.id)).toBe('')
    expect(para.children.length).toBeGreaterThan(0)
  })

  it('select all (0-totalLen) → cursor at 0, selection inactive, para not zombie', () => {
    const { doc, pool } = makeDoc('A')
    const paraId = doc.body.children[0]
    const cmd = new DeleteRangeCommand('del4', Date.now(), 'test', [doc.id, paraId], 0, 1)
    const patch = cmd.forward(makeCtx(pool, doc))
    expect(patch).not.toBeNull()
    expect(patch!.cursor).toEqual({ paragraphPath: [doc.id, paraId], offset: 0 })
    expect(patch!.selection).toEqual({ active: false })
    // 段落必须至少有一个子节点
    const para = pool.nodes.get(paraId) as unknown as Record<string, unknown>
    expect((para.children as readonly string[]).length).toBeGreaterThan(0)
  })
})

// ---- loOff/hiOff 逻辑验证 (模拟 KeyboardHandler.deleteSelection) ----

describe('deleteSelection loOff/hiOff 同段落选区', () => {
  function computeOffsets(
    sel: { anchor: { paragraphPath: string[]; offset: number }; focus: { paragraphPath: string[]; offset: number } },
    siblings: string[],
  ): { loOff: number; hiOff: number } | null {
    const aId = sel.anchor.paragraphPath[sel.anchor.paragraphPath.length - 1]
    const fId = sel.focus.paragraphPath[sel.focus.paragraphPath.length - 1]
    const aIdx = siblings.indexOf(aId)
    const fIdx = siblings.indexOf(fId)
    if (aIdx < 0 || fIdx < 0) return null
    const lo = Math.min(aIdx, fIdx)
    const hi = Math.max(aIdx, fIdx)
    // 修复后: hiOff 用 fIdx 而非 aIdx
    const loOff = aIdx === lo ? sel.anchor.offset : sel.focus.offset
    const hiOff = fIdx === hi ? sel.focus.offset : sel.anchor.offset
    return { loOff, hiOff }
  }

  it('同段落: anchor(0) focus(5) → loOff=0 hiOff=5', () => {
    const sel = {
      anchor: { paragraphPath: ['doc', 'p1'], offset: 0 },
      focus: { paragraphPath: ['doc', 'p1'], offset: 5 },
    }
    const r = computeOffsets(sel, ['p1'])
    expect(r).toEqual({ loOff: 0, hiOff: 5 })
  })

  it('同段落: anchor(3) focus(1) (Shift+Left缩小选区) → loOff=1 hiOff=3 (min/max 归约)', () => {
    const sel = {
      anchor: { paragraphPath: ['doc', 'p1'], offset: 3 },
      focus: { paragraphPath: ['doc', 'p1'], offset: 1 },
    }
    const r = computeOffsets(sel, ['p1'])
    // loOff=3 (anchor), hiOff=1 (focus) → 后续 Math.min/max 归约
    expect(r).toEqual({ loOff: 3, hiOff: 1 })
  })

  it('跨段落 aIdx<fIdx: anchor(3) focus(2) → loOff=3 hiOff=2', () => {
    const sel = {
      anchor: { paragraphPath: ['doc', 'p1'], offset: 3 },
      focus: { paragraphPath: ['doc', 'p2'], offset: 2 },
    }
    const r = computeOffsets(sel, ['p1', 'p2'])
    expect(r).toEqual({ loOff: 3, hiOff: 2 })
  })

  it('跨段落 aIdx>fIdx: anchor(5) focus(1) → loOff=1 hiOff=5', () => {
    const sel = {
      anchor: { paragraphPath: ['doc', 'p2'], offset: 5 },
      focus: { paragraphPath: ['doc', 'p1'], offset: 1 },
    }
    const r = computeOffsets(sel, ['p1', 'p2'])
    expect(r).toEqual({ loOff: 1, hiOff: 5 })
  })
})
