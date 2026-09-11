// ================================================================
// RuntimeControlOverlay — 无缝内联编辑组件测试 (契约 §12.6)
// ================================================================

import { describe, it, expect, vi, beforeAll } from 'vitest'
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

function buildEnv(over?: { snap?: Partial<ControlSnapshot>; target?: Partial<ControlEditTarget>; setResult?: { ok: boolean; reason?: string }; adjacent?: string | null }) {
  const store = new EditorStore()
  store.setMode('edit')
  store.setActiveControlId('n1')
  const snap = makeSnap(over?.snap)
  const target = makeTarget(over?.target)
  const setControlValue = vi.fn(((_id: string, _v: unknown) => over?.setResult ?? { ok: true }) as never)
  const deactivateControl = vi.fn(() => store.setActiveControlId(null))
  const activateControl = vi.fn((id: string | null) => store.setActiveControlId(id))
  const getAdjacentControlId = vi.fn(() => over?.adjacent ?? null)
  const editor = {
    getControlEditTarget: vi.fn(() => target),
    getControlSnapshot: vi.fn(() => snap),
    getControlClientRect: vi.fn(() => ({ left: 10, top: 20, width: 60, height: 16 })),
    setControlValue,
    deactivateControl,
    activateControl,
    getAdjacentControlId,
    getActiveControlId: () => store.state.activeControlId,
  } as unknown as Editor
  const ctx: EditorContextValue = { editorRef: { current: editor }, ready: true, store }
  return { editor, store, snap, target, setControlValue, deactivateControl, activateControl, getAdjacentControlId, ctx }
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

  it('Tab → 提交当前并激活相邻控件', async () => {
    const { ctx, setControlValue, getAdjacentControlId, activateControl } = buildEnv({ adjacent: 'n2' })
    renderOverlay(ctx)
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '张三' } })
    fireEvent.keyDown(input, { key: 'Tab' })
    await waitFor(() => expect(activateControl).toHaveBeenCalledWith('n2'))
    expect(getAdjacentControlId).toHaveBeenCalledWith('n1', 1)
    expect(setControlValue).toHaveBeenCalledWith('n1', '张三')
  })

  it('Shift+Tab → 激活上一个控件 (dir -1)', async () => {
    const { ctx, activateControl, getAdjacentControlId } = buildEnv({ adjacent: 'n0' })
    renderOverlay(ctx)
    const input = await screen.findByRole('textbox')
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })
    await waitFor(() => expect(activateControl).toHaveBeenCalledWith('n0'))
    expect(getAdjacentControlId).toHaveBeenCalledWith('n1', -1)
  })

  it('非法值提交 → 控件旁小红字提示, 且不提交该值', async () => {
    const { ctx, setControlValue } = buildEnv({ setResult: { ok: false, reason: 'number_scale_exceeded' } })
    renderOverlay(ctx)
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '超长值' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getAllByText('数值精度超出限制').length).toBeGreaterThan(0))
    // 提交被拒绝一次; 不因卸载静默重试
    expect(setControlValue.mock.calls.length).toBe(1)
  })

  it('Enter(合法) → 提交并跳到下一个控件', async () => {
    const { ctx, setControlValue, activateControl } = buildEnv({ adjacent: 'n2' })
    renderOverlay(ctx)
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '张三' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(activateControl).toHaveBeenCalledWith('n2'))
    expect(setControlValue).toHaveBeenCalledWith('n1', '张三')
  })

  it('数字控件点空白(卸载) → 以数字提交 (非字符串)', async () => {
    const { ctx, setControlValue, deactivateControl } = buildEnv({ snap: { controlType: 'number', dataType: 'N', placeholder: '[年龄]' } })
    renderOverlay(ctx)
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '42' } })
    deactivateControl() // 模拟点空白 → 卸载
    await waitFor(() => expect(setControlValue).toHaveBeenCalledWith('n1', 42))
  })

  it('数字控件非数字 → 提示且不提交', async () => {
    const { ctx, setControlValue } = buildEnv({ snap: { controlType: 'number', dataType: 'N' } })
    renderOverlay(ctx)
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getAllByText('请输入数字').length).toBeGreaterThan(0))
    expect(setControlValue).not.toHaveBeenCalled()
  })

  it('数字控件非数字点空白(卸载) → 浮层提示仍显示', async () => {
    const { ctx, setControlValue, deactivateControl } = buildEnv({ snap: { controlType: 'number', dataType: 'N' } })
    renderOverlay(ctx)
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: 'abc' } })
    deactivateControl() // 点空白 → 卸载, 卸载提交触发 reject 浮层
    await waitFor(() => expect(screen.getAllByText('请输入数字').length).toBeGreaterThan(0))
    expect(setControlValue).not.toHaveBeenCalled()
  })
})

// ---- 超长值编辑面 (契约 §12.8) ----
//
// jsdom 无 canvas 2D → 给 measureText 一个确定性的等宽实现 (每字 8px),
// 使编辑面的贴宽/折行尺寸可断言 (编辑面尺寸由 textWidth + wrapControlText 推出)。
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    font: '', measureText: (t: string) => ({ width: t.length * 8 }),
  })) as never
})

describe('RuntimeControlOverlay 超长值: 编辑面随草稿增长 (§12.8)', () => {
  const CHAR_W = 8
  const AREA_W = 60   // makeTarget 的 textArea.width

  it('短草稿: 宽度贴住草稿 (输入多少看见多少), 高度单行', async () => {
    const { ctx } = buildEnv()
    renderOverlay(ctx)
    const box = (await screen.findByRole('textbox')) as HTMLTextAreaElement
    expect(box.tagName).toBe('TEXTAREA')
    fireEvent.change(box, { target: { value: '12345' } })
    expect(box.style.width).toBe(`${5 * CHAR_W + 2}px`)
    expect(box.style.height).toBe('16px')
  })

  it('超长草稿: 宽度封顶 = 文本区宽, 逐字符折行, 高度按行数增长且无滚动条', async () => {
    const { ctx, setControlValue, deactivateControl } = buildEnv()
    renderOverlay(ctx)
    const box = (await screen.findByRole('textbox')) as HTMLTextAreaElement
    const long = '1'.repeat(120)
    fireEvent.change(box, { target: { value: long } })
    expect(box.style.width).toBe(`${AREA_W}px`)   // 不再撑出页面右边界
    expect(box.style.whiteSpace).toBe('pre-wrap')
    expect(box.style.wordBreak).toBe('break-all') // 与布局 break-all 同口径
    expect(box.style.overflow).toBe('hidden')      // 不出滚动条
    const perRow = Math.floor(AREA_W / CHAR_W)     // 7
    expect(box.style.height).toBe(`${Math.ceil(120 / perRow) * 16}px`)
    deactivateControl()
    await waitFor(() => expect(setControlValue).toHaveBeenCalledWith('n1', long))
  })

  it('空态按占位符量宽 (与静态渲染的空态盒同宽)', async () => {
    const { ctx } = buildEnv()
    renderOverlay(ctx)
    const box = (await screen.findByRole('textbox')) as HTMLTextAreaElement
    expect(box.style.width).toBe(`${'姓名'.length * CHAR_W + 2}px`)
    expect(box.style.height).toBe('16px')
  })

  it('Enter 仍提交并跳转 (单行语义字段不插入换行)', async () => {
    const { ctx, setControlValue, activateControl } = buildEnv({ adjacent: 'n2' })
    renderOverlay(ctx)
    const box = await screen.findByRole('textbox')
    const long = '1'.repeat(120)
    fireEvent.change(box, { target: { value: long } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(activateControl).toHaveBeenCalledWith('n2'))
    expect(setControlValue).toHaveBeenCalledWith('n1', long)
  })

  it('多行文本域: 高度下限 = minRows, Enter 换行不提交', async () => {
    const { ctx, setControlValue } = buildEnv({
      snap: { controlType: 'textarea', dataType: 'S2', minRows: 4 },
      target: { minRows: 4, textArea: { left: 100, top: 200, width: 600, height: 64, right: 700 } },
    })
    renderOverlay(ctx)
    const box = (await screen.findByRole('textbox')) as HTMLTextAreaElement
    expect(box.style.height).toBe(`${4 * 16}px`)
    fireEvent.change(box, { target: { value: '第一行\n第二行' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(setControlValue).not.toHaveBeenCalled()
  })
})
