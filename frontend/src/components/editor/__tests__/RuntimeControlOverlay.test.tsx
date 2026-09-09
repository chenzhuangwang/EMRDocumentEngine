// ================================================================
// RuntimeControlOverlay — 无缝内联编辑组件测试 (契约 §12.6)
// ================================================================

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EditorContext, type EditorContextValue } from '../EditorProvider'
import { RuntimeControlOverlay } from '../RuntimeControlOverlay'
import { EditorStore } from '@/engine/state/EditorStore'
import type { ControlEditTarget, ControlSnapshot, Editor } from '@/engine'

function makeTarget(over?: Partial<ControlEditTarget>): ControlEditTarget {
  return {
    textArea: { left: 100, top: 200, width: 60, height: 16, right: 160 },
    ascentCss: 12.8,
    descentCss: 3.2,
    lineAscentCss: 12.8,
    fontFamily: 'SimSun',
    fontSizeCss: 16,
    bold: false,
    italic: false,
    align: 'left',
    bracketOn: true,
    affordance: null,
    color: '#9CA3AF',
    caretColor: '#374151',
    placeholderText: '姓名',
    empty: true,
    writable: true,
    masked: false,
    ...over,
  }
}

function makeSnap(over?: Partial<ControlSnapshot>): ControlSnapshot {
  return {
    nodeId: 'n1',
    placeholder: '[姓名]',
    value: undefined,
    controlType: 'input',
    dataType: 'S1',
    showType: undefined,
    options: undefined,
    multiple: false,
    enumEditable: undefined,
    writable: true,
    minRows: undefined,
    scale: undefined,
    minLength: undefined,
    maxLength: undefined,
    masked: false,
    label: undefined,
    tips: undefined,
    ...over,
  } as ControlSnapshot
}

function buildEnv(over?: { snap?: Partial<ControlSnapshot>; target?: Partial<ControlEditTarget> }) {
  const store = new EditorStore()
  store.setMode('edit')
  store.setActiveControlId('n1')
  const snap = makeSnap(over?.snap)
  const target = makeTarget(over?.target)
  const setControlValue = vi.fn(() => ({ ok: true }))
  const deactivateControl = vi.fn(() => store.setActiveControlId(null))
  const editor = {
    getControlEditTarget: vi.fn(() => target),
    getControlSnapshot: vi.fn(() => snap),
    setControlValue,
    deactivateControl,
    getActiveControlId: () => store.state.activeControlId,
  } as unknown as Editor
  const ctx: EditorContextValue = { editorRef: { current: editor }, ready: true, store }
  return { editor, store, snap, target, setControlValue, deactivateControl, ctx }
}

function renderOverlay(ctx: EditorContextValue, canvasContainer: HTMLElement | null = null) {
  const containerRef = { current: canvasContainer }
  return render(
    <EditorContext.Provider value={ctx}>
      <RuntimeControlOverlay canvasContainerRef={containerRef as never} />
    </EditorContext.Provider>,
  )
}

describe('RuntimeControlOverlay 无缝内联 (契约 §12.6)', () => {
  it('定位文本内容区 + 同 Canvas 字体/透明无框 + 剥括号占位', async () => {
    const { ctx } = buildEnv()
    renderOverlay(ctx)
    const input = await screen.findByRole('textbox')
    const host = document.getElementById('ctl-overlay-host')!
    expect(host.style.left).toBe('100px')
    expect(host.style.top).toBe('200px')
    expect(input.style.fontFamily).toContain('SimSun')
    expect(input.style.fontSize).toBe('16px')
    expect(input.style.background).toBe('transparent')
    expect(input.className).not.toContain('bg-white') // 无白底
    expect(input.className).not.toContain('border')   // 无边框 class
    expect(input.getAttribute('placeholder')).toBe('姓名')
  })

  it('卸载即提交: 输入草稿后 deactivate → setControlValue(n1, 草稿)', async () => {
    const { ctx, deactivateControl, setControlValue } = buildEnv()
    renderOverlay(ctx)
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '张三' } })
    deactivateControl() // 模拟点空白/切控件 → store 置空 → 卸载
    await waitFor(() => expect(setControlValue).toHaveBeenCalled())
    expect(setControlValue).toHaveBeenCalledWith('n1', '张三')
  })

  it('Escape → 丢弃不提交', async () => {
    const { ctx, setControlValue } = buildEnv()
    renderOverlay(ctx)
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '张三' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
    expect(setControlValue).not.toHaveBeenCalled()
  })

  it('只读 (writable=false) → 纯文本只读展示, 无输入框', async () => {
    const { ctx } = buildEnv({ snap: { writable: false, value: '张三' } })
    renderOverlay(ctx)
    await waitFor(() => expect(screen.getByText('张三')).toBeTruthy())
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
