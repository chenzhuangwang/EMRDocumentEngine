// ============================================================
// EditorStore smoke test (R92)
// ============================================================

import { describe, it, expect } from 'vitest'
import { EditorStore } from '../state/EditorStore'
import { createDocument } from '../document/factory/ElementFormatter'

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

  it('onCursorOrSelectionChange 在 setCursor/setSelection/updateSelection 触发', () => {
    const doc = createDocument('测试')
    const store = new EditorStore(doc)
    let count = 0
    store.onCursorOrSelectionChange(() => { count++ })

    store.setCursor({ paragraphPath: ['d', 'p'], offset: 1, visible: true })
    expect(count).toBe(1)

    store.setSelection({
      anchor: { paragraphPath: ['d', 'p'], offset: 0, visible: false },
      focus: { paragraphPath: ['d', 'p'], offset: 2, visible: false },
      active: true,
      granularity: 'character',
    })
    expect(count).toBe(2)

    store.updateSelection({ active: false })
    expect(count).toBe(3)
  })

  it('onCursorOrSelectionChange 不因 setCursorVisible / setTextStyle 触发', () => {
    const doc = createDocument('测试')
    const store = new EditorStore(doc)
    let count = 0
    store.onCursorOrSelectionChange(() => { count++ })

    store.setCursorVisible(false)  // 光标闪烁路径, 不应触发
    expect(count).toBe(0)

    store.setTextStyle({ bold: true })  // 投影写入, 不应触发 (防回环)
    expect(count).toBe(0)
  })
})
