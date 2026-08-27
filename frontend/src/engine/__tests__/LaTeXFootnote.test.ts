// ============================================================
// LaTeX tokenizer + FootnoteLayout 测试 (R93-R94)
// ============================================================

import { describe, it, expect } from 'vitest'
import { tokenize, type LaTeXToken } from '../render/particles/LaTeXParticle'
import { FootnoteLayout } from '../layout/footnote/FootnoteLayout'
import { NodePool, buildNodePool } from '../document/NodePool'
import type { BaseNode } from '../document/DocumentModel'
import type { SLIFPage } from '../layout/core/SLIF'

// ---- LaTeX Tokenizer ----

describe('LaTeX tokenizer', () => {
  it('should tokenize plain text', () => {
    const tokens = tokenize('hello')
    expect(tokens.length).toBe(5) // h,e,l,l,o — 逐字符
    expect(tokens.every(t => t.type === 'text')).toBe(true)
  })

  it('should tokenize Greek letters', () => {
    const tokens = tokenize('\\alpha')
    expect(tokens).toEqual([{ type: 'text', value: 'α' }])
  })

  it('should tokenize superscript', () => {
    const tokens = tokenize('x^{2}')
    expect(tokens.some(t => t.type === 'sup' && t.value === '2')).toBe(true)
  })

  it('should tokenize subscript', () => {
    const tokens = tokenize('x_{1}')
    expect(tokens.some(t => t.type === 'sub' && t.value === '1')).toBe(true)
  })

  it('should tokenize fraction', () => {
    const tokens = tokenize('\\frac{a}{b}')
    const frac = tokens.find(t => t.type === 'frac') as Extract<LaTeXToken, { type: 'frac' }> | undefined
    expect(frac).toBeDefined()
    expect(frac!.num).toBe('a')
    expect(frac!.den).toBe('b')
  })

  it('should tokenize square root', () => {
    const tokens = tokenize('\\sqrt{x}')
    const sqrt = tokens.find(t => t.type === 'sqrt') as Extract<LaTeXToken, { type: 'sqrt' }> | undefined
    expect(sqrt).toBeDefined()
    expect(sqrt!.inner).toBe('x')
  })

  it('should tokenize \\infty symbol', () => {
    const tokens = tokenize('\\infty')
    expect(tokens).toEqual([{ type: 'text', value: '∞' }])
  })
})

// ---- FootnoteLayout ----

describe('FootnoteLayout', () => {
  function makePageWithFootnote(footnoteRefId: string, footnoteContentId: string): { page: SLIFPage; pool: NodePool } {
    const page: SLIFPage = {
      pageIndex: 0, width: 794, height: 1123,
      items: [{
        nodeId: footnoteRefId, nodeType: 'footnote_ref', type: 'footnote',
        x: 90, y: 100, width: 600, height: 20,
        ascent: 14, descent: 6, font: 'SimSun', size: 16,
        text: '1',
      }],
    }

    const allNodes = new Map<string, BaseNode>()
    // 文档根节点 (NodePool 需要)
    allNodes.set('doc1', {
      type: 'document' as const, id: 'doc1', title: 'test',
      body: { mode: 'flow' as const, children: [] },
      header: [], footer: [],
      pageSetup: { width: 794, height: 1123, marginTop: 72, marginBottom: 72, marginLeft: 90, marginRight: 90, orientation: 'portrait' as const },
    } as unknown as BaseNode)
    allNodes.set(footnoteRefId, {
      type: 'footnote_ref' as const, id: footnoteRefId, footnoteId: footnoteContentId,
    } as unknown as BaseNode)
    allNodes.set(footnoteContentId, {
      type: 'footnote_content' as const, id: footnoteContentId, refId: footnoteRefId,
      children: [],
    } as unknown as BaseNode)

    return { page, pool: buildNodePool(allNodes, { body: 'doc1' }) }
  }

  it('should collect footnotes from page', () => {
    const { page, pool } = makePageWithFootnote('ref1', 'content1')
    const layout = new FootnoteLayout()
    const entries = layout.collectFootnotes(page, pool)
    expect(entries.length).toBe(1)
    expect(entries[0].number).toBe(1)
  })

  it('should generate footnote items', () => {
    const { page, pool } = makePageWithFootnote('ref1', 'content1')
    const layout = new FootnoteLayout()
    const entries = layout.collectFootnotes(page, pool)
    const items = layout.generateFootnoteItems(entries, 1000, 600, 90)
    expect(items.length).toBeGreaterThan(0)
    // 第一个是 separator
    expect(items[0].type).toBe('separator')
  })

  it('should calculate footnote height', () => {
    const { page, pool } = makePageWithFootnote('ref1', 'content1')
    const layout = new FootnoteLayout()
    const entries = layout.collectFootnotes(page, pool)
    const h = layout.calculateFootnoteHeight(entries)
    expect(h).toBeGreaterThan(0)
  })

  it('should reset counter', () => {
    const { page, pool } = makePageWithFootnote('ref1', 'content1')
    const layout = new FootnoteLayout()
    layout.collectFootnotes(page, pool)
    expect(layout.currentNumber).toBe(1)
    layout.resetCounter()
    expect(layout.currentNumber).toBe(0)
  })
})
