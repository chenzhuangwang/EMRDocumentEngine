import { describe, it, expect } from 'vitest'
import { DocumentDiffer } from '../DocumentDiffer'
import { MergeMatrix } from '../document/MergeMatrix'
import { NodePool, buildNodePool, traversePool } from '../document/NodePool'
import { createDocument, createParagraph, createTextNode } from '../document/ElementFormatter'
import type { DocumentTree, BaseNode } from '../document/DocumentModel'
import { parseVersion, compareVersions } from '../document/ModelUpgrader'
import { LRUMap } from '../layout/viewport/MemoryManager'
import { sanitizeHtml, isSafeHtml } from '../security/SecurityConfig'
import { PrintHistoryService } from '../../services/PrintHistoryService'

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

// ---- PrintHistoryService ----

describe('PrintHistoryService', () => {
  it('should add and retrieve records', () => {
    const s = new PrintHistoryService()
    s.addRecord({ id:'ph1',documentId:'d1',documentTitle:'Test',printedAt:Date.now(),pageRange:{start:1,end:5},copies:1,duplex:false,completed:true })
    expect(s.getHistory().length).toBe(1)
    expect(s.getHistory()[0].documentTitle).toBe('Test')
  })

  it('should find incomplete print', () => {
    const s = new PrintHistoryService()
    s.addRecord({ id:'ph2',documentId:'d2',documentTitle:'T2',printedAt:Date.now(),pageRange:{start:1,end:10},copies:2,duplex:true,completed:false,lastCompletedPage:7 })
    expect(s.findIncomplete()).not.toBeNull()
    expect(s.findIncomplete()!.lastCompletedPage).toBe(7)
  })

  it('should update record', () => {
    const s = new PrintHistoryService()
    s.addRecord({ id:'ph3',documentId:'d3',documentTitle:'T3',printedAt:Date.now(),pageRange:{start:1,end:3},copies:1,duplex:false,completed:false })
    s.updateRecord('ph3', { completed: true })
    expect(s.getHistory()[0].completed).toBe(true)
  })

  it('should clear history', () => {
    const s = new PrintHistoryService()
    s.addRecord({ id:'ph4',documentId:'d4',documentTitle:'T4',printedAt:Date.now(),pageRange:{start:1,end:1},copies:1,duplex:false,completed:true })
    s.clear()
    expect(s.getHistory().length).toBe(0)
  })
})
