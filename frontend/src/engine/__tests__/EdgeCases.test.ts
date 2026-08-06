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
describe('DocumentDiffer edge', () => {
  const diff = new DocumentDiffer()
  it('empty→content = insert', () => {
    const a = makeDoc([]); const b = makeDoc(['新'])
    expect(diff.compare(a.doc, a.pool, b.doc, b.pool).some(d => d.op === 'insert')).toBe(true)
  })
  it('content→empty = delete', () => {
    const a = makeDoc(['旧']); const b = makeDoc([])
    expect(diff.compare(a.doc, a.pool, b.doc, b.pool).some(d => d.op === 'delete')).toBe(true)
  })
  it('multi insert between paragraphs', () => {
    const a = makeDoc(['a','d']); const b = makeDoc(['a','b','c','d'])
    expect(diff.compare(a.doc, a.pool, b.doc, b.pool).filter(d => d.op === 'insert').length).toBe(2)
  })
})

// ---- MergeMatrix edge ----
describe('MergeMatrix edge', () => {
  it('single cell', () => { const m = new MergeMatrix(1,1); expect(m.placeCell('x',0,0)).toBe(true) })
  it('reject out-of-bounds', () => { expect(new MergeMatrix(2,2).placeCell('x',2,0)).toBe(false) })
  it('reject colspan overflow', () => { expect(new MergeMatrix(2,2).placeCell('x',0,0,3,1)).toBe(false) })
  it('null for out-of-bounds getCell', () => { expect(new MergeMatrix(2,2).getCell(5,0)).toBeNull() })
})

// ---- LRUMap edge ----
describe('LRUMap edge', () => {
  it('update existing key', () => { const c=new LRUMap<string,number>(3); c.set('a',1); c.set('a',10); expect(c.get('a')).toBe(10); expect(c.size).toBe(1) })
  it('clear and reuse', () => { const c=new LRUMap<string,number>(5); c.set('a',1); c.clear(); c.set('b',2); expect(c.get('b')).toBe(2) })
  it('delete non-existent', () => { expect(new LRUMap<string,number>(5).delete('x')).toBe(false) })
})

// ---- Security edge ----
describe('Security edge', () => {
  it('sanitize embed', () => { expect(sanitizeHtml('<embed>')).not.toContain('embed') })
  it('sanitize object', () => { expect(sanitizeHtml('<object>')).not.toContain('<object') })
  it('accept safe HTML', () => { expect(isSafeHtml('<p>hi</p>')).toBe(true) })
})

// ---- Version edge ----
describe('Version edge', () => {
  it('patch compare', () => { expect(compareVersions('4.0.1','4.0.0')).toBeGreaterThan(0) })
  it('parse zeros', () => { expect(parseVersion('0.0.0')).toEqual({major:0,minor:0,patch:0}) })
})

// ---- NodePool edge ----
describe('NodePool edge', () => {
  function p(t: string[]) { const {doc,pool}=makeDoc(t); return {pool,doc} }
  it('traverse', () => { const {pool,doc}=p(['hi']); const ids:string[]=[]; traversePool(pool,doc.id,()=>ids.push('x')); expect(ids.length).toBeGreaterThan(0) })
})
