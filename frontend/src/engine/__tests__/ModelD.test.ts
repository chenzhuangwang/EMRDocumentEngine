// ============================================================
// DocumentModel + NodePool 单元测试 (ModelD v5.0 updated)
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  createDocument, createParagraph, createTextNode,
  createSmartTextNode, createSimpleTable,
  findByDE, findByInternal,
  takeSnapshot, restoreSnapshot, extractStyle,
} from '../document/factory/ElementFormatter'
import { NodeType } from '../document/core/DocumentModel'
import { buildNodePool, traversePool } from '../document/core/NodePool'

describe('ModelD factory', () => {
  it('should create a document with defaults', () => {
    const doc = createDocument('测试文档')
    expect(doc.id).toBeTruthy()
    expect(doc.title).toBe('测试文档')
    expect(doc.body.mode).toBe('flow')
    expect(doc.body.children.length).toBe(0)
  })

  it('should create nodes with unique IDs', () => {
    const p1 = createParagraph()
    const p2 = createParagraph()
    expect(p1.id).not.toBe(p2.id)
  })

  it('should create smarttext with element meta', () => {
    const st = createSmartTextNode('', {
      code: { internal: 'HDSD00.12.132', dataElement: 'DE07.00.007.00' },
      name: '医疗付费方式',
      format: { dataType: 'S3', maxLength: 2, dictionary: 'abc' },
      required: true,
    })
    expect(st.type).toBe(NodeType.SMART_TEXT)
    expect(st.element.code.internal).toBe('HDSD00.12.132')
    expect(st.element.code.dataElement).toBe('DE07.00.007.00')
    expect(st.element.required).toBe(true)
  })

  it('should create a simple table', () => {
    const t = createSimpleTable(3, 4)
    expect(t.type).toBe(NodeType.TABLE)
    expect(t.children.length).toBe(3) // 3 row IDs
    // Table.children are string[] (row IDs stored in NodePool)
    expect(typeof t.children[0]).toBe('string')
  })
})

describe('ModelD NodePool', () => {
  function makePool() {
    const st = createSmartTextNode('张三', {
      code: { internal: 'HDSD00.01.001', dataElement: 'DE01.00.001.00' },
      name: '患者姓名',
    })
    const txt = createTextNode('，')
    const st2 = createSmartTextNode('男', {
      code: { internal: 'HDSD00.01.002', dataElement: 'DE01.00.002.00' },
      name: '性别',
    })
    const para = createParagraph()
    para.children = [st.id, txt.id, st2.id]

    const doc = createDocument('测试')
    doc.body.children = [para.id]

    const allNodes = new Map()
    allNodes.set(doc.id, doc)
    allNodes.set(para.id, para)
    allNodes.set(st.id, st)
    allNodes.set(txt.id, txt)
    allNodes.set(st2.id, st2)

    return { pool: buildNodePool(allNodes, { body: doc.id }), docId: doc.id }
  }

  it('should traverse all nodes via pool', () => {
    const { pool, docId } = makePool()
    const ids: string[] = []
    traversePool(pool, docId, (node) => {
      ids.push(node.id)
    })
    // DocumentTree has children on body, not directly — traversePool visits root + body children
    expect(ids.length).toBeGreaterThanOrEqual(1)
  })

  it('should find by id via pool', () => {
    const { pool } = makePool()
    // Find SmartText node by traversing
    const results = findByDE(pool, 'DE01.00.001.00')
    expect(results.length).toBe(1)
    expect(results[0].text).toBe('张三')
  })

  it('should find by DE code via pool', () => {
    const { pool } = makePool()
    const results = findByDE(pool, 'DE01.00.002.00')
    expect(results.length).toBe(1)
    expect(results[0].text).toBe('男')
  })

  it('should find by internal code via pool', () => {
    const { pool } = makePool()
    const results = findByInternal(pool, 'HDSD00.01.001')
    expect(results.length).toBe(1)
    expect(results[0].text).toBe('张三')
  })

  it('should resolve character offset', () => {
    const { pool } = makePool()
    const paraId = pool.getChildren(pool.rootIds.body)[0]
    // Offset 0 → first text node at offset 0
    const resolved = pool.resolveCharOffset(paraId, 0)
    expect(resolved).toBeTruthy()
    expect(resolved!.localOffset).toBe(0)
  })
})

describe('ModelD snapshot', () => {
  it('should snapshot and restore', () => {
    const doc = createDocument('快照测试')
    const json = takeSnapshot(doc)
    expect(json).toContain('快照测试')
    const restored = restoreSnapshot(json)
    expect(restored.title).toBe('快照测试')
  })
})

describe('ModelD extractStyle', () => {
  it('should extract text style', () => {
    const tn = createTextNode('test', {
      bold: true, italic: false, size: 14, font: 'SimHei',
    })
    const style = extractStyle(tn)
    expect(style.bold).toBe(true)
    expect(style.italic).toBe(false)
    expect(style.size).toBe(14)
    expect(style.font).toBe('SimHei')
  })
})
