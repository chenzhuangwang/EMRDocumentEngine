// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 增量分页 (M2b)
//
// 安全子集: 纯文本正文, 无表格/分节/脚注/域/控件/列表/页眉页脚。
// 判据与 M2a 相同: 与全新引擎的全量结果逐字节相同。
// 另外必须证明续排真的发生了 (reusedPages > 0), 否则用例退化成全量。
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

const SENTENCE = '患者三日前出现发热，伴畏寒乏力，无咳嗽咳痰，无腹痛腹泻，饮食睡眠尚可。'

function makeLongDoc(paragraphCount = 120) {
  const doc = createDocument('paging')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)
  const paras: Paragraph[] = []
  const texts: string[] = []

  for (let i = 0; i < paragraphCount; i++) {
    const t = createTextNode(`第${i + 1}段：${SENTENCE}`)
    const p = createParagraph([t.id]) as Paragraph
    all.set(t.id, t as unknown as BaseNode)
    all.set(p.id, p as unknown as BaseNode)
    paras.push(p)
    texts.push(t.id)
    doc.body.children.push(p.id)
  }

  const pool = buildNodePool(all, { body: doc.id })
  return { doc, pool, paras, texts }
}

function newEngine() {
  return new LayoutEngine(new EventBus(), testMeasurer)
}

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

describe('增量分页 (M2b)', () => {
  it('中段文本编辑: 续排并复用前序页, 结果与全量逐字节相同', () => {
    const { doc, pool, texts } = makeLongDoc()
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    // 选靠后的段落, 确保它不在第一页 (否则续排起点是 0, 无可复用页)
    pool.updateNode(texts[100], { text: `第101段：${SENTENCE}（已修改）` } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    const stats = engine.getPaginationStats()
    expect(stats.mode).toBe('resume')
    expect(stats.reusedPages).toBeGreaterThan(0)
    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('内容不变时整份分页复用', () => {
    const { doc, pool } = makeLongDoc()
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    const again = engine.fullLayout(doc, pool, 'paragraph')
    expect(engine.getPaginationStats().mode).toBe('reuse-all')
    expect(engine.getPaginationStats().reusedPages).toBe(again.length)
  })

  it('首段编辑回落到全量分页', () => {
    const { doc, pool, texts } = makeLongDoc()
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    pool.updateNode(texts[0], { text: `第1段：${SENTENCE}（改）` } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    expect(engine.getPaginationStats().mode).toBe('full')
    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('结构改动 (插入子节点) 回落到全量, 结果一致', () => {
    const { doc, pool, paras } = makeLongDoc()
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    const extra = createTextNode('补充')
    pool.addNode(extra as unknown as BaseNode)
    pool.insertChild(paras[40].id, extra.id, paras[40].children.length)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    expect(engine.getPaginationStats().mode).toBe('full')
    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('文本变长导致页数变化时仍与原全量一致', () => {
    const { doc, pool, texts } = makeLongDoc(60)
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    const longer = (`${SENTENCE}`.repeat(12))
    pool.updateNode(texts[30], { text: longer } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('含有序列表的文档: 编号进键, 续排仍与全量一致', () => {
    const { doc, pool, texts } = makeLongDoc(80)
    for (const id of doc.body.children) {
      const p = pool.nodes.get(id) as unknown as Paragraph
      p.list = { type: 'ordered', level: 1, numberStyle: 'decimal' }
    }
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    // 改一项的文本: 编号不变 → 后续项命中缓存; 该项重算 → 从它所在页续排
    pool.updateNode(texts[70], { text: `第71段：${SENTENCE}（改）` } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    expect(engine.getPaginationStats().mode).toBe('resume')
    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('含表格的文档不启用增量分页', () => {    const { doc, pool, texts } = makeLongDoc(60)
    // 在正文尾部挂一个 1×1 表格 —— 现成工厂在测试里过重, 直接构造最小表
    const cellText = createTextNode('单元格')
    const cellPara = createParagraph([cellText.id]) as Paragraph
    const cell = { type: 'cell', id: 'cell-1', children: [cellPara.id], colspan: 1, rowspan: 1 }
    const row = { type: 'row', id: 'row-1', children: [cell.id], height: 24 }
    const table = { type: 'table', id: 'table-1', columns: [{ width: 1 }], children: [row.id] }
    for (const n of [cellText, cellPara, cell, row, table]) pool.addNode(n as unknown as BaseNode)
    doc.body.children.push(table.id)

    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')
    pool.updateNode(texts[30], { text: `${SENTENCE}（改）` } as Partial<BaseNode>)
    engine.fullLayout(doc, pool, 'paragraph')

    expect(engine.getPaginationStats().mode).toBe('full')
  })

  it('随机编辑 30 步: 每步与全量一致, 且至少发生一次续排', () => {
    const { doc, pool, texts } = makeLongDoc(80)
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    let seed = 31415
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    let resumeCount = 0
    const alignments = ['left', 'center', 'right', 'justify'] as const

    for (let step = 0; step < 30; step++) {
      const idx = Math.floor(rand() * texts.length)
      const action = Math.floor(rand() * 4)
      if (action === 0) {
        const current = (pool.nodes.get(texts[idx]) as { text?: string } | undefined)?.text ?? ''
        const next = rand() < 0.5 ? `${current}随访。` : current.slice(0, Math.max(0, current.length - 2))
        pool.updateNode(texts[idx], { text: next } as Partial<BaseNode>)
      } else if (action === 1) {
        // 段落样式: 行高/对齐变化会直接影响分页
        const alignment = alignments[Math.floor(rand() * alignments.length)]
        const paraId = doc.body.children[idx]
        pool.updateNode(paraId, { alignment } as Partial<BaseNode>)
      } else if (action === 2) {
        // 一次放入长文本, 制造跨页位移
        pool.updateNode(texts[idx], { text: SENTENCE.repeat(8) } as Partial<BaseNode>)
      } else {
        pool.updateNode(texts[idx], { text: `第${idx + 1}段：短。` } as Partial<BaseNode>)
      }

      const pages = engine.fullLayout(doc, pool, 'paragraph')
      if (engine.getPaginationStats().mode === 'resume') resumeCount++
      expect(canonical(pages), `step ${step}`).toBe(canonical(newEngine().fullLayout(doc, pool)))
    }

    expect(resumeCount).toBeGreaterThan(0)
  })
})
