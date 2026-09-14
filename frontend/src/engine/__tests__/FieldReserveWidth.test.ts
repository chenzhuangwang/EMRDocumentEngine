// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// 域代码预留宽 — 必须按「将绘制出的值」量宽, 而非模型占位符
//
// 回归: 布局用 cachedValue ('[总页数]' ≈ 66px) 量宽, 渲染期才解析成 '3' (≈9px)
// → 域后面拖出一大片空白 ("共 3      页")。
// 另: LineBreaker.getElementWidth 无 'field' 分支 → 落到 default 返回 0,
// 域完全不参与折行判定, 与 SLIF 推进宽脱节 (行尾可能溢出)。
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode, createFieldNode,
} from '../document/factory/ElementFormatter'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { testMeasurer } from './helpers'
import { representativeFieldText } from '../document/factory/FieldFormatter'
import type { BaseNode, DocumentTree, FieldType } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'
import type { SLIFItem } from '../layout/core/SLIF'

/** 页脚段落 = 给定 children (text/field 交替) */
function buildFooterDoc(build: (mkText: (t: string) => string, mkField: (f: FieldType) => string) => string[]) {
  const doc = createDocument('field-width')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)
  const mkText = (t: string): string => {
    const n = createTextNode(t)
    all.set(n.id, n as unknown as BaseNode)
    return n.id
  }
  const mkField = (f: FieldType): string => {
    const n = createFieldNode(f)
    all.set(n.id, n as unknown as BaseNode)
    return n.id
  }
  const para = createParagraph(build(mkText, mkField))
  all.set(para.id, para as unknown as BaseNode)
  doc.body.children = []
  doc.footer = [para.id]
  const pool: NodePool = buildNodePool(all, { body: doc.id, footer: doc.footer })
  return { doc, pool }
}

const itemsOf = (doc: DocumentTree, pool: NodePool): SLIFItem[] =>
  new LayoutEngine(new EventBus(), testMeasurer).fullLayout(doc, pool)[0].footerItems ?? []

const fieldOf = (items: SLIFItem[]) => items.find(i => i.nodeType === 'field')!

describe('representativeFieldText — 与解析结果同形 (量宽用)', () => {
  it('页码/总页数按页数估计预留位数', () => {
    const ctx = (n: number) => ({ totalPagesHint: n })
    expect(representativeFieldText('page_number', '[页码]', ctx(1))).toBe('8')
    expect(representativeFieldText('page_number', '[页码]', ctx(9))).toBe('8')
    expect(representativeFieldText('page_number', '[页码]', ctx(10))).toBe('88')
    expect(representativeFieldText('total_pages', '[总页数]', ctx(123))).toBe('888')
    // 位数上下限 (1..4)
    expect(representativeFieldText('page_number', '[页码]', ctx(0))).toBe('8')
    expect(representativeFieldText('page_number', '[页码]', ctx(999999))).toBe('8888')
  })

  it('文档标题用真实标题宽 (可精确量宽)', () => {
    expect(representativeFieldText('document_title', '[标题]', { totalPagesHint: 1, documentTitle: '入院记录' }))
      .toBe('入院记录')
  })

  it('日期/时间用固定样本 (形状与解析结果一致)', () => {
    const d = representativeFieldText('current_date', '[日期]', { totalPagesHint: 1 })
    const t = representativeFieldText('current_time', '[时间]', { totalPagesHint: 1 })
    expect(d).toMatch(/^\d{4}\/\d{1,2}\/\d{1,2}$/)
    expect(t).toMatch(/^\d{1,2}:\d{2}$/)
  })

  it('未知域类型仍返回占位符 (与 resolveFieldText 的 default 一致)', () => {
    expect(representativeFieldText('weird_field', '[怪物]', { totalPagesHint: 1 })).toBe('[怪物]')
  })
})

describe('布局 — 域预留宽不再是占位符宽', () => {
  it('页脚 "第[页码]页 共[总页数]页" 的域宽 ≈ 一位数字 (远小于占位符)', () => {
    const { doc, pool } = buildFooterDoc((mkText, mkField) => [
      mkText('第'), mkField('page_number'), mkText('页 共'), mkField('total_pages'), mkText('页'),
    ])
    const items = itemsOf(doc, pool)
    const fields = items.filter(i => i.nodeType === 'field')
    expect(fields).toHaveLength(2)
    for (const f of fields) {
      // 占位符 '[页码]' / '[总页数]' 宽 50 / 66; 修复后应为个位数
      expect(f.width!).toBeLessThan(20)
      expect(f.width!).toBeGreaterThan(0)
    }
  })

  it('域之后的文本紧接域槽位 (无大段空白)', () => {
    const { doc, pool } = buildFooterDoc((mkText, mkField) => [
      mkText('共'), mkField('total_pages'), mkText('页'),
    ])
    const items = itemsOf(doc, pool)
    const f = fieldOf(items)
    const after = items[items.findIndex(i => i.nodeId === f.nodeId) + 1]
    expect(after.text).toBe('页')
    // 间距 = 域预留宽 (一位数字), 不超过 1 个字宽
    expect(after.x - f.x).toBeLessThan(16)
  })

  it('文本节点渲染期仍显示占位符回退 (值不变, 只有宽度用了代表值)', () => {
    const { doc, pool } = buildFooterDoc((mkText, mkField) => [mkText('共'), mkField('total_pages')])
    const f = fieldOf(itemsOf(doc, pool))
    // SLIF item.text 保持模型占位符 — 未知域类型的显示回退依赖它
    expect(f.text).toBe('[总页数]')
  })

  it('文档标题域按真实标题量宽', () => {
    const { doc, pool } = buildFooterDoc((mkText, mkField) => [mkText('《'), mkField('document_title'), mkText('》')])
    doc.title = '很长很长的入院记录标题'
    const items = itemsOf(doc, pool)
    const f = fieldOf(items)
    // 与同字号的标题文本量宽一致 (允许 1px 舍入)
    const expected = testMeasurer.measureWidth('很长很长的入院记录标题', { font: 'SimSun', size: 16 })
    expect(Math.abs((f.width ?? 0) - expected)).toBeLessThanOrEqual(1)
  })

  it('域参与行宽推进 (LineBreaker 不再视其为 0 宽)', () => {
    const { doc, pool } = buildFooterDoc((mkText, mkField) => [mkText('第'), mkField('page_number'), mkText('页')])
    const items = itemsOf(doc, pool)
    const [first, field, last] = items
    expect(field.x).toBeGreaterThan(first.x)
    expect(last.x).toBeGreaterThan(field.x)
    expect(field.x - first.x).toBeCloseTo(first.width ?? 0, 0)
  })
})

describe('布局 — 两位数页码的预留宽 (两轮收敛)', () => {
  /** 足够多正文段落 → ≥10 页 (迫使页码位数从 1 位变 2 位) */
  function buildMultiPageDoc(bodyParas: number) {
    const doc = createDocument('multi-page')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)

    const bodyIds: string[] = []
    for (let i = 0; i < bodyParas; i++) {
      const tn = createTextNode(`第${i + 1}行`)
      const p = createParagraph([tn.id])
      all.set(tn.id, tn as unknown as BaseNode)
      all.set(p.id, p as unknown as BaseNode)
      bodyIds.push(p.id)
    }
    doc.body.children = bodyIds

    const ft = createTextNode('第')
    const ff = createFieldNode('page_number')
    const ft2 = createTextNode('页')
    const fpara = createParagraph([ft.id, ff.id, ft2.id])
    for (const n of [ft, ff, ft2, fpara]) all.set(n.id, n as unknown as BaseNode)
    doc.footer = [fpara.id]

    return { doc, pool: buildNodePool(all, { body: doc.id, footer: doc.footer }) }
  }

  it('≥10 页时页码域预留 2 位数字 (而非 1 位 → 不重叠)', () => {
    const { doc, pool } = buildMultiPageDoc(700)
    const engine = new LayoutEngine(new EventBus(), testMeasurer)
    const pages = engine.fullLayout(doc, pool)
    expect(pages.length).toBeGreaterThanOrEqual(10)

    const f = (pages[0].footerItems ?? []).find(i => i.nodeType === 'field')!
    const twoDigits = testMeasurer.measureWidth('88', { font: 'SimSun', size: 16 })
    expect(Math.abs((f.width ?? 0) - twoDigits)).toBeLessThanOrEqual(1)
  })

  it('个位页数时预留 1 位 (紧凑, 不留空白)', () => {
    const { doc, pool } = buildMultiPageDoc(20)
    const pages = new LayoutEngine(new EventBus(), testMeasurer).fullLayout(doc, pool)
    expect(pages.length).toBeLessThan(10)
    const f = (pages[0].footerItems ?? []).find(i => i.nodeType === 'field')!
    const oneDigit = testMeasurer.measureWidth('8', { font: 'SimSun', size: 16 })
    expect(Math.abs((f.width ?? 0) - oneDigit)).toBeLessThanOrEqual(1)
  })
})
