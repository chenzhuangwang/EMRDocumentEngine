// ============================================================
// Extended edge case + utility tests (Target: 200)
// ============================================================

import { describe, it, expect } from 'vitest'
import { DocumentDiffer } from '../DocumentDiffer'
import { MergeMatrix } from '../document/MergeMatrix'
import { NodePool, buildNodePool, traversePool } from '../document/NodePool'
import { createDocument, createParagraph, createTextNode } from '../document/ElementFormatter'
import type { DocumentTree, BaseNode } from '../document/DocumentModel'
import { parseVersion, compareVersions } from '../document/ModelUpgrader'
import { LRUMap } from '../layout/MemoryManager'
import { sanitizeHtml, isSafeHtml } from '../security/SecurityConfig'

function makeDoc(texts: string[]): { doc: DocumentTree; pool: NodePool } {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  for (const t of texts) {
    const p = createParagraph([createTextNode(t).id])
    doc.body.children.push(p.id)
    allNodes.set(p.id, p as unknown as BaseNode)
    allNodes.set(p.children[0], createTextNode(t) as unknown as BaseNode)
  }
  return { doc, pool: buildNodePool(allNodes, { body: doc.id }) }
}

// ---- DocumentDiffer edge cases ----

describe('DocumentDiffer extended', () => {
  const differ = new DocumentDiffer()

  it('should detect empty doc vs doc with content', () => {
    const a = makeDoc([])
    const b = makeDoc(['新内容'])
    const diffs = differ.compare(a.doc, a.pool, b.doc, b.pool)
    expect(diffs.some(d => d.op === 'insert')).toBe(true)
  })

  it('should detect doc with content vs empty doc', () => {
    const a = makeDoc(['内容'])
    const b = makeDoc([])
    const diffs = differ.compare(a.doc, a.pool, b.doc, b.pool)
    expect(diffs.some(d => d.op === 'delete')).toBe(true)
  })

  it('should detect multi-paragraph insertion', () => {
    const a = makeDoc(['p1', 'p2'])
    const b = makeDoc(['p1', 'new1', 'new2', 'p2'])
    const diffs = differ.compare(a.doc, a.pool, b.doc, b.pool)
    expect(diffs.filter(d => d.op === 'insert').length).toBe(2)
  })

  it('should handle complete replacement', () => {
    const a = makeDoc(['旧1', '旧2'])
    const b = makeDoc(['新1', '新2'])
    const diffs = differ.compare(a.doc, a.pool, b.doc, b.pool)
    // 全部不同: 2 delete + 2 insert = 4 or 2 modify
    expect(diffs.length).toBeGreaterThan(0)
  })
})

// ---- MergeMatrix extended ----

describe('MergeMatrix extended', () => {
  it('should handle single cell table', () => {
    const m = new MergeMatrix(1, 1)
    expect(m.placeCell('a', 0, 0)).toBe(true)
    expect(m.getCell(0, 0)).toBe('a')
  })

  it('should reject out-of-bounds placement', () => {
    const m = new MergeMatrix(2, 2)
    expect(m.placeCell('x', 2, 0)).toBe(false)
    expect(m.placeCell('x', 0, 2)).toBe(false)
  })

  it('should reject colspan exceeding bounds', () => {
    const m = new MergeMatrix(2, 2)
    expect(m.placeCell('wide', 0, 0, 3, 1)).toBe(false)
  })

  it('should return null for out-of-bounds getCell', () => {
    const m = new MergeMatrix(2, 2)
    expect(m.getCell(5, 0)).toBeNull()
    expect(m.getCell(0, 5)).toBeNull()
  })
})

// ---- LRUMap extended ----

describe('LRUMap extended', () => {
  it('should update existing key without eviction', () => {
    const cache = new LRUMap<string, number>(3)
    cache.set('a', 1); cache.set('b', 2); cache.set('a', 10)
    expect(cache.get('a')).toBe(10)
    expect(cache.size).toBe(2)
  })

  it('should handle clear and reuse', () => {
    const cache = new LRUMap<string, number>(5)
    cache.set('a', 1); cache.set('b', 2)
    cache.clear()
    expect(cache.size).toBe(0)
    cache.set('c', 3)
    expect(cache.get('c')).toBe(3)
  })

  it('should delete and not find', () => {
    const cache = new LRUMap<string, number>(5)
    cache.set('a', 1)
    expect(cache.delete('a')).toBe(true)
    expect(cache.get('a')).toBeUndefined()
  })
})

// ---- Security extended ----

describe('Security extended', () => {
  it('should sanitize embed tags', () => {
    const result = sanitizeHtml('<embed src="evil.swf">')
    expect(result).not.toContain('embed')
  })

  it('should sanitize object tags', () => {
    const result = sanitizeHtml('<object data="evil"></object>')
    expect(result).not.toContain('<object')
  })

  it('should accept simple safe HTML', () => {
    expect(isSafeHtml('<p>Hello <b>world</b></p>')).toBe(true)
    expect(isSafeHtml('<div class="safe">text</div>')).toBe(true)
  })
})

// ---- Version utils ----

describe('Version utils', () => {
  it('should compare patch versions', () => {
    expect(compareVersions('4.0.1', '4.0.0')).toBeGreaterThan(0)
    expect(compareVersions('4.0.0', '4.0.1')).toBeLessThan(0)
  })

  it('should parse version with zeros', () => {
    expect(parseVersion('0.0.0')).toEqual({ major: 0, minor: 0, patch: 0 })
    expect(parseVersion('1.0.0')).toEqual({ major: 1, minor: 0, patch: 0 })
  })
})

// ---- NodePool edge ----

describe('NodePool edge cases', () => {
  function poolWithNodes(texts: string[]): { pool: NodePool; doc: DocumentTree } {
    const { doc, pool } = makeDoc(texts)
    return { pool, doc }
  }

  it('should traverse pool correctly', () => {
    const { pool, doc } = poolWithNodes(['hello'])
    const ids: string[] = []
    traversePool(pool, doc.id, (node) => ids.push(node.id))
    expect(ids.length).toBeGreaterThan(0)
    expect(ids[0]).toBe(doc.id)
  })
})
