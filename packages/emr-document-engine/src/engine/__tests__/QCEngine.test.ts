// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// QCEngine 单元测试 (R72)
// ============================================================

import { describe, it, expect } from 'vitest'
import { QCEngine } from '../qc/QCEngine'
import { NodePool, buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode,
} from '../document/factory/ElementFormatter'
import type { DocumentTree, BaseNode } from '../document/core/DocumentModel'

function makeDoc(title: string, texts: string[]): { doc: DocumentTree; pool: NodePool } {
  const doc = createDocument(title)
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)

  const bodyIds: string[] = []
  for (const t of texts) {
    const para = createParagraph()
    const tn = createTextNode(t)
    para.children = [tn.id]
    bodyIds.push(para.id)
    allNodes.set(para.id, para as unknown as BaseNode)
    allNodes.set(tn.id, tn as unknown as BaseNode)
  }
  doc.body.children = bodyIds

  return { doc, pool: buildNodePool(allNodes, { body: doc.id }) }
}

describe('QCEngine', () => {
  it('should pass QC for valid document', () => {
    const { doc, pool } = makeDoc('入院记录', ['主诉：头痛3天', '现病史：患者于3天前无明显诱因出现头痛'])
    const engine = new QCEngine()
    const result = engine.check(doc, pool)
    expect(result.score).toBe(100)
    expect(result.grade).toBe('A')
    expect(result.issues.length).toBe(0)
  })

  it('should detect empty title (error)', () => {
    const { doc, pool } = makeDoc('', ['段落1'])
    const engine = new QCEngine()
    const result = engine.check(doc, pool)
    expect(result.issues.some(i => i.ruleId === 'qc_001')).toBe(true)
    expect(result.stats.errors).toBeGreaterThanOrEqual(1)
    expect(result.score).toBeLessThan(100)
  })

  it('should detect empty body (error)', () => {
    const { doc, pool } = makeDoc('测试文档', [])
    const engine = new QCEngine()
    const result = engine.check(doc, pool)
    expect(result.issues.some(i => i.ruleId === 'qc_002')).toBe(true)
  })

  it('should detect consecutive empty paragraphs (warning)', () => {
    const { doc, pool } = makeDoc('测试', ['段落1', '', ''])
    const engine = new QCEngine()
    const result = engine.check(doc, pool)
    expect(result.issues.some(i => i.ruleId === 'qc_003')).toBe(true)
  })

  it('should detect low character count (info)', () => {
    const { doc, pool } = makeDoc('测试', ['ab'])
    const engine = new QCEngine()
    const result = engine.check(doc, pool)
    expect(result.issues.some(i => i.ruleId === 'qc_005')).toBe(true)
  })

  it('should compute grade correctly', () => {
    const { doc, pool } = makeDoc('', [])
    const engine = new QCEngine()
    const result = engine.check(doc, pool)
    // 2 errors (qc_001+qc_002) = -30, 1 info (qc_005) = -2 → 68
    expect(result.score).toBeLessThan(75)
    expect(result.grade).toBe('C')
  })
})

// ============================================================
// qc_003 范围拓宽 — 正文 + 页眉/页脚各变体 (契约 §7.9)
//
// 旧实现只扫 doc.body.children: 页眉/页脚里的连续空段完全不被质检;
// 且非段落块 (table/separator/image) 因没有 text 被误判为空段, 在
// 「空段-表格-空段」时产生假阳性。
// ============================================================

describe('QCEngine qc_003 — 覆盖页眉/页脚 (契约 §7.9)', () => {
  /** 构造: body + footer 各若干段 (文本 '' = 空段) */
  function makeDocWithFooter(bodyTexts: string[], footerTexts: string[]): { doc: DocumentTree; pool: NodePool } {
    const doc = createDocument('测试')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)

    const mk = (t: string): string => {
      const tn = createTextNode(t)
      const p = createParagraph([tn.id])
      all.set(tn.id, tn as unknown as BaseNode)
      all.set(p.id, p as unknown as BaseNode)
      return p.id
    }

    doc.body.children = bodyTexts.map(mk)
    doc.header = []
    doc.footer = footerTexts.map(mk)
    return { doc, pool: buildNodePool(all, { body: doc.id, footer: doc.footer }) }
  }

  const emptyPara = (texts: string[], n: number) => [...texts, ...Array.from({ length: n }, () => '')]

  it('页脚内连续两个空段 → 触发 qc_003', () => {
    const { doc, pool } = makeDocWithFooter(['正文'], ['', ''])
    const result = new QCEngine().check(doc, pool)
    expect(result.issues.some(i => i.ruleId === 'qc_003')).toBe(true)
  })

  it('页脚内单个空段 → 不触发 (无警告)', () => {
    const { doc, pool } = makeDocWithFooter(['正文'], [''])
    const result = new QCEngine().check(doc, pool)
    expect(result.issues.some(i => i.ruleId === 'qc_003')).toBe(false)
  })

  it('lastEmpty 按容器重置: 页脚尾部空段 + 正文首部空段 不算连续', () => {
    // 旧实现若简单拼接两个容器, 会把这两段误判为「连续空段」
    const { doc, pool } = makeDocWithFooter(emptyPara(['正文'], 1), [''])
    const result = new QCEngine().check(doc, pool)
    expect(result.issues.some(i => i.ruleId === 'qc_003')).toBe(false)
  })

  it('变体页脚 (首页/偶数页) 同样受检', () => {
    const { doc, pool } = makeDocWithFooter(['正文'], [])
    const tn = createTextNode('')
    const p = createParagraph([tn.id])
    const tn2 = createTextNode('')
    const p2 = createParagraph([tn2.id])
    pool.addNode(tn as unknown as BaseNode)
    pool.addNode(p as unknown as BaseNode)
    pool.addNode(tn2 as unknown as BaseNode)
    pool.addNode(p2 as unknown as BaseNode)
    doc.firstPageFooter = [p.id, p2.id]

    const result = new QCEngine().check(doc, pool)
    expect(result.issues.some(i => i.ruleId === 'qc_003')).toBe(true)
  })

  it('非段落块不再被误判为空段: 空段-表格-空段 不产生假阳性', () => {
    const doc = createDocument('测试')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)
    const mk = (t: string): string => {
      const tn = createTextNode(t)
      const p = createParagraph([tn.id])
      all.set(tn.id, tn as unknown as BaseNode)
      all.set(p.id, p as unknown as BaseNode)
      return p.id
    }
    const empty1 = mk('')
    const empty2 = mk('')

    // 表格块 (无 text → 旧实现误判为空段)
    const cellTn = createTextNode('单元格')
    const cellPara = createParagraph([cellTn.id])
    const table = { type: 'table', id: 'tbl-dbg', columns: [], children: [] } as unknown as BaseNode
    all.set(cellTn.id, cellTn as unknown as BaseNode)
    all.set(cellPara.id, cellPara as unknown as BaseNode)
    all.set(table.id, table)

    doc.body.children = [empty1, table.id, empty2]
    const pool = buildNodePool(all, { body: doc.id })

    const result = new QCEngine().check(doc, pool)
    expect(result.issues.some(i => i.ruleId === 'qc_003')).toBe(false)
  })

  it('正文连续空段仍照常触发 (无回归)', () => {
    const { doc, pool } = makeDocWithFooter(['段落1', '', ''], [])
    const result = new QCEngine().check(doc, pool)
    expect(result.issues.some(i => i.ruleId === 'qc_003')).toBe(true)
  })
})
