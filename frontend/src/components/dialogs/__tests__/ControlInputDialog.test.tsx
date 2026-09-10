// ================================================================
// ControlInputDialog 组件测试 (契约 §12.7)
//
// Radix Tabs 各 Content 默认全部挂载、以 hidden 控制可见性; jsdom 下
// inactive 面板不可被默认 query 命中, 故测试统一以 { hidden: true }
// 直接驱动, 不依赖 tab 切换 (React 状态更新与可见性无关)。
// ================================================================

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ControlInputDialog } from '../ControlInputDialog'
import type { ElementMeta, TemplateDefinition } from '@/engine'

const INPUT_EL: ElementMeta = {
  code: { internal: 'CTL_INPUT', dataElement: 'DE99.99.001' }, name: '旧名',
  format: { dataType: 'S1' },
}
const INPUT_DEF: TemplateDefinition = { controlType: 'input', label: '旧标签', editable: true }

function renderDialog() {
  const onApply = vi.fn()
  const onClose = vi.fn()
  render(<ControlInputDialog open mode="create" initial={{ element: INPUT_EL, definition: INPUT_DEF }} onClose={onClose} onApply={onApply} />)
  return { onApply, onClose }
}

describe('ControlInputDialog', () => {
  it('常规 tab: 改数据元名称与标签 → 应用 payload 含新 element.name/label', () => {
    const { onApply } = renderDialog()
    fireEvent.change(screen.getByLabelText(/数据元名称/), { target: { value: '新名' } })
    fireEvent.change(screen.getByLabelText(/控件标签/), { target: { value: '新标签：' } })
    fireEvent.click(screen.getByRole('button', { name: '插入' }))
    expect(onApply).toHaveBeenCalledTimes(1)
    const payload = onApply.mock.calls[0][0] as { element: ElementMeta; definition?: TemplateDefinition }
    expect(payload.element.name).toBe('新名')
    expect(payload.element.format?.dataType).toBe('S1')
    expect(payload.definition?.label).toBe('新标签：')
    expect(payload.definition?.controlType).toBe('input')
  })

  it('格式: 数据类型 S1→数字 (N) → controlType 联动为 number', () => {
    const { onApply } = renderDialog()
    fireEvent.click(screen.getByText('数字', { selector: 'button', hidden: true } as never))
    fireEvent.click(screen.getByRole('button', { name: '插入' }))
    const payload = onApply.mock.calls[0][0] as { element: ElementMeta; definition?: TemplateDefinition }
    expect(payload.element.format?.dataType).toBe('N')
    expect(payload.definition?.controlType).toBe('number')
  })

  it('校验: 数字录入 scale → payload.format.scale (含格式 N 联动)', () => {
    const { onApply } = renderDialog()
    fireEvent.click(screen.getByText('数字', { selector: 'button', hidden: true } as never))
    const scale = screen.getByLabelText(/小数位数/, { hidden: true } as never)
    fireEvent.change(scale, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '插入' }))
    const payload = onApply.mock.calls[0][0] as { element: ElementMeta }
    expect(payload.element.format?.dataType).toBe('N')
    expect(payload.element.format?.scale).toBe(2)
  })

  it('取消不触发 onApply', () => {
    const { onApply } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onApply).not.toHaveBeenCalled()
  })
})

describe('ControlInputDialog — 格式形态 (纯文本/数字/日期/下拉)', () => {
  it('格式 tab 只含 纯文本/数字/日期/下拉 (无 多行文本/长文本)', () => {
    renderDialog()
    expect(screen.getByText('纯文本', { selector: 'button' })).toBeTruthy()
    expect(screen.getByText('数字', { selector: 'button' })).toBeTruthy()
    expect(screen.getByText('日期', { selector: 'button' })).toBeTruthy()
    expect(screen.getByText('下拉', { selector: 'button' })).toBeTruthy()
    expect(screen.queryByText('多行文本', { selector: 'button' })).toBeNull()
    expect(screen.queryByText('长文本', { selector: 'button' })).toBeNull()
  })

  it('选下拉 → 填候选 + 勾多选 → 应用 payload controlType=select, enums.data/multiple 正确', () => {
    const { onApply } = renderDialog()
    fireEvent.click(screen.getByRole('tab', { name: '格式' }))
    fireEvent.click(screen.getByRole('button', { name: '下拉' }))
    fireEvent.click(screen.getByRole('button', { name: '+ 添加选项' }))
    const nameInput = screen.getByPlaceholderText('名称')
    const valueInput = screen.getByPlaceholderText('值')
    fireEvent.change(nameInput, { target: { value: '轻度' } })
    fireEvent.change(valueInput, { target: { value: 'mild' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /允许多选/ }))
    fireEvent.click(screen.getByRole('button', { name: '插入' }))
    const payload = onApply.mock.calls[0][0] as { element: ElementMeta; definition?: TemplateDefinition }
    expect(payload.element.format?.dataType).toBe('S1')
    expect(payload.definition?.controlType).toBe('select')
    expect(payload.element.format?.enums?.multiple).toBe(true)
    expect(payload.element.format?.enums?.data).toEqual([{ name: '轻度', value: 'mild' }])
  })

  it('选数字 → 应用 payload controlType=number, dataType=N', () => {
    const { onApply } = renderDialog()
    fireEvent.click(screen.getByRole('tab', { name: '格式' }))
    fireEvent.click(screen.getByRole('button', { name: '数字' }))
    fireEvent.click(screen.getByRole('button', { name: '插入' }))
    const payload = onApply.mock.calls[0][0] as { element: ElementMeta; definition?: TemplateDefinition }
    expect(payload.element.format?.dataType).toBe('N')
    expect(payload.definition?.controlType).toBe('number')
  })
})
