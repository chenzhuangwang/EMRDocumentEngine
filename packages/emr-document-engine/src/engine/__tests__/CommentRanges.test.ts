// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// CommentRanges — 批注范围展开的唯一实现 (契约 §12.14)
//
// 同段 / 跨段 (经 W3 读序) / 跨区回退 / 摘录连接 / 光标命中。
// ================================================================

import { describe, it, expect } from 'vitest'
import { buildNodePool } from '../document/core/NodePool'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import type { BaseNode, CommentThread, DocumentTree } from '../document/core/DocumentModel'
import { commentContains, commentExcerpt, commentSegments } from '../document/comment/CommentRanges'

const TEXT = '患者主诉头痛三天，伴恶心。'
const TEXT2 = '第二段文字'

function makeDoc() {
  const doc = createDocument('comment-ranges')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)
  const mk = (text: string) => {
    const t = createTextNode(text)
    const p = createParagraph([t.id])
    all.set(t.id, t as unknown as BaseNode)
    all.set(p.id, p as unknown as BaseNode)
    return p.id
  }
  const p1 = mk(TEXT)
  const p2 = mk(TEXT2)
  const hp = mk('页眉')
  doc.body.children = [p1, p2]
  doc.header = [hp]
  const pool = buildNodePool(all, { body: doc.id, header: doc.header })
  return { doc, pool, p1, p2, hp }
}

function thread(
  doc: DocumentTree,
  startPath: string, start: number,
  endPath: string, end: number,
): CommentThread {
  return {
    id: 't1',
    rangeStart: { path: [doc.id, startPath], offset: start },
    rangeEnd: { path: [doc.id, endPath], offset: end },
    author: 'u',
    createdAt: 0,
    status: 'open',
    baseVersion: 1,
    anchorStatus: 'valid',
    comments: [],
  }
}

describe('commentSegments (契约 §12.14)', () => {
  it('同段 → 单个 [min,max) 区间', () => {
    const { doc, pool, p1 } = makeDoc()
    expect(commentSegments(doc, pool, thread(doc, p1, 6, p1, 2)))
      .toEqual([{ paraId: p1, from: 2, to: 6 }])
  })

  it('跨段 → 首段到段末 + 末段从头到终点', () => {
    const { doc, pool, p1, p2 } = makeDoc()
    expect(commentSegments(doc, pool, thread(doc, p1, 10, p2, 3)))
      .toEqual([
        { paraId: p1, from: 10, to: TEXT.length },
        { paraId: p2, from: 0, to: 3 },
      ])
  })

  it('反向跨段 → 按读序归一, 不按路径参数顺序', () => {
    const { doc, pool, p1, p2 } = makeDoc()
    expect(commentSegments(doc, pool, thread(doc, p2, 3, p1, 10)))
      .toEqual([
        { paraId: p1, from: 10, to: TEXT.length },
        { paraId: p2, from: 0, to: 3 },
      ])
  })

  it('跨区 (正文↔页眉) 历史数据 → 回退首段到段末, 不猜中间', () => {
    const { doc, pool, p1, hp } = makeDoc()
    expect(commentSegments(doc, pool, thread(doc, p1, 2, hp, 1)))
      .toEqual([{ paraId: p1, from: 2, to: TEXT.length }])
  })

  it('零长度区间 → 保留为点段 (光标处批注)', () => {
    const { doc, pool, p1 } = makeDoc()
    expect(commentSegments(doc, pool, thread(doc, p1, 4, p1, 4)))
      .toEqual([{ paraId: p1, from: 4, to: 4 }])
  })
})

describe('commentContains / commentExcerpt', () => {
  it('端点算在范围内', () => {
    const { doc, pool, p1 } = makeDoc()
    const segs = commentSegments(doc, pool, thread(doc, p1, 2, p1, 6))
    expect(commentContains(segs, p1, 1)).toBe(false)
    expect(commentContains(segs, p1, 2)).toBe(true)
    expect(commentContains(segs, p1, 6)).toBe(true)
    expect(commentContains(segs, p1, 7)).toBe(false)
  })

  it('跨段摘录用空格连接', () => {
    const { doc, pool, p1, p2 } = makeDoc()
    const segs = commentSegments(doc, pool, thread(doc, p1, 10, p2, 3))
    expect(commentExcerpt(segs, pool)).toBe('恶心。 第二段')
  })

  it('点批注只命中插入点本身, 摘录为空', () => {
    const { doc, pool, p1 } = makeDoc()
    const segs = commentSegments(doc, pool, thread(doc, p1, 5, p1, 5))
    expect(commentContains(segs, p1, 4)).toBe(false)
    expect(commentContains(segs, p1, 5)).toBe(true)
    expect(commentContains(segs, p1, 6)).toBe(false)
    expect(commentExcerpt(segs, pool)).toBe('')
  })
})
