// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 段落行缓存 (M2a)
//
// 两条判据缺一不可:
//   1. 正确性: 缓存开启与全新引擎全量布局逐字节相同
//   2. 有效性: 未改动的纯文本段落在第二次布局里确实命中
//
// 第二类用例同时锁住"哪些段落不可缓存" (列表/控件) —— 它们不命中不是缺陷,
// 是安全边界。
// ================================================================

import { describe, it, expect } from 'vitest'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { testMeasurer } from './helpers'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode, createSmartTextNode,
} from '../document/factory/ElementFormatter'
import type { BaseNode, Paragraph } from '../document/core/DocumentModel'

const P1 = '第一段：患者主诉发热三天，最高体温三十九度。'
const P2 = '第二段：查体见咽部充血，双肺呼吸音清。'
const P3 = '第三段：初步诊断为上呼吸道感染。'

function makeFixture(opts: { list?: boolean; control?: boolean } = {}) {
  const doc = createDocument('cache')
  const t1 = createTextNode(P1)
  const t2 = createTextNode(P2)
  const t3 = createTextNode(P3)
  const p1 = createParagraph([t1.id]) as Paragraph
  const p2 = createParagraph([t2.id]) as Paragraph
  const p3 = createParagraph([t3.id]) as Paragraph
  if (opts.list) p3.list = { type: 'bullet', level: 1 }

  const all = new Map<string, BaseNode>()
  for (const n of [doc, t1, t2, t3, p1, p2, p3]) all.set(n.id, n as unknown as BaseNode)

  let st: ReturnType<typeof createSmartTextNode> | null = null
  if (opts.control) {
    st = createSmartTextNode('（未填）', { code: { internal: 'CTL_X', dataElement: 'DE.1' }, name: '字段' })
    const p4 = createParagraph([st.id]) as Paragraph
    all.set(st.id, st as unknown as BaseNode)
    all.set(p4.id, p4 as unknown as BaseNode)
    doc.body.children = [p1.id, p2.id, p3.id, p4.id]
  } else {
    doc.body.children = [p1.id, p2.id, p3.id]
  }

  const pool = buildNodePool(all, { body: doc.id })
  return { doc, pool, p1, p2, p3, t1, t2, t3, st }
}

function newEngine() {
  return new LayoutEngine(new EventBus(), testMeasurer)
}

/** 键排序 + 剔除 undefined/函数的规范 JSON (与等价性骨架同口径) */
function canonical(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const src = v as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(src).sort()) {
        const item = src[key]
        if (item === undefined || typeof item === 'function') continue
        out[key] = walk(item)
      }
      return out
    }
    return v
  }
  return JSON.stringify(walk(value))
}

describe('段落行缓存 (M2a)', () => {
  it('第二次布局命中未改动段落', () => {
    const { doc, pool } = makeFixture()
    const engine = newEngine()

    engine.fullLayout(doc, pool)
    const first = engine.getParagraphCacheStats()
    expect(first.hits).toBe(0)
    expect(first.misses).toBe(3)

    engine.fullLayout(doc, pool)
    const second = engine.getParagraphCacheStats()
    expect(second.hits).toBe(3)
    expect(second.misses).toBe(3)
    expect(second.size).toBe(3) // 每段只留最新一份
  })

  it('缓存开启与全新引擎结果逐字节相同 (文本编辑后)', () => {
    const { doc, pool, t1 } = makeFixture()
    const engine = newEngine()
    engine.fullLayout(doc, pool)

    pool.updateNode(t1.id, { text: `${P1}复诊。` } as Partial<BaseNode>)
    const cached = canonical(engine.fullLayout(doc, pool))
    const reference = canonical(newEngine().fullLayout(doc, pool))
    expect(cached).toBe(reference)
  })

  it('兄弟段落改动时, 未改段落命中且结果一致', () => {
    const { doc, pool, t2 } = makeFixture()
    const engine = newEngine()
    engine.fullLayout(doc, pool)

    pool.updateNode(t2.id, { text: `${P2}（已复核）` } as Partial<BaseNode>)
    const cached = canonical(engine.fullLayout(doc, pool))
    expect(cached).toBe(canonical(newEngine().fullLayout(doc, pool)))
    // 第一、三段应命中
    expect(engine.getParagraphCacheStats().hits).toBe(2)
  })

  it('段落样式改动后结果一致', () => {
    const { doc, pool, p1 } = makeFixture()
    const engine = newEngine()
    engine.fullLayout(doc, pool)

    pool.updateNode(p1.id, { alignment: 'center' } as Partial<BaseNode>)
    expect(canonical(engine.fullLayout(doc, pool))).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('结构改动 (插入子节点) 后结果一致', () => {
    const { doc, pool, p1 } = makeFixture()
    const engine = newEngine()
    engine.fullLayout(doc, pool)

    const extra = createTextNode('补充')
    pool.addNode(extra as unknown as BaseNode)
    pool.insertChild(p1.id, extra.id, p1.children.length)
    expect(canonical(engine.fullLayout(doc, pool))).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('修订标记显隐切换后结果一致 (布局期样式不进旧缓存)', () => {
    const { doc, pool, t1 } = makeFixture()
    // 给第一段加一个待接受的插入标记 —— 必须在首次布局**之前**写入,
    // 直接改节点不会 bump 版本, 这是测试专用的夹具构造, 不是合法写路径。
    const t1Node = pool.nodes.get(t1.id) as unknown as { revision?: { type: 'insert' } }
    t1Node.revision = { type: 'insert' }

    const engine = newEngine()
    engine.fullLayout(doc, pool)
    engine.setShowRevisionMarks(false)
    const cached = canonical(engine.fullLayout(doc, pool))

    const reference = newEngine()
    reference.setShowRevisionMarks(false)
    expect(cached).toBe(canonical(reference.fullLayout(doc, pool)))
  })

  it('列表段落不缓存 (编号是跨段状态)', () => {
    const { doc, pool } = makeFixture({ list: true })
    const engine = newEngine()
    engine.fullLayout(doc, pool)
    expect(engine.getParagraphCacheStats().size).toBe(2) // 只有两个纯文本段
  })

  it('控件段落不缓存, 但值变化后结果仍正确', () => {
    const { doc, pool, st } = makeFixture({ control: true })
    const engine = newEngine()
    engine.fullLayout(doc, pool)
    expect(engine.getParagraphCacheStats().size).toBe(3) // 控件段不在内

    pool.updateNode(st!.id, { value: 42 } as Partial<BaseNode>)
    expect(canonical(engine.fullLayout(doc, pool))).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('关闭缓存时零命中, 结果与开启时一致', () => {
    const { doc, pool } = makeFixture()
    const engine = newEngine()
    engine.fullLayout(doc, pool)

    engine.setParagraphCacheEnabled(false)
    const off = canonical(engine.fullLayout(doc, pool))
    expect(engine.getParagraphCacheStats().hits).toBe(0)
    expect(off).toBe(canonical(newEngine().fullLayout(doc, pool)))

    engine.clearParagraphLineCache()
    expect(engine.getParagraphCacheStats().size).toBe(0)
  })
})
