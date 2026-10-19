// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

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
import { EditorStore } from '@emrde/document-engine'
import type { Editor, EditorContextSnapshot } from '@emrde/document-engine'

function makeEditor(resolve: (e: MouseEvent) => EditorContextSnapshot) {
  const selectControl = vi.fn()
  const collapseSelectionToPoint = vi.fn()
  const focus = vi.fn()
  const acceptRevisions = vi.fn()
  const rejectRevisions = vi.fn()
  const editor = {
    resolveContextAt: (e: MouseEvent) => resolve(e),
    selectControl,
    collapseSelectionToPoint,
    focus,
    acceptRevisions,
    rejectRevisions,
  } as unknown as Editor
  return { editor, selectControl, collapseSelectionToPoint, focus, acceptRevisions, rejectRevisions }
}

function Harness({ onProperty }: { onProperty?: (id: string) => void }) {
  const cm = useEditorContextMenu({ onProperty })
  return (
    <div>
      <div data-testid="target" onContextMenu={cm.onContextMenu}>画布</div>
      <button onClick={() => cm.runAction('properties')}>属性</button>
      <button onClick={() => cm.runAction('acceptDeleteRevision')}>接受删除</button>
      <button onClick={() => cm.runAction('rejectInsertRevision')}>拒绝插入</button>
      <button onClick={() => cm.close()}>关闭</button>
    </div>
  )
}

function renderHarness(resolve: (e: MouseEvent) => EditorContextSnapshot, onProperty?: (id: string) => void) {
  const { editor, selectControl, collapseSelectionToPoint, focus, acceptRevisions, rejectRevisions } = makeEditor(resolve)
  const store = new EditorStore()
  store.setMode('design')
  const value: EditorContextValue = { editorRef: { current: editor }, ready: true, store }
  render(
    <EditorContext.Provider value={value}>
      <Harness onProperty={onProperty} />
    </EditorContext.Provider>,
  )
  return { editor, selectControl, collapseSelectionToPoint, focus, acceptRevisions, rejectRevisions }
}

const smartText = (controlId: string): EditorContextSnapshot => ({
  kind: 'smartText', controlId, pageIndex: 0, localX: 10, localY: 10, sectionFact: null,
})

describe('useEditorContextMenu — 设计模式控件属性 (契约 §12.7)', () => {
  it('右键 smartText(控件 B): 先 selectControl(B), 不折叠选区', () => {
    const onProperty = vi.fn()
    const { selectControl, collapseSelectionToPoint } = renderHarness(() => smartText('B'), onProperty)
    fireEvent.contextMenu(screen.getByTestId('target'))
    expect(selectControl).toHaveBeenCalledWith('B')
    expect(collapseSelectionToPoint).not.toHaveBeenCalled()
  })

  it('右键控件后关闭菜单(未走属性) → 清除选中 (selectControl(null))', () => {
    const { selectControl } = renderHarness(() => smartText('B'))
    fireEvent.contextMenu(screen.getByTestId('target'))
    selectControl.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(selectControl).toHaveBeenCalledWith(null)
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
      sectionFact: null, revisionFact: null,
    }), onProperty)
    fireEvent.contextMenu(screen.getByTestId('target'))
    expect(collapseSelectionToPoint).toHaveBeenCalledWith(['doc', 'p1'], 3)
    expect(selectControl).not.toHaveBeenCalled()
    // text 上下文点「属性」不触发 onProperty
    fireEvent.click(screen.getByRole('button', { name: '属性' }))
    expect(onProperty).not.toHaveBeenCalled()
  })
})

// ================================================================
// 逐处接受/拒绝修订 (契约 §12.13)
//
// 分派只做一件事: 把快照 revisionFact 里的 nodeId 交给 Engine 的
// acceptRevisions / rejectRevisions (它们走 RevisionDecisionCommand)。
// ================================================================

function revisionTextSnapshot(revisionFact: {
  nodeId: string; type: 'insert' | 'delete' | 'modify'; author?: string; at?: number
} | null): EditorContextSnapshot {
  return {
    kind: 'text', paragraphId: 'p1', paragraphPath: ['doc', 'p1'], offset: 3,
    scope: { type: 'body' }, coversSelection: false, pageIndex: 0, localX: 5, localY: 5,
    sectionFact: null, revisionFact,
  }
}

describe('useEditorContextMenu — 逐处接受/拒绝修订 (§12.13)', () => {
  it('接受删除 → acceptRevisions([命中节点]), 并把焦点交还编辑器', () => {
    const { acceptRevisions, rejectRevisions, focus } = renderHarness(
      () => revisionTextSnapshot({ nodeId: 't-del', type: 'delete' }),
    )
    fireEvent.contextMenu(screen.getByTestId('target'))
    fireEvent.click(screen.getByRole('button', { name: '接受删除' }))
    expect(acceptRevisions).toHaveBeenCalledWith(['t-del'])
    expect(rejectRevisions).not.toHaveBeenCalled()
    // 菜单关闭后必须恢复焦点, 否则容器级快捷键 (Ctrl+Z) 失效
    expect(focus).toHaveBeenCalled()
  })

  it('拒绝插入 → rejectRevisions([命中节点])', () => {
    const { acceptRevisions, rejectRevisions } = renderHarness(
      () => revisionTextSnapshot({ nodeId: 't-ins', type: 'insert' }),
    )
    fireEvent.contextMenu(screen.getByTestId('target'))
    fireEvent.click(screen.getByRole('button', { name: '拒绝插入' }))
    expect(rejectRevisions).toHaveBeenCalledWith(['t-ins'])
    expect(acceptRevisions).not.toHaveBeenCalled()
  })

  it('cell 命中带修订 → 同样按 revisionFact 派发', () => {
    const { acceptRevisions } = renderHarness(() => ({
      kind: 'cell', tableId: 'tbl', row: 0, col: 0,
      paragraphId: 'p1', paragraphPath: ['doc', 'p1'], offset: 3,
      coversSelection: false, tableGrowable: false, pageIndex: 0, localX: 5, localY: 5,
      sectionFact: null, revisionFact: { nodeId: 't-cell', type: 'delete' },
    }))
    fireEvent.contextMenu(screen.getByTestId('target'))
    fireEvent.click(screen.getByRole('button', { name: '接受删除' }))
    expect(acceptRevisions).toHaveBeenCalledWith(['t-cell'])
  })

  it('快照没有修订事实 → 动作不发任何命令 (防误伤普通文字)', () => {
    const { acceptRevisions, rejectRevisions } = renderHarness(
      () => revisionTextSnapshot(null),
    )
    fireEvent.contextMenu(screen.getByTestId('target'))
    fireEvent.click(screen.getByRole('button', { name: '接受删除' }))
    fireEvent.click(screen.getByRole('button', { name: '拒绝插入' }))
    expect(acceptRevisions).not.toHaveBeenCalled()
    expect(rejectRevisions).not.toHaveBeenCalled()
  })
})
