// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 增量分页 (M2b)
//
// 安全子集: 正文段落 (文本/图片/脚注引用/列表) 与纯文本表格;
// 无分节/域/控件/页眉页脚。判据与 M2a 相同: 与全新引擎的全量结果逐字节相同。
// 另外必须证明续排真的发生了 (reusedPages > 0), 否则用例退化成全量。
// ================================================================

import { describe, it, expect } from 'vitest'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { testMeasurer } from './helpers'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode, createImageNode,
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

/**
 * 正文按段落段/表格段交替构建; 表格行数足够大时跨页。
 * 用于验证表格键、跨页表格的续排回退, 以及多表相邻的情形。
 */
function buildDocWithTables(
  segments: ({ paras: number } | { tableRows: number })[],
) {
  const doc = createDocument('table-paging')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)
  const textIds: string[] = []
  const paraIds: string[] = []
  const cellTextIds: string[] = []
  const rowIds: string[] = []
  let paraNo = 0
  let tableNo = 0

  const addParagraph = (text: string) => {
    const t = createTextNode(text)
    const p = createParagraph([t.id]) as Paragraph
    all.set(t.id, t as unknown as BaseNode)
    all.set(p.id, p as unknown as BaseNode)
    doc.body.children.push(p.id)
    textIds.push(t.id)
    paraIds.push(p.id)
  }

  for (const seg of segments) {
    if ('tableRows' in seg) {
      const prefix = `t${tableNo++}`
      const tableRowIds: string[] = []
      for (let r = 0; r < seg.tableRows; r++) {
        const t = createTextNode(`单元格${r + 1}`)
        const p = createParagraph([t.id]) as Paragraph
        const cell = { type: 'cell', id: `${prefix}-cell-${r}`, children: [p.id], colspan: 1, rowspan: 1 }
        const row = { type: 'row', id: `${prefix}-row-${r}`, children: [cell.id], height: 24 }
        all.set(t.id, t as unknown as BaseNode)
        all.set(p.id, p as unknown as BaseNode)
        all.set(cell.id, cell as unknown as BaseNode)
        all.set(row.id, row as unknown as BaseNode)
        tableRowIds.push(row.id)
        cellTextIds.push(t.id)
      }
      const table = { type: 'table', id: `${prefix}-table`, columns: [{ width: 400 }], children: tableRowIds }
      all.set(table.id, table as unknown as BaseNode)
      doc.body.children.push(table.id)
      rowIds.push(...tableRowIds)
      continue
    }
    for (let i = 0; i < seg.paras; i++) {
      paraNo++
      addParagraph(`正文第${paraNo}段：${SENTENCE}`)
    }
  }

  const pool = buildNodePool(all, { body: doc.id })
  return { doc, pool, textIds, paraIds, cellTextIds, rowIds }
}

function makeTableDoc(leading: number, rows: number, trailing: number) {
  const built = buildDocWithTables([{ paras: leading }, { tableRows: rows }, { paras: trailing }])
  return { ...built, tableId: 't0-table' }
}

/**
 * 在段落的第 index 个位置插入脚注引用, 并补上脚注内容节点。
 * 内容节点按 FootnoteLayout 的取文规则挂一个 paragraph → text。
 */
function addFootnote(
  pool: NodePool, paraId: string, index: number, key: string, text: string,
): { refId: string } {
  const textNode = createTextNode(text)
  const para = createParagraph([textNode.id]) as Paragraph
  const content = {
    type: 'footnote_content', id: `fn-content-${key}`,
    refId: `fn-ref-${key}`, children: [para.id],
  }
  const ref = { type: 'footnote_ref', id: `fn-ref-${key}`, footnoteId: content.id }
  for (const n of [textNode, para, content, ref]) pool.addNode(n as unknown as BaseNode)
  pool.insertChild(paraId, ref.id, index)
  return { refId: ref.id }
}

/** 页面上已回填的脚注编号文本 (按页面顺序) */
function footnoteNumbers(pages: ReturnType<LayoutEngine['fullLayout']>): string[] {
  const out: string[] = []
  for (const page of pages) {
    for (const item of page.items) {
      if (item.nodeId.startsWith('fn-num-')) out.push(item.text ?? '')
    }
  }
  return out
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

  it('首段同形状编辑: 补丁首段所在页, 之后整段复用 (M2e)', () => {
    const { doc, pool, texts } = makeLongDoc()
    const engine = newEngine()
    const before = engine.fullLayout(doc, pool, 'paragraph')

    pool.updateNode(texts[0], { text: `第1段：${SENTENCE}（改）` } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    const stats = engine.getPaginationStats()
    expect(stats.mode).toBe('resume')
    expect(stats.reusedPages).toBe(0)             // 脏段落在第 0 页, 前面没有可复用页
    expect(stats.reusedTailPages).toBeGreaterThan(0)
    // 补丁范围之后的页对象**原样复用** (不是重建后恰好相等)
    expect(pages[pages.length - 1]).toBe(before[before.length - 1])
    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('首段改行数 → 回落全量分页', () => {
    const { doc, pool, texts } = makeLongDoc()
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    pool.updateNode(
      texts[0],
      { text: `第1段：${SENTENCE}${SENTENCE}${SENTENCE}${SENTENCE}` } as Partial<BaseNode>,
    )
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

  it('含行内图片的文档: 图片自包含, 可以续排', () => {
    const { doc, pool, texts } = makeLongDoc(80)
    const paraId = doc.body.children[40]
    const img = createImageNode('img-key', 120, 80, 'inline')
    pool.addNode(img as unknown as BaseNode)
    pool.insertChild(paraId, img.id, 1)

    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')
    pool.updateNode(texts[70], { text: `第71段：${SENTENCE}（改）` } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    expect(engine.getPaginationStats().mode).toBe('resume')
    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('含脚注引用的文档: 脚注之后的正文编辑可续排, 编号与全量一致', () => {
    const { doc, pool, paras, texts } = makeLongDoc(90)
    addFootnote(pool, paras[10].id, 1, 'a', '既往史：高血压十年')

    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    pool.updateNode(texts[70], { text: `${SENTENCE}（已修改）` } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    expect(engine.getPaginationStats().mode).toBe('resume')
    expect(engine.getPaginationStats().reusedPages).toBeGreaterThan(0)
    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
    expect(footnoteNumbers(pages)).toEqual(['1.'])
  })

  it('续排点之前已有脚注: 新页编号接续 (播种生效)', () => {
    const { doc, pool, paras, texts } = makeLongDoc(130)
    addFootnote(pool, paras[10].id, 1, 'a', '既往史：高血压十年')
    addFootnote(pool, paras[110].id, 1, 'b', '家族史：父亲糖尿病')

    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    // 编辑点在两个脚注之间: 复用页带着第 1 条脚注, 新页必须从 2 开始
    pool.updateNode(texts[100], { text: `${SENTENCE}（已修改）` } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    expect(engine.getPaginationStats().mode).toBe('resume')
    expect(engine.getPaginationStats().reusedPages).toBeGreaterThan(0)
    expect(footnoteNumbers(pages)).toEqual(['1.', '2.'])
    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('新增脚注引用是结构编辑: 回落全量, 编号重排后结果一致', () => {
    const { doc, pool, paras } = makeLongDoc(60)
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    addFootnote(pool, paras[30].id, 1, 'late', '本次新增脚注')
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    expect(engine.getPaginationStats().mode).toBe('full')
    expect(footnoteNumbers(pages)).toEqual(['1.'])
    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('含表格的文档: 内容不变时整份复用', () => {
    const { doc, pool } = makeTableDoc(90, 6, 40)
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    engine.fullLayout(doc, pool, 'paragraph')
    expect(engine.getPaginationStats().mode).toBe('reuse-all')
  })

  it('表格后正文编辑: 续排并复用前序页, 结果一致', () => {
    const { doc, pool, textIds } = makeTableDoc(90, 6, 40)
    // textIds 末尾是后置段落
    const target = textIds[textIds.length - 10]
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    pool.updateNode(target, { text: `${SENTENCE}（已修改）` } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    expect(engine.getPaginationStats().mode).toBe('resume')
    expect(engine.getPaginationStats().reusedPages).toBeGreaterThan(0)
    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('表格单元格编辑: 表格键失效, 从表格起始页重排, 结果一致', () => {
    const { doc, pool, cellTextIds } = makeTableDoc(90, 6, 20)
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    pool.updateNode(cellTextIds[2], { text: '单元格3（改）' } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    const stats = engine.getPaginationStats()
    expect(stats.mode).toBe('resume')
    // 表格之前的页仍可复用 (表格起始页之后才重排)
    expect(stats.reusedPages).toBeGreaterThan(0)
    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('跨页表格后的段落编辑: 回退到表格起始页, 结果一致', () => {
    // 110 行表格跨越数页; 编辑紧随其后的段落 —— 它所在页的上一页是表格续排页,
    // 若从那页开始切行会重复表格片段。回退到表格起始页后必须逐字节相同。
    const { doc, pool, textIds } = makeTableDoc(90, 110, 20)
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    // 表格后的第一段 = 前置 90 段之后的那一条
    const firstTrailing = textIds[90]
    pool.updateNode(firstTrailing, { text: `${SENTENCE}（已修改）` } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    expect(engine.getPaginationStats().mode).toBe('resume')
    expect(engine.getPaginationStats().reusedPages).toBeGreaterThan(0)
    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('表格 cell 内的脚注引用: 仍可增量, 结果与全量一致 (契约 §31.13.1)', () => {
    const { doc, pool } = makeTableDoc(20, 4, 10)
    // cell 段落里挂一个脚注引用 — 它参与全页编号 (Step 4 展平后回填),
    // 且只影响页底脚注区, 不再把整份文档踢出增量安全集。
    const cellPara = pool.nodes.get('t0-cell-1') as { children: readonly string[] } | undefined
    const paraId = cellPara?.children[0]
    const fn = {
      type: 'footnote_ref', id: 'fn-1', footnoteId: 'fn-1', refId: 'fn-1',
    }
    pool.addNode(fn as unknown as BaseNode)
    pool.insertChild(paraId!, fn.id, 1)

    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    expect(engine.getPaginationStats().mode).toBe('reuse-all')
    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('计算值代次变化: 表格键失效, 不复用整份且结果一致', () => {
    const { doc, pool } = makeTableDoc(40, 6, 10)
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    engine.setComputedGeneration(1)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    expect(engine.getPaginationStats().mode).not.toBe('reuse-all')
    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('两张跨页表格 + 随机编辑 60 步: 每步与全量逐字节相同', () => {
    const { doc, pool, textIds, paraIds, cellTextIds } = buildDocWithTables([
      { paras: 30 }, { tableRows: 40 }, { paras: 30 }, { tableRows: 40 }, { paras: 30 },
    ])
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    let seed = 27182
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    let resumeCount = 0
    const alignments = ['left', 'center', 'right', 'justify'] as const

    for (let step = 0; step < 60; step++) {
      const action = Math.floor(rand() * 3)
      if (action === 0) {
        const t = textIds[Math.floor(rand() * textIds.length)]
        const tail = rand() < 0.5 ? '随访。' : `（改${Math.floor(rand() * 9)}）`
        pool.updateNode(t, { text: `${SENTENCE}${tail}` } as Partial<BaseNode>)
      } else if (action === 1) {
        // cell 文本变化 → 表格键失效 → 从该表格起始页重排
        const c = cellTextIds[Math.floor(rand() * cellTextIds.length)]
        pool.updateNode(c, { text: `单元格（改${Math.floor(rand() * 9)}）` } as Partial<BaseNode>)
      } else {
        const p = paraIds[Math.floor(rand() * paraIds.length)]
        const alignment = alignments[Math.floor(rand() * alignments.length)]
        pool.updateNode(p, { alignment } as Partial<BaseNode>)
      }

      const pages = engine.fullLayout(doc, pool, 'paragraph')
      if (engine.getPaginationStats().mode === 'resume') resumeCount++
      expect(canonical(pages), `step ${step}`).toBe(canonical(newEngine().fullLayout(doc, pool)))
    }

    expect(resumeCount).toBeGreaterThan(0)
  })

  it('随机编辑 120 步: 每步与全量一致, 且至少发生一次续排', () => {
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

    for (let step = 0; step < 120; step++) {
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
