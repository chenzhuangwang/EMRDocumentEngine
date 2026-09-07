// ============================================================
// HeaderBar 文档标题输入 (契约 §7.7/§7.8, P2-C)
//
// 验证内联标题输入以 engine `doc.title` 为 canonical:
//   - 打开读取 store.documentTitle 展示。
//   - 编辑只改本地草稿, 不逐键提交 (不产命令)。
//   - blur 提交经 Editor.setDocumentTitle (一次)。
//   - 无变化 blur 不提交。
//   - Esc 撤销草稿回 canonical (不提交)。
//   - 外部 store.documentTitle 变化 (对话框/撤销/加载) 回同步到输入框。
// ============================================================

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { EditorContext, type EditorContextValue } from '../../editor/EditorProvider'
import { HeaderBar } from '../HeaderBar'
import { EditorStore } from '@/engine/state/EditorStore'
import type { Editor } from '@/engine'

function renderHeaderBar(initialTitle: string) {
  const store = new EditorStore()
  store.setDocumentTitle(initialTitle)
  const setDocumentTitle = vi.fn()
  const editor = { setDocumentTitle } as unknown as Editor
  const value: EditorContextValue = { editorRef: { current: editor }, ready: true, store }
  render(
    <EditorContext.Provider value={value}>
      <HeaderBar />
    </EditorContext.Provider>,
  )
  return { store, setDocumentTitle }
}

function titleInput(): HTMLInputElement {
  return screen.getByLabelText('文档标题') as HTMLInputElement
}

describe('HeaderBar 文档标题输入 (P2-C, 契约 §7.7/§7.8)', () => {
  it('打开读取 store.documentTitle 展示', () => {
    renderHeaderBar('入院记录')
    expect(titleInput().value).toBe('入院记录')
  })

  it('编辑只改草稿, 不逐键提交', () => {
    const { setDocumentTitle } = renderHeaderBar('入院记录')
    fireEvent.change(titleInput(), { target: { value: '出院' } })
    fireEvent.change(titleInput(), { target: { value: '出院小结' } })

    expect(titleInput().value).toBe('出院小结')
    expect(setDocumentTitle).not.toHaveBeenCalled()
  })

  it('blur 提交经 Editor.setDocumentTitle (一次)', () => {
    const { setDocumentTitle } = renderHeaderBar('入院记录')
    fireEvent.change(titleInput(), { target: { value: '出院小结' } })
    fireEvent.blur(titleInput())

    expect(setDocumentTitle).toHaveBeenCalledTimes(1)
    expect(setDocumentTitle).toHaveBeenCalledWith('出院小结')
  })

  it('无变化 blur 不提交', () => {
    const { setDocumentTitle } = renderHeaderBar('入院记录')
    fireEvent.blur(titleInput())
    expect(setDocumentTitle).not.toHaveBeenCalled()
  })

  it('Enter 提交 (blur 触发一次提交)', () => {
    const { setDocumentTitle } = renderHeaderBar('入院记录')
    // 聚焦使 .blur() 生效 (jsdom 仅在 activeElement 时派发 blur/focusout)
    titleInput().focus()
    fireEvent.change(titleInput(), { target: { value: '出院小结' } })
    fireEvent.keyDown(titleInput(), { key: 'Enter' })

    expect(setDocumentTitle).toHaveBeenCalledTimes(1)
    expect(setDocumentTitle).toHaveBeenCalledWith('出院小结')
  })

  it('Esc 撤销草稿回 canonical, 不提交', () => {
    const { setDocumentTitle } = renderHeaderBar('入院记录')
    fireEvent.change(titleInput(), { target: { value: '随便改' } })
    fireEvent.keyDown(titleInput(), { key: 'Escape' })

    expect(titleInput().value).toBe('入院记录')
    expect(setDocumentTitle).not.toHaveBeenCalled()
  })

  it('外部 store.documentTitle 变化回同步到输入框 (对话框/撤销/加载)', () => {
    const { store } = renderHeaderBar('入院记录')
    expect(titleInput().value).toBe('入院记录')

    act(() => { store.setDocumentTitle('对话框改的标题') })
    expect(titleInput().value).toBe('对话框改的标题')
  })
})
