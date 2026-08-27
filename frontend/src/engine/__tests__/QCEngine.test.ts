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

  for (const t of texts) {
    const para = createParagraph()
    const tn = createTextNode(t)
    para.children = [tn.id]
    doc.body.children.push(para.id)
    allNodes.set(para.id, para as unknown as BaseNode)
    allNodes.set(tn.id, tn as unknown as BaseNode)
  }

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
