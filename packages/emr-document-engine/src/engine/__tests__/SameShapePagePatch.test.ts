// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 同形状页补丁 (M2e, 契约 §16.1)
//
// 判据不是"看起来没变": 脏段落的新行必须与缓存旧行**行数、逐行行高、逐行
// 段末标记**全部相同, 且文档无表格/无脚注 —— 此时 PageBreaker 的决策序列
// 输入完全一致, 页边界不可能移动。用例要证明两件事:
//   1. 真的发生了补丁 (补丁范围之后的页对象**原样复用**, 不是重建后相等);
//   2. 补丁结果与全新引擎的全量排版逐字节相同 (含 100 步随机同长度替换)。
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
import type { NodePool } from '../document/core/NodePool'

const SENTENCE = '患者三日前出现发热，伴畏寒乏力，无咳嗽咳痰，无腹痛腹泻，饮食睡眠尚可。'

function makeDoc(n: number) {
  const doc = createDocument('patch')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)
  const texts: string[] = []
  const paras: string[] = []
  for (let i = 0; i < n; i++) {
    const t = createTextNode(`第${i + 1}段：${SENTENCE}`)
    const p = createParagraph([t.id]) as Paragraph
    all.set(t.id, t as unknown as BaseNode)
    all.set(p.id, p as unknown as BaseNode)
    doc.body.children.push(p.id)
    texts.push(t.id)
    paras.push(p.id)
  }
  return { doc, pool: buildNodePool(all, { body: doc.id }), texts, paras }
}

/** 在正文中插一张纯文本表格 (table → row → cell → paragraph → text) */
function makeDocWithTable(leading: number, rows: number, trailing: number) {
  const base = makeDoc(leading + trailing)
  const all = new Map<string, BaseNode>()
  for (const [id, node] of base.pool.nodes) all.set(id, node)
  const doc = base.doc
  const cellTextIds: string[] = []

  const rowIds: string[] = []
  for (let r = 0; r < rows; r++) {
    const t = createTextNode(`单元格${r + 1}`)
    const p = createParagraph([t.id]) as Paragraph
    const cell = { type: 'cell', id: `t-cell-${r}`, children: [p.id], colspan: 1, rowspan: 1 }
    const row = { type: 'row', id: `t-row-${r}`, children: [cell.id], height: 24 }
    all.set(t.id, t as unknown as BaseNode)
    all.set(p.id, p as unknown as BaseNode)
    all.set(cell.id, cell as unknown as BaseNode)
    all.set(row.id, row as unknown as BaseNode)
    rowIds.push(row.id)
    cellTextIds.push(t.id)
  }
  const table = { type: 'table', id: 't-table', children: rowIds, columns: [{ width: 200 }] }
  all.set(table.id, table as unknown as BaseNode)
  // 表格插在 leading 段之后
  doc.body.children.splice(leading, 0, table.id)

  // 重建节点池 (节点池按整棵树建立索引)
  return {
    doc,
    pool: buildNodePool(all, { body: doc.id }),
    texts: base.texts,
    paras: base.paras,
    cellTextIds,
  }
}

/** 插一个脚注引用 (内容段落按 FootnoteLayout 的取文规则挂 paragraph → text) */
function addFootnote(pool: NodePool, paraId: string, key: string): void {
  const t = createTextNode(`脚注${key}`)
  const p = createParagraph([t.id]) as Paragraph
  const content = {
    type: 'footnote_content', id: `fn-content-${key}`,
    refId: `fn-ref-${key}`, children: [p.id],
  }
  const ref = { type: 'footnote_ref', id: `fn-ref-${key}`, footnoteId: content.id }
  for (const n of [t, p, content, ref]) pool.addNode(n as unknown as BaseNode)
  pool.insertChild(paraId, ref.id, 0)
}

/** 等宽替换: 一个 CJK 字换另一个 CJK 字 —— 宽度、行数、行高都不变 */
function swapChar(text: string, pos: number): string {
  const chars = [...text]
  chars[pos % chars.length] = chars[pos % chars.length] === '患' ? '病' : '患'
  return chars.join('')
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
    return v instanceof Map ? Object.fromEntries([...v.entries()].map(([k, x]) => [k, walk(x)])) : v
  }
  return JSON.stringify(walk(value))
}

function newEngine(): LayoutEngine {
  return new LayoutEngine(new EventBus(), testMeasurer)
}

describe('同形状页补丁 (M2e)', () => {
  it('中段同长度替换: 只重建所在页, 之后页对象原样复用', () => {
    const { doc, pool, texts } = makeDoc(120)
    const engine = newEngine()
    const before = engine.fullLayout(doc, pool, 'paragraph')

    const node = pool.nodes.get(texts[40]) as { text: string }
    pool.updateNode(texts[40], { text: swapChar(node.text, 2) } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    const stats = engine.getPaginationStats()
    expect(stats.mode).toBe('resume')
    expect(stats.reusedPages).toBeGreaterThan(0)
    expect(stats.reusedTailPages).toBeGreaterThan(0)
    expect(pages[0]).toBe(before[0])
    expect(pages[pages.length - 1]).toBe(before[before.length - 1])
    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('关掉补丁: 走 M2b 续排, 结果仍逐字节一致, 但不复用尾页', () => {
    const { doc, pool, texts } = makeDoc(120)
    const engine = newEngine()
    const before = engine.fullLayout(doc, pool, 'paragraph')

    engine.setSameShapePatchEnabled(false)
    const node = pool.nodes.get(texts[40]) as { text: string }
    pool.updateNode(texts[40], { text: swapChar(node.text, 2) } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    const stats = engine.getPaginationStats()
    expect(stats.mode).toBe('resume')
    expect(stats.reusedTailPages).toBe(0)
    expect(pages[pages.length - 1]).not.toBe(before[before.length - 1])
    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('跨页多行段落: 补丁重建其跨页页, 尾部页仍复用', () => {
    const { doc, pool, texts } = makeDoc(120)
    // 把中段拉成多行段落 (仍由同一段落行缓存路径处理)
    pool.updateNode(texts[80], { text: `${SENTENCE}${SENTENCE}${SENTENCE}` } as Partial<BaseNode>)
    const engine = newEngine()
    const before = engine.fullLayout(doc, pool, 'paragraph')

    const node = pool.nodes.get(texts[80]) as { text: string }
    pool.updateNode(texts[80], { text: swapChar(node.text, 4) } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    const stats = engine.getPaginationStats()
    expect(stats.mode).toBe('resume')
    expect(stats.reusedTailPages).toBeGreaterThan(0)
    expect(pages[pages.length - 1]).toBe(before[before.length - 1])
    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('随机 100 步同长度替换: 每步与全新引擎逐字节相同, 且至少一次走补丁', () => {
    const { doc, pool, texts } = makeDoc(120)
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    let seed = 90210
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    let patched = 0
    for (let step = 0; step < 100; step++) {
      const t = texts[Math.floor(rand() * texts.length)]
      const node = pool.nodes.get(t) as { text: string }
      pool.updateNode(t, { text: swapChar(node.text, Math.floor(rand() * 30)) } as Partial<BaseNode>)

      const pages = engine.fullLayout(doc, pool, 'paragraph')
      if (engine.getPaginationStats().reusedTailPages > 0) patched++
      expect(canonical(pages), `step ${step}`).toBe(canonical(newEngine().fullLayout(doc, pool)))
    }
    expect(patched).toBeGreaterThan(0)
  })

  it('含脚注的文档不走补丁 (脚注区不属于正文行切片)', () => {
    const { doc, pool, texts, paras } = makeDoc(120)
    addFootnote(pool, paras[2], 'm2e')
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    const node = pool.nodes.get(texts[40]) as { text: string }
    pool.updateNode(texts[40], { text: swapChar(node.text, 2) } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    const stats = engine.getPaginationStats()
    expect(stats.mode).toBe('resume')
    expect(stats.reusedTailPages).toBe(0)
    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('含表格的文档不走补丁 (表格 fragment 让页与输入行不再一一对应)', () => {
    const { doc, pool, texts } = makeDocWithTable(20, 30, 100)
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    const node = pool.nodes.get(texts[40]) as { text: string }
    pool.updateNode(texts[40], { text: swapChar(node.text, 2) } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    const stats = engine.getPaginationStats()
    expect(stats.mode).toBe('resume')
    expect(stats.reusedTailPages).toBe(0)
    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })
})
