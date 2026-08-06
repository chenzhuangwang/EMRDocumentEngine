// ============================================================
// TOCGenerator + DirtyTracker 测试 (R95)
// ============================================================

import { describe, it, expect } from 'vitest'
import { TOCGenerator } from '../render/TOCGenerator'
import { DirtyTracker } from '../layout/DirtyTracker'
import { NodePool, buildNodePool } from '../document/NodePool'
import type { DocumentTree, BaseNode, Paragraph } from '../document/DocumentModel'

// ---- TOCGenerator ----

describe('TOCGenerator', () => {
  function makeDocWithHeadings(): { doc: DocumentTree; pool: NodePool } {
    const doc: DocumentTree = {
      type: 'document', id: 'doc1', title: 'Test',
      body: { mode: 'flow', children: ['p1', 'p2', 'p3'] },
      header: [], footer: [],
      pageSetup: { width: 794, height: 1123, marginTop: 72, marginBottom: 72, marginLeft: 90, marginRight: 90, orientation: 'portrait' },
    }

    const allNodes = new Map<string, BaseNode>()
    allNodes.set('doc1', doc as unknown as BaseNode)

    const p1: Paragraph = {
      type: 'paragraph', id: 'p1', children: ['t1'],
      outlineLevel: 1, alignment: 'left',
    }
    const p2: Paragraph = {
      type: 'paragraph', id: 'p2', children: ['t2'],
      outlineLevel: 2,
    }
    const p3: Paragraph = {
      type: 'paragraph', id: 'p3', children: ['t3'],
      outlineLevel: 0, // 正文, 不提取
    }

    allNodes.set('p1', p1 as unknown as BaseNode)
    allNodes.set('p2', p2 as unknown as BaseNode)
    allNodes.set('p3', p3 as unknown as BaseNode)
    allNodes.set('t1', { type: 'text', id: 't1', text: '第一章' } as unknown as BaseNode)
    allNodes.set('t2', { type: 'text', id: 't2', text: '第一节' } as unknown as BaseNode)
    allNodes.set('t3', { type: 'text', id: 't3', text: '正文内容' } as unknown as BaseNode)

    return { doc, pool: buildNodePool(allNodes, { body: 'doc1' }) }
  }

  it('should extract heading entries', () => {
    const { doc, pool } = makeDocWithHeadings()
    const gen = new TOCGenerator({ maxLevel: 6 })
    const entries = gen.extractEntries(doc, pool)
    expect(entries.length).toBe(2) // p1(level 1) + p2(level 2), p3 是正文
    expect(entries[0].text).toBe('第一章')
    expect(entries[0].level).toBe(1)
    expect(entries[1].text).toBe('第一节')
    expect(entries[1].level).toBe(2)
  })

  it('should respect maxLevel config', () => {
    const { doc, pool } = makeDocWithHeadings()
    const gen = new TOCGenerator({ maxLevel: 1 })
    const entries = gen.extractEntries(doc, pool)
    expect(entries.length).toBe(1) // only p1
  })
})

// ---- DirtyTracker ----

describe('DirtyTracker', () => {
  it('should start clean', () => {
    const dt = new DirtyTracker()
    expect(dt.isParagraphDirty('p1')).toBe(false)
  })

  it('should mark paragraph dirty', () => {
    const dt = new DirtyTracker()
    dt.markParagraphDirty('p1')
    expect(dt.isParagraphDirty('p1')).toBe(true)
  })

  it('should clear all dirty marks', () => {
    const dt = new DirtyTracker()
    dt.markParagraphDirty('p1')
    dt.markParagraphDirty('p2')
    dt.clear()
    expect(dt.isParagraphDirty('p1')).toBe(false)
    expect(dt.isParagraphDirty('p2')).toBe(false)
  })

  it('should mark full layout dirty', () => {
    const dt = new DirtyTracker()
    dt.markFullLayout()
    expect(dt.isFullDocument()).toBe(true)
  })

  it('should check needsFullLayout', () => {
    const dt = new DirtyTracker()
    expect(dt.needsFullLayout).toBe(false)
    dt.markFullLayout()
    expect(dt.needsFullLayout).toBe(true)
  })

  it('should get dirty node IDs', () => {
    const dt = new DirtyTracker()
    dt.markParagraphDirty('p1')
    dt.markParagraphDirty('p2')
    expect(dt.hasDirtyParagraphs()).toBe(true)
  })
})

// ---- TOCGenerator extended ----

describe('TOCGenerator extended', () => {
  it('should return empty for doc without headings', () => {
    const doc = { type:'document',id:'d1',title:'T',body:{mode:'flow' as const,children:[]},header:[],footer:[],pageSetup:{width:794,height:1123,marginTop:72,marginBottom:72,marginLeft:90,marginRight:90,orientation:'portrait' as const}} as DocumentTree
    const allNodes = new Map<string,import('../document/DocumentModel').BaseNode>()
    allNodes.set('d1', doc as unknown as import('../document/DocumentModel').BaseNode)
    const pool = buildNodePool(allNodes, {body:'d1'})
    const gen = new TOCGenerator()
    expect(gen.extractEntries(doc, pool).length).toBe(0)
  })

  it('should use default maxLevel', () => {
    const gen = new TOCGenerator()
    expect(gen).toBeDefined()
  })
})
