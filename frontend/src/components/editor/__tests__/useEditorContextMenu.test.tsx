// ================================================================
// useEditorContextMenu — 设计模式控件右键「属性」(契约 §12.7)
//
// 验证:
//   - 右键 smartText: 先 editor.selectControl(命中控件 B) 再弹菜单
//     (右键命中即选中, Word 式; Selection 与 Context 分离)。
//   - runAction('properties'): 仅对 smartText 上下文触发 onProperty(controlId)。
//   - 右键 text 仍折叠选区到命中点 (原行为不回退)。
// ================================================================

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EditorContext, type EditorContextValue } from '../EditorProvider'
import { useEditorContextMenu } from '../useEditorContextMenu'
import { EditorStore } from '@/engine/state/EditorStore'
import type { Editor, EditorContextSnapshot } from '@/engine'

function makeEditor(resolve: (e: MouseEvent) => EditorContextSnapshot) {
  const selectControl = vi.fn()
  const collapseSelectionToPoint = vi.fn()
  const focus = vi.fn()
  const editor = {
    resolveContextAt: (e: MouseEvent) => resolve(e),
    selectControl,
    collapseSelectionToPoint,
    focus,
  } as unknown as Editor
  return { editor, selectControl, collapseSelectionToPoint, focus }
}

function Harness({ onProperty }: { onProperty?: (id: string) => void }) {
  const cm = useEditorContextMenu({ onProperty })
  return (
    <div>
      <div data-testid="target" onContextMenu={cm.onContextMenu}>画布</div>
      <button onClick={() => cm.runAction('properties')}>属性</button>
    </div>
  )
}

function renderHarness(resolve: (e: MouseEvent) => EditorContextSnapshot, onProperty?: (id: string) => void) {
  const { editor, selectControl, collapseSelectionToPoint, focus } = makeEditor(resolve)
  const store = new EditorStore()
  store.setMode('design')
  const value: EditorContextValue = { editorRef: { current: editor }, ready: true, store }
  render(
    <EditorContext.Provider value={value}>
      <Harness onProperty={onProperty} />
    </EditorContext.Provider>,
  )
  return { editor, selectControl, collapseSelectionToPoint, focus }
}

const smartText = (controlId: string): EditorContextSnapshot => ({
  kind: 'smartText', controlId, pageIndex: 0, localX: 10, localY: 10,
})

describe('useEditorContextMenu — 设计模式控件属性 (契约 §12.7)', () => {
  it('右键 smartText(控件 B): 先 selectControl(B), 不折叠选区', () => {
    const onProperty = vi.fn()
    const { selectControl, collapseSelectionToPoint } = renderHarness(() => smartText('B'), onProperty)
    fireEvent.contextMenu(screen.getByTestId('target'))
    expect(selectControl).toHaveBeenCalledWith('B')
    expect(collapseSelectionToPoint).not.toHaveBeenCalled()
  })

  it('runAction("properties") → onProperty(命中 controlId)', () => {
    const onProperty = vi.fn()
    renderHarness(() => smartText('B'), onProperty)
    fireEvent.contextMenu(screen.getByTestId('target'))
    fireEvent.click(screen.getByRole('button', { name: '属性' }))
    expect(onProperty).toHaveBeenCalledWith('B')
  })

  it('右键 text(选区外) 仍折叠选区到命中点 (原行为不回退)', () => {
    const onProperty = vi.fn()
    const { selectControl, collapseSelectionToPoint } = renderHarness(() => ({
      kind: 'text', paragraphId: 'p1', paragraphPath: ['doc', 'p1'], offset: 3,
      scope: { type: 'body' }, coversSelection: false, pageIndex: 0, localX: 5, localY: 5,
    }), onProperty)
    fireEvent.contextMenu(screen.getByTestId('target'))
    expect(collapseSelectionToPoint).toHaveBeenCalledWith(['doc', 'p1'], 3)
    expect(selectControl).not.toHaveBeenCalled()
    // text 上下文点「属性」不触发 onProperty
    fireEvent.click(screen.getByRole('button', { name: '属性' }))
    expect(onProperty).not.toHaveBeenCalled()
  })
})
