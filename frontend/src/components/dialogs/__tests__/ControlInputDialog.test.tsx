// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

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
    expect(screen.getByText('日期时间', { selector: 'button' })).toBeTruthy()
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

describe('ControlInputDialog — 日期时间形态', () => {
  it('选日期时间 → payload dataType=DT, controlType=datetime', () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(<ControlInputDialog open mode="create" initial={{ element: INPUT_EL, definition: INPUT_DEF }} onClose={onClose} onApply={onApply} />)
    fireEvent.click(screen.getByRole('tab', { name: '格式' }))
    fireEvent.click(screen.getByText('日期时间', { selector: 'button' }))
    fireEvent.click(screen.getByRole('button', { name: '插入' }))
    const payload = onApply.mock.calls[0][0] as { element: ElementMeta; definition?: TemplateDefinition }
    expect(payload.element.format?.dataType).toBe('DT')
    expect(payload.definition?.controlType).toBe('datetime')
  })
})

// ================================================================
// 数据绑定 (外部码表, 契约 §12.6.4)
//
// 关键不变式: 候选来源判定看 enums 键**是否存在**, 不看内容
// (ControlValue.ts:117)。所以「无 inline 候选 + 已绑码表」时必须不写
// enums 键 —— 写个空 enums 对象会让码表永远走不到 (绑定静默失效)。
// ================================================================

const DICT_ID = 'ab000000a1b2c3d4e5f60718293a4b5c'
const SELECT_EL: ElementMeta = {
  code: { internal: 'CTL_SELECT', dataElement: 'DE99.99.004' }, name: '下拉',
  format: { dataType: 'S1', enums: { data: [{ name: '轻度', value: 'mild' }] } },
}
const SELECT_DEF: TemplateDefinition = { controlType: 'select', label: '下拉：', editable: true }

function renderSelect() {
  const onApply = vi.fn()
  const onClose = vi.fn()
  render(<ControlInputDialog open mode="edit" initial={{ element: SELECT_EL, definition: SELECT_DEF }} onClose={onClose} onApply={onApply} />)
  fireEvent.click(screen.getByRole('tab', { name: '数据绑定' }))
  return { onApply }
}

describe('ControlInputDialog — 数据绑定 (码表)', () => {
  it('下拉 + 清空 inline 候选 + 绑码表 → payload 含 dictionary 且不含 enums 键', () => {
    const { onApply } = renderSelect()
    // 清掉唯一的 inline 候选项
    fireEvent.change(screen.getByPlaceholderText('名称'), { target: { value: '' } })
    fireEvent.change(screen.getByPlaceholderText('值'), { target: { value: '' } })
    fireEvent.change(screen.getByPlaceholderText('32 位 hex'), { target: { value: DICT_ID } })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))

    const payload = onApply.mock.calls[0][0] as { element: ElementMeta }
    expect(payload.element.format?.dictionary).toBe(DICT_ID)
    // 关键: 不能留下空 enums 对象, 否则码表永远解析不到
    expect(Object.prototype.hasOwnProperty.call(payload.element.format, 'enums')).toBe(false)
  })

  it('下拉 + 有 inline 候选 + 绑码表 → 两者并存 (inline 恒优先, 码表不生效)', () => {
    const { onApply } = renderSelect()
    fireEvent.change(screen.getByPlaceholderText('32 位 hex'), { target: { value: DICT_ID } })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))

    const payload = onApply.mock.calls[0][0] as { element: ElementMeta }
    expect(payload.element.format?.dictionary).toBe(DICT_ID)
    expect(payload.element.format?.enums?.data).toEqual([{ name: '轻度', value: 'mild' }])
  })

  it('从初始 element 回读已有 dictionary 到 draft', () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    const withDict: ElementMeta = {
      ...SELECT_EL,
      format: { dataType: 'S1', dictionary: DICT_ID },
    }
    render(<ControlInputDialog open mode="edit" initial={{ element: withDict, definition: SELECT_DEF }} onClose={onClose} onApply={onApply} />)
    fireEvent.click(screen.getByRole('tab', { name: '数据绑定' }))
    expect((screen.getByPlaceholderText('32 位 hex') as HTMLInputElement).value).toBe(DICT_ID)
  })

  it('清空按钮 → 解绑 (payload 无 dictionary)', () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    const withDict: ElementMeta = { ...SELECT_EL, format: { dataType: 'S1', dictionary: DICT_ID } }
    render(<ControlInputDialog open mode="edit" initial={{ element: withDict, definition: SELECT_DEF }} onClose={onClose} onApply={onApply} />)
    fireEvent.click(screen.getByRole('tab', { name: '数据绑定' }))
    fireEvent.click(screen.getByRole('button', { name: '清空' }))
    fireEvent.click(screen.getByRole('button', { name: '应用' }))

    const payload = onApply.mock.calls[0][0] as { element: ElementMeta }
    expect(payload.element.format?.dictionary).toBeUndefined()
  })

  it('非下拉形态 → 数据绑定 tab 只给说明, 不提供绑定控件', () => {
    renderDialog()   // 初始 controlType 'input' → kind S1
    fireEvent.click(screen.getByRole('tab', { name: '数据绑定' }))
    expect(screen.queryByPlaceholderText('32 位 hex')).toBeNull()
    expect(screen.getByText(/仅「下拉」形态可绑定外部码表/)).toBeTruthy()
  })

  it('显式把下拉改成纯文本 → 清除码表绑定 (形态编辑不残留死引用)', () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    const withDict: ElementMeta = { ...SELECT_EL, format: { dataType: 'S1', dictionary: DICT_ID } }
    render(<ControlInputDialog open mode="edit" initial={{ element: withDict, definition: SELECT_DEF }} onClose={onClose} onApply={onApply} />)
    fireEvent.click(screen.getByRole('tab', { name: '格式' }))
    fireEvent.click(screen.getByText('纯文本', { selector: 'button' }))
    fireEvent.click(screen.getByRole('button', { name: '应用' }))

    const payload = onApply.mock.calls[0][0] as { element: ElementMeta }
    expect(payload.element.format?.dictionary).toBeUndefined()
  })

  it('未改形态的 legacy 控件 → 不清除既有码表绑定 (打开即应用不丢引用)', () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    // controlType undefined + 无 enums → kindFrom 推回 S1, 但形态并未被编辑
    const legacy: ElementMeta = {
      code: { internal: 'CTL_LEGACY', dataElement: 'DE99.99.009' }, name: '遗留',
      format: { dataType: 'S1', dictionary: DICT_ID },
    }
    render(<ControlInputDialog open mode="edit" initial={{ element: legacy, definition: undefined }} onClose={onClose} onApply={onApply} />)
    fireEvent.click(screen.getByRole('button', { name: '应用' }))

    const payload = onApply.mock.calls[0][0] as { element: ElementMeta }
    expect(payload.element.format?.dictionary).toBe(DICT_ID)
  })
})
