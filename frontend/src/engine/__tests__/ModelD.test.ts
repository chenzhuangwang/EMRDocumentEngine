// ============================================================
// DocumentModel + tree-utils 单元测试 (ModelD)
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  createDocument, createPage, createParagraph, createTextNode,
  createSmartTextNode, createFlowBody, createSimpleTable,
  traverse, findById, findByDE, findByInternal,
  insertAt, removeAt, cloneWithNewIds,
  takeSnapshot, restoreSnapshot, UndoRedoStack,
} from '../document/ElementFormatter'
import { NodeType } from '../document/DocumentModel'
import type { DocumentTree, SmartTextNode } from '../document/DocumentModel'

describe('ModelD factory', () => {
  it('should create a document with defaults', () => {
    const doc = createDocument('测试文档')
    expect(doc.id).toBeTruthy()
    expect(doc.title).toBe('测试文档')
    expect(doc.pages.length).toBe(1)
    const body = doc.pages[0].body as any
    expect(body.mode).toBe('flow')
    expect(body.children.length).toBe(1)
    expect(body.children[0].type).toBe(NodeType.PARAGRAPH)
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
    expect(t.children.length).toBe(3)
    expect(t.children[0].children.length).toBe(4)
    expect(t.children[0].children[0].children[0].type).toBe(NodeType.PARAGRAPH)
  })
})

describe('ModelD traverse & find', () => {
  function makeDoc(): DocumentTree {
    const st = createSmartTextNode('张三', {
      code: { internal: 'HDSD00.01.001', dataElement: 'DE01.00.001.00' },
      name: '患者姓名',
    })
    const txt = createTextNode('，')
    const st2 = createSmartTextNode('男', {
      code: { internal: 'HDSD00.01.002', dataElement: 'DE01.00.002.00' },
      name: '性别',
    })
    const para = createParagraph([st, txt, st2])
    const page = createPage([], createFlowBody([para]))
    return createDocument('测试', [page])
  }

  it('should traverse all nodes', () => {
    const doc = makeDoc()
    const ids: string[] = []
    traverse(doc, (node) => {
      if (node && typeof node === 'object' && 'id' in (node as any)) ids.push((node as any).id)
    })
    expect(ids.length).toBeGreaterThan(5)
  })

  it('should find by id', () => {
    const doc = makeDoc()
    const st = doc.pages[0].body && typeof doc.pages[0].body === 'object'
      ? (doc.pages[0].body as any).children[0].children[0]
      : null
    expect(st).toBeTruthy()
    const found = findById(doc, st.id)
    expect(found).toBeTruthy()
    expect((found!.node as SmartTextNode).element.code.dataElement).toBe('DE01.00.001.00')
  })

  it('should find by DE code', () => {
    const doc = makeDoc()
    const results = findByDE(doc, 'DE01.00.002.00')
    expect(results.length).toBe(1)
    expect(results[0].text).toBe('男')
  })

  it('should find by internal code', () => {
    const doc = makeDoc()
    const results = findByInternal(doc, 'HDSD00.01.001')
    expect(results.length).toBe(1)
    expect(results[0].text).toBe('张三')
  })

  it('should return empty for non-existent DE code', () => {
    const doc = makeDoc()
    expect(findByDE(doc, 'NOT_EXIST').length).toBe(0)
  })
})

describe('ModelD tree manipulation', () => {
  it('should insert and remove nodes', () => {
    const doc = createDocument('测试')
    const flow = (doc.pages[0].body as any)
    const para = flow.children[0] as any
    const initialLen = para.children.length

    // Insert text node at end of paragraph children
    const tn = createTextNode('hello')
    // Path: pages[0].body.children[0].children[initialLen]
    const ok = insertAt(doc, [
      { container: 'pages', index: 0 },
      { container: 'body', index: 0 },
      { container: 'children', index: initialLen },
    ], tn)
    expect(ok).toBe(true)
    expect(para.children.length).toBe(initialLen + 1)

    // Remove it
    const rmOk = removeAt(doc, [
      { container: 'pages', index: 0 },
      { container: 'body', index: 0 },
      { container: 'children', index: initialLen },
    ])
    expect(rmOk).toBe(true)
    expect(para.children.length).toBe(initialLen)
  })

  it('should return false for invalid insert path', () => {
    const doc = createDocument('测试')
    expect(insertAt(doc, [], createTextNode('x'))).toBe(false)
  })
})

describe('ModelD clone & snapshot', () => {
  it('should deep clone with new IDs', () => {
    const doc = createDocument('原文档')
    const cloned = cloneWithNewIds(doc)
    expect(cloned.id).not.toBe(doc.id)
    expect(cloned.pages[0].id).not.toBe(doc.pages[0].id)
    expect(cloned.title).toBe('原文档')
  })

  it('should take and restore snapshots', () => {
    const doc = createDocument('快照测试')
    const snap = takeSnapshot(doc)
    const restored = restoreSnapshot(snap)
    expect(restored.title).toBe('快照测试')
    expect(restored.pages.length).toBe(1)
  })

  it('UndoRedoStack should undo and redo', () => {
    const stack = new UndoRedoStack(50)
    stack.push('S0') // initial state before any edit
    stack.push('S1') // state before edit 1
    stack.push('S2') // state before edit 2
    expect(stack.canUndo).toBe(true)
    // undo should restore to S2 (state before last edit)
    expect(stack.undo('S3')).toBe('S2')
    // undo again should restore to S1
    expect(stack.undo('S2')).toBe('S1')
    // redo should restore to S2
    expect(stack.redo('S1')).toBe('S2')
  })
})
