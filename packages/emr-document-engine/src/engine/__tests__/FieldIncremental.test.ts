// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 含域文档的增量布局 (M2h, 契约 §16.1)
//
// 域的几何来自 representativeFieldText 的**样本串**: 页码/总页数取
// '8'.repeat(位数), 日期/时间取当前 locale 的样本, 文档标题取 doc.title。
// 这些输入都不在节点版本上 —— 所以含域段落的键必须追加
// `#f<页数位数>#l<locale>#t<标题>`。交叉引用仍排除: 它的显示文本依赖
// 上一轮页映射, 属于"本趟分页结果"这类自指输入。
// ================================================================

import { describe, it, expect } from 'vitest'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { testMeasurer } from './helpers'
import { buildNodePool } from '../document/core/NodePool'
import { fieldReserveDigits } from '../document/factory/FieldFormatter'
import {
  createDocument, createParagraph, createTextNode, createFieldNode,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree, Paragraph } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'

const SENTENCE = '患者三日前出现发热，伴畏寒乏力，无咳嗽咳痰，无腹痛腹泻，饮食睡眠尚可。'

/** 每 30 段最后一段带「第 [页码域] 页」 */
function makeFieldDoc(n = 120, every = 30) {
  const doc = createDocument('field-paging')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)
  const texts: string[] = []
  const fieldIds: string[] = []

  for (let i = 0; i < n; i++) {
    const t = createTextNode(`第${i + 1}段：${SENTENCE}`)
    all.set(t.id, t as unknown as BaseNode)
    const children = [t.id]
    if (i % every === every - 1) {
      const pre = createTextNode('（第')
      const f = createFieldNode('page_number')
      const post = createTextNode('页）')
      for (const x of [pre, f, post]) all.set(x.id, x as unknown as BaseNode)
      children.push(pre.id, f.id, post.id)
      fieldIds.push(f.id)
    }
    const p = createParagraph(children) as Paragraph
    all.set(p.id, p as unknown as BaseNode)
    doc.body.children.push(p.id)
    texts.push(t.id)
  }

  return { doc, pool: buildNodePool(all, { body: doc.id }), texts, fieldIds }
}

function newEngine(): LayoutEngine {
  return new LayoutEngine(new EventBus(), testMeasurer)
}

function freshPages(doc: DocumentTree, pool: NodePool) {
  return newEngine().fullLayout(doc, pool)
}

function canonical(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(obj).sort()) out[key] = walk(obj[key])
      return out
    }
    return v
  }
  return JSON.stringify(walk(value))
}

describe('含域文档的增量布局 (M2h)', () => {
  it('域预留位数与 representativeFieldText 同口径', () => {
    expect(fieldReserveDigits(1)).toBe(1)
    expect(fieldReserveDigits(9)).toBe(1)
    expect(fieldReserveDigits(10)).toBe(2)
    expect(fieldReserveDigits(12345)).toBe(4)
  })

  it('段落键含域预留取样输入: 位数/locale/标题任一变化都使键变', () => {
    const { pool } = makeFieldDoc(30, 30)
    const para = [...pool.nodes.values()].find(
      n => n.type === 'paragraph' && (n as { children?: readonly string[] }).children
        ?.some(cid => (pool.nodes.get(cid) as { type?: string } | undefined)?.type === 'field'),
    ) as Paragraph | undefined
    expect(para).toBeTruthy()

    const engine = newEngine() as unknown as {
      fieldReserveCtx: { totalPagesHint: number; locale?: string; documentTitle?: string }
      paragraphLineCacheKey: (p: NodePool, para: Paragraph, w: number, m: string) => string | null
    }
    const keyWith = (hint: number, lc: string, title: string): string => {
      engine.fieldReserveCtx = { totalPagesHint: hint, locale: lc, documentTitle: title }
      const k = engine.paragraphLineCacheKey(pool, para!, 614, '')
      expect(k).toBeTruthy()
      return k!
    }
    const base = keyWith(9, 'zh-CN', '病历')
    expect(keyWith(10, 'zh-CN', '病历')).not.toBe(base)   // 位数 1 → 2
    expect(keyWith(9, 'en-US', '病历')).not.toBe(base)    // locale
    expect(keyWith(9, 'zh-CN', '病案')).not.toBe(base)    // 标题
    expect(keyWith(9, 'zh-CN', '病历')).toBe(base)        // 同输入同键
  })

  it('域段落进入行缓存: 无改动重排整份复用且零重算', () => {
    const { doc, pool, fieldIds } = makeFieldDoc(120)
    expect(fieldIds.length).toBe(4)
    const engine = newEngine()

    engine.fullLayout(doc, pool, 'paragraph')
    const first = engine.getParagraphCacheStats()
    expect(first.size).toBe(120)
    expect(first.misses).toBe(120)

    engine.fullLayout(doc, pool, 'paragraph')
    expect(engine.getPaginationStats().mode).toBe('reuse-all')
    const second = engine.getParagraphCacheStats()
    expect(second.misses).toBe(first.misses)
    expect(second.hits - first.hits).toBe(120)
  })

  it('正文编辑: 域段落命中, 续排并与全量一致', () => {
    const { doc, pool, texts } = makeFieldDoc(120)
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    pool.updateNode(texts[90], { text: `${SENTENCE}（已修改）` } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    expect(engine.getPaginationStats().mode).toBe('resume')
    expect(engine.getPaginationStats().reusedPages).toBeGreaterThan(0)
    expect(canonical(pages)).toBe(canonical(freshPages(doc, pool)))
  })

  it('域节点自身编辑: 该段落重算, 结果与全量一致', () => {
    const { doc, pool, fieldIds } = makeFieldDoc(120)
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')
    const before = engine.getParagraphCacheStats()

    pool.updateNode(fieldIds[1], { cachedValue: '第 3 页' } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    const after = engine.getParagraphCacheStats()
    expect(after.misses - before.misses).toBe(1)
    expect(canonical(pages)).toBe(canonical(freshPages(doc, pool)))
  })

  it('文档标题变化: 只有含域段落重算 (取样输入进键)', () => {
    const { doc, pool, fieldIds } = makeFieldDoc(120)
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')
    const before = engine.getParagraphCacheStats()

    doc.title = '住院病历（2026）'
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    const after = engine.getParagraphCacheStats()
    expect(after.misses - before.misses).toBe(fieldIds.length)
    expect(after.hits - before.hits).toBe(120 - fieldIds.length)
    expect(canonical(pages)).toBe(canonical(freshPages(doc, pool)))
  })

  it('交叉引用仍在安全子集外: 回落全量', () => {
    const { doc, pool, texts } = makeFieldDoc(60)
    // 在第一段挂一个交叉引用 (显示文本依赖上一轮页映射)
    const ref = {
      type: 'cross_reference', id: 'xref-1',
      refType: 'bookmark', targetRef: 'bm-1', text: '见第 {page} 页',
    }
    pool.addNode(ref as unknown as BaseNode)
    const para = [...pool.nodes.values()].find(
      n => n.type === 'paragraph' && (n as { children?: readonly string[] }).children?.includes(texts[0]),
    ) as { id: string } | undefined
    expect(para).toBeTruthy()
    pool.insertChild(para!.id, ref.id, 1)

    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')
    pool.updateNode(texts[30], { text: `${SENTENCE}（改）` } as Partial<BaseNode>)
    engine.fullLayout(doc, pool, 'paragraph')
    expect(engine.getPaginationStats().mode).toBe('full')
  })

  it('随机 60 步 (正文/域值/标题): 每步与全新引擎逐字节相同', () => {
    const { doc, pool, texts, fieldIds } = makeFieldDoc(120)
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    let seed = 86420
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    let resumed = 0
    for (let step = 0; step < 60; step++) {
      const action = Math.floor(rand() * 3)
      if (action === 0) {
        const t = texts[Math.floor(rand() * texts.length)]
        pool.updateNode(t, { text: `${SENTENCE}（改${Math.floor(rand() * 9)}）` } as Partial<BaseNode>)
      } else if (action === 1) {
        const f = fieldIds[Math.floor(rand() * fieldIds.length)]
        pool.updateNode(f, { cachedValue: `[页码 ${Math.floor(rand() * 99)}]` } as Partial<BaseNode>)
      } else {
        doc.title = `病历${Math.floor(rand() * 9)}`
      }

      const pages = engine.fullLayout(doc, pool, 'paragraph')
      if (engine.getPaginationStats().mode === 'resume') resumed++
      expect(canonical(pages), `step ${step}`).toBe(canonical(freshPages(doc, pool)))
    }
    expect(resumed).toBeGreaterThan(0)
  })
})
