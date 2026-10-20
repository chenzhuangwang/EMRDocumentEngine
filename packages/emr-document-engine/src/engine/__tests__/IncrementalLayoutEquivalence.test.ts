// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 增量排版等价性骨架 (M1)
//
// 设计文档 §4.1 的硬门是「增量结果与全量结果逐字节相同」。
// M1 阶段增量引擎还没接, 所以两侧都是全量 —— 这个文件现在证明的是:
//   1. 比较器本身可靠 (元测试: 已知不同必须判不同)
//   2. 同一份文档重复布局是确定性的 (否则 M2 的对照没有意义)
//   3. 随机编辑序列下, 每一步的布局都可重复 (为 M2 替换一侧做准备)
//
// M2 把 expectLayoutEquivalent 的第二侧换成增量引擎即可, 用例体不变。
// ================================================================

import { describe, it, expect } from 'vitest'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { testMeasurer } from './helpers'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode,
} from '../document/factory/ElementFormatter'
import type { BaseNode, Paragraph } from '../document/core/DocumentModel'

// ---- 夹具 ----

const LONG_TEXT = '患者于三日前无明显诱因出现发热，体温最高三十九度，伴畏寒、乏力，无咳嗽咳痰，无腹痛腹泻。'
const SHORT_TEXT = '查体：体温三十八度五，脉搏九十次每分。'

function makeFixture() {
  const doc = createDocument('equiv')
  const t1 = createTextNode(LONG_TEXT)
  const t2 = createTextNode(SHORT_TEXT)
  const p1 = createParagraph([t1.id]) as Paragraph
  const p2 = createParagraph([t2.id]) as Paragraph
  doc.body.children = [p1.id, p2.id]

  const all = new Map<string, BaseNode>()
  for (const n of [doc, t1, t2, p1, p2]) all.set(n.id, n as unknown as BaseNode)
  const pool = buildNodePool(all, { body: doc.id })
  return { doc, pool, p1, p2, t1, t2 }
}

// ---- 确定性序列化 ----

/**
 * 键排序 + 剔除函数/undefined 的规范 JSON。
 *
 * 直接用 JSON.stringify 也*多半*够, 但对象字面量的键顺序是实现细节;
 * 一旦 M2 的增量路径用不同顺序构造同一个对象, 逐字节比较会假失败。
 */
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

function layoutFull(doc: Parameters<LayoutEngine['fullLayout']>[0], pool: Parameters<LayoutEngine['fullLayout']>[1]) {
  return new LayoutEngine(new EventBus(), testMeasurer).fullLayout(doc, pool)
}

/**
 * 等价性断言 —— M2 的接线点。
 *
 * 现在: 全量 vs 全量 (确定性)。
 * M2: 全量 vs 增量 (硬门)。替换第二行时不要放宽比较方式。
 */
function expectLayoutEquivalent(
  doc: Parameters<LayoutEngine['fullLayout']>[0],
  pool: Parameters<LayoutEngine['fullLayout']>[1],
  label: string,
): void {
  const full = canonical(layoutFull(doc, pool))
  const other = canonical(layoutFull(doc, pool))
  expect(other, label).toBe(full)
}

// ---- 用例 ----

describe('增量排版等价性骨架 (M1)', () => {
  it('比较器元测试: 文本不同必须判不同', () => {
    const a = makeFixture()
    const b = makeFixture()
    b.pool.updateNode(b.t2.id, { text: '完全不同的内容' } as Partial<BaseNode>)

    const left = canonical(layoutFull(a.doc, a.pool))
    const right = canonical(layoutFull(b.doc, b.pool))
    expect(right).not.toBe(left)
  })

  it('同一文档重复全量布局逐字节相同', () => {
    const { doc, pool } = makeFixture()
    expectLayoutEquivalent(doc, pool, 'baseline')
  })

  it('随机编辑 40 步, 每一步的布局都可重复', () => {
    const { doc, pool, p1, p2, t1, t2 } = makeFixture()
    const paragraphs = [p1, p2]
    const texts = [t1, t2]
    const alignments = ['left', 'center', 'right', 'justify'] as const

    let seed = 20261019
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }

    for (let step = 0; step < 40; step++) {
      const action = Math.floor(rand() * 4)
      const para = paragraphs[Math.floor(rand() * paragraphs.length)]

      if (action === 0) {
        // 改文本: 采用真实编辑会产生的两类变化 (增长/截断)
        const text = texts[Math.floor(rand() * texts.length)]
        const current = (pool.nodes.get(text.id) as { text?: string } | undefined)?.text ?? ''
        const next = rand() < 0.5 ? current + '复诊。' : current.slice(0, Math.max(0, current.length - 3))
        pool.updateNode(text.id, { text: next } as Partial<BaseNode>)
      } else if (action === 1) {
        // 改段落样式
        const alignment = alignments[Math.floor(rand() * alignments.length)]
        pool.updateNode(para.id, { alignment } as Partial<BaseNode>)
      } else if (action === 2) {
        // 段内插入子节点
        const extra = createTextNode('补充')
        pool.addNode(extra as unknown as BaseNode)
        pool.insertChild(para.id, extra.id, para.children.length)
      } else {
        // 段内删除最后一个子节点 (至少保留一个, 避免空段落差异掩盖问题)
        if (para.children.length > 1) pool.removeChild(para.id, para.children.length - 1)
      }

      expectLayoutEquivalent(doc, pool, `step ${step} (action ${action})`)
    }
  })

  it('M2a 硬门: 持久引擎 (段落缓存) 与全新引擎全量结果逐字节相同 (40 步)', () => {
    // 与上一条的区别: 上面每次 new 引擎 (缓存永远为空), 这里同一个引擎连跑 40 步,
    // 未改动段落会命中缓存 —— 这正是 M2a 要证的东西。
    const { doc, pool, p1, p2, t1, t2 } = makeFixture()
    const paragraphs = [p1, p2]
    const texts = [t1, t2]
    const alignments = ['left', 'center', 'right', 'justify'] as const

    const persistent = new LayoutEngine(new EventBus(), testMeasurer)
    persistent.fullLayout(doc, pool)

    let seed = 7
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }

    for (let step = 0; step < 40; step++) {
      const action = Math.floor(rand() * 5)
      const para = paragraphs[Math.floor(rand() * paragraphs.length)]

      if (action === 0) {
        const text = texts[Math.floor(rand() * texts.length)]
        const current = (pool.nodes.get(text.id) as { text?: string } | undefined)?.text ?? ''
        const next = rand() < 0.5 ? current + '随访。' : current.slice(0, Math.max(0, current.length - 2))
        pool.updateNode(text.id, { text: next } as Partial<BaseNode>)
      } else if (action === 1) {
        const alignment = alignments[Math.floor(rand() * alignments.length)]
        pool.updateNode(para.id, { alignment } as Partial<BaseNode>)
      } else if (action === 2) {
        const extra = createTextNode('补充')
        pool.addNode(extra as unknown as BaseNode)
        pool.insertChild(para.id, extra.id, para.children.length)
      } else if (action === 3) {
        if (para.children.length > 1) pool.removeChild(para.id, para.children.length - 1)
      } else {
        // 列表开关: 编号是跨段状态, 但标记进键, 缓存必须跟着变
        const current = (para as unknown as { list?: unknown }).list
        const next = current ? undefined : { type: 'ordered', level: 1, numberStyle: 'decimal' }
        pool.updateNode(para.id, { list: next } as Partial<BaseNode>)
      }

      const withCache = canonical(persistent.fullLayout(doc, pool))
      const reference = canonical(new LayoutEngine(new EventBus(), testMeasurer).fullLayout(doc, pool))
      expect(withCache, `step ${step} (action ${action})`).toBe(reference)
    }

    // 至少要证明这条路径真的命过缓存, 否则本用例会退化成"M1 的重复"
    expect(persistent.getParagraphCacheStats().hits).toBeGreaterThan(0)
  })


  it('页眉存在时同样可重复', () => {
    const { doc, pool } = makeFixture()
    const hText = createTextNode('页眉')
    const hPara = createParagraph([hText.id]) as Paragraph
    doc.header = [hPara.id]
    pool.addNode(hText as unknown as BaseNode)
    pool.addNode(hPara as unknown as BaseNode)

    expectLayoutEquivalent(doc, pool, 'with header')
  })
})
