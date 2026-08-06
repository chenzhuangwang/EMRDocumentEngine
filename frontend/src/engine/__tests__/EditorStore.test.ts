// ============================================================
// EditorStore smoke test (R92)
// ============================================================

import { describe, it, expect } from 'vitest'
import { EditorStore } from '../state/EditorStore'
import { createDocument } from '../document/ElementFormatter'

describe('EditorStore', () => {
  it('should initialize with default state', () => {
    const doc = createDocument('测试')
    const store = new EditorStore(doc)
    expect(store.state.isDirty).toBe(false)
    expect(store.state.saveStatus).toBe('saved')
    expect(store.state.runtime.view.mode).toBe('edit')
  })

  it('should set dirty state', () => {
    const doc = createDocument('测试')
    const store = new EditorStore(doc)
    store.setDirty(true)
    expect(store.state.isDirty).toBe(true)
  })

  it('should update save status', () => {
    const doc = createDocument('测试')
    const store = new EditorStore(doc)
    store.setSaveStatus('saving')
    expect(store.state.saveStatus).toBe('saving')
    store.setSaveStatus('error')
    expect(store.state.saveStatus).toBe('error')
  })

  it('should update runtime cursor', () => {
    const doc = createDocument('测试')
    const store = new EditorStore(doc)
    store.updateRuntime({
      cursor: { paragraphPath: ['doc1', 'para1'], offset: 5, visible: true },
    })
    expect(store.state.runtime.cursor.paragraphPath).toEqual(['doc1', 'para1'])
    expect(store.state.runtime.cursor.offset).toBe(5)
  })
})
