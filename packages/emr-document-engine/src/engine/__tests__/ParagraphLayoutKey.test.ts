// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// IncrementalLayout.paragraphKey — 段落布局缓存键 (M1)
//
// 键的全部意义: 键不变 ⇒ 段落布局可以复用。所以用例分两类:
//   1. 影响该段落布局的改动, 键必须变
//   2. 不影响该段落布局的改动, 键必须不变 (否则缓存永不命中)
//
// 版本号只落在被更新节点自身 (NodePool.updateNode), 不会向父节点冒泡 ——
// 第 2 类用例正是这条事实的守卫。
// ================================================================

import { describe, it, expect } from 'vitest'
import { IncrementalLayout } from '../layout/incremental/IncrementalLayout'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode,
} from '../document/factory/ElementFormatter'
import type { BaseNode, Paragraph } from '../document/core/DocumentModel'

function makeFixture() {
  const doc = createDocument('key')
  const t1 = createTextNode('甲')
  const t2 = createTextNode('乙')
  const p1 = createParagraph([t1.id]) as Paragraph
  const p2 = createParagraph([t2.id]) as Paragraph
  doc.body.children = [p1.id, p2.id]

  const all = new Map<string, BaseNode>()
  for (const n of [doc, t1, t2, p1, p2]) all.set(n.id, n as unknown as BaseNode)
  const pool = buildNodePool(all, { body: doc.id })
  return { doc, pool, p1, p2, t1, t2 }
}

describe('IncrementalLayout.paragraphKey', () => {
  it('无改动时稳定', () => {
    const { pool, p1 } = makeFixture()
    expect(IncrementalLayout.paragraphKey(pool, p1.id)).toBe(IncrementalLayout.paragraphKey(pool, p1.id))
  })

  it('同段落子节点文本更新 → 键变', () => {
    const { pool, p1, t1 } = makeFixture()
    const before = IncrementalLayout.paragraphKey(pool, p1.id)
    pool.updateNode(t1.id, { text: '甲改' } as Partial<BaseNode>)
    expect(IncrementalLayout.paragraphKey(pool, p1.id)).not.toBe(before)
  })

  it('兄弟段落更新 → 本段键不变', () => {
    const { pool, p1, t2 } = makeFixture()
    const before = IncrementalLayout.paragraphKey(pool, p1.id)
    pool.updateNode(t2.id, { text: '乙改' } as Partial<BaseNode>)
    expect(IncrementalLayout.paragraphKey(pool, p1.id)).toBe(before)
  })

  it('段落样式更新 → 键变', () => {
    const { pool, p1 } = makeFixture()
    const before = IncrementalLayout.paragraphKey(pool, p1.id)
    pool.updateNode(p1.id, { alignment: 'center' } as Partial<BaseNode>)
    expect(IncrementalLayout.paragraphKey(pool, p1.id)).not.toBe(before)
  })

  it('段落内插入子节点 → 键变 (structureVersion 保守失效)', () => {
    const { pool, p1 } = makeFixture()
    const before = IncrementalLayout.paragraphKey(pool, p1.id)
    const extra = createTextNode('丙')
    pool.addNode(extra as unknown as BaseNode)
    pool.insertChild(p1.id, extra.id, 1)
    expect(IncrementalLayout.paragraphKey(pool, p1.id)).not.toBe(before)
  })

  it('段落内子节点换序 → 键变', () => {
    const { pool, p1 } = makeFixture()
    const extra = createTextNode('丙')
    pool.addNode(extra as unknown as BaseNode)
    pool.insertChild(p1.id, extra.id, 1)
    const before = IncrementalLayout.paragraphKey(pool, p1.id)
    pool.moveChild(p1.id, 0, 1)
    expect(IncrementalLayout.paragraphKey(pool, p1.id)).not.toBe(before)
  })

  it('新节点首次被更新 → 键变', () => {
    const { pool, p1 } = makeFixture()
    const extra = createTextNode('丙')
    pool.addNode(extra as unknown as BaseNode)
    pool.insertChild(p1.id, extra.id, 1)
    const before = IncrementalLayout.paragraphKey(pool, p1.id)
    pool.updateNode(extra.id, { text: '丁' } as Partial<BaseNode>)
    expect(IncrementalLayout.paragraphKey(pool, p1.id)).not.toBe(before)
  })

  it('段落不存在 / 非容器节点 → null', () => {
    const { pool, t1 } = makeFixture()
    expect(IncrementalLayout.paragraphKey(pool, 'no-such-id')).toBeNull()
    expect(IncrementalLayout.paragraphKey(pool, t1.id)).toBeNull()
  })

  it('键包含段落身份 (不同段落即使内容相同也不撞键)', () => {
    const { doc } = makeFixture()
    // 两段内容完全一致, 只有 id 不同
    const a = createTextNode('同')
    const b = createTextNode('同')
    const pa = createParagraph([a.id]) as Paragraph
    const pb = createParagraph([b.id]) as Paragraph
    doc.body.children = [pa.id, pb.id]
    const all = new Map<string, BaseNode>()
    for (const n of [doc, a, b, pa, pb]) all.set(n.id, n as unknown as BaseNode)
    const pool = buildNodePool(all, { body: doc.id })
    expect(IncrementalLayout.paragraphKey(pool, pa.id)).not.toBe(IncrementalLayout.paragraphKey(pool, pb.id))
  })
})
