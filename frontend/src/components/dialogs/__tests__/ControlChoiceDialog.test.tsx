// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ControlChoiceDialog 组件测试 (契约 §12.7)
// 同 Input 测试: Radix 各 Content 全挂载 + hidden 可见性; 用 hidden:true 驱动。
// ================================================================

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ControlChoiceDialog } from '../ControlChoiceDialog'
import type { ElementMeta, ElementEnumOption, TemplateDefinition } from '@emrde/document-engine'

const RADIO_EL: ElementMeta = {
  code: { internal: 'CTL_RADIO', dataElement: 'DE99.99.007' }, name: '症状',
  format: { dataType: 'S1', enums: { multiple: false, data: [{ name: '是', value: 'Y' }] } },
}
const RADIO_DEF: TemplateDefinition = { controlType: 'radio', label: '症状：', editable: true }

function renderDialog() {
  const onApply = vi.fn()
  const onClose = vi.fn()
  render(<ControlChoiceDialog open mode="edit" initial={{ element: RADIO_EL, definition: RADIO_DEF }} onClose={onClose} onApply={onApply} />)
  return { onApply, onClose }
}

describe('ControlChoiceDialog', () => {
  it('控件类型: 单选框→复选框 切换 → multiple=true 且 controlType=checkbox', () => {
    const { onApply } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: /复选框/ }))
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    const payload = onApply.mock.calls[0][0] as { element: ElementMeta; definition?: TemplateDefinition }
    expect(payload.element.format?.enums?.multiple).toBe(true)
    expect(payload.definition?.controlType).toBe('checkbox')
  })

  it('未切换单选 → controlType 保持 radio (legacy 不迁移)', () => {
    const { onApply } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    const payload = onApply.mock.calls[0][0] as { element: ElementMeta; definition?: TemplateDefinition }
    expect(payload.element.format?.enums?.multiple).toBe(false)
    expect(payload.definition?.controlType).toBe('radio')
  })

  it('新增 否/N + 数值 2 → payload.options 含 name/value/numericValue', () => {
    const { onApply } = renderDialog()
    // 选项设置 (hidden): 新增一行并填入 否/N
    fireEvent.click(screen.getByRole('button', { name: /新增选项/, hidden: true }))
    const nameInputs = screen.getAllByPlaceholderText('名称', { hidden: true } as never)
    const valueInputs = screen.getAllByPlaceholderText('值', { hidden: true } as never)
    fireEvent.change(nameInputs[1], { target: { value: '否' } })
    fireEvent.change(valueInputs[1], { target: { value: 'N' } })
    // 数值属性 (hidden): 第二项 数值 = 2
    const spins = screen.getAllByRole('spinbutton', { hidden: true })
    fireEvent.change(spins[1], { target: { value: '2' } })

    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    const payload = onApply.mock.calls[0][0] as { element: ElementMeta }
    const data = payload.element.format!.enums!.data as ElementEnumOption[]
    expect(data).toHaveLength(2)
    expect(data[0]).toMatchObject({ name: '是', value: 'Y' })
    expect(data[1]).toMatchObject({ name: '否', value: 'N', numericValue: 2 })
    // 未切多选 → controlType 保持
    expect(payload.element.format?.enums?.multiple).toBe(false)
  })

  it('取消不触发 onApply', () => {
    const { onApply } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onApply).not.toHaveBeenCalled()
  })
})

// ================================================================
// 语义身份可编辑 (契约 §12.5 / §12.10.1)
//
// 与 ControlInputDialog 的同名用例组**成对存在** —— 两个弹框由同一个
// SemanticIdentityFields 实现, 但各自的 draft 组装是独立的, 所以两边都得锁:
// 只在一边测, 另一边漏接 draft 字段也不会红。
// ================================================================

describe('ControlChoiceDialog — 语义身份可编辑 (契约 §12.5)', () => {
  const BASE_TAB = '基础属性'

  function renderEdit(element: ElementMeta, otherKeyUsage?: Map<string, number>) {
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(
      <ControlChoiceDialog
        open mode="edit" initial={{ element, definition: RADIO_DEF }}
        otherKeyUsage={otherKeyUsage}
        onClose={onClose} onApply={onApply}
      />,
    )
    return { onApply, onClose }
  }

  it('改数据元码与标识 → 应用 payload 的 element.code 随之更新', () => {
    const { onApply } = renderEdit(RADIO_EL)
    fireEvent.click(screen.getByRole('tab', { name: BASE_TAB }))
    fireEvent.change(screen.getByLabelText(/数据元码/), { target: { value: 'DE02.01.002.00' } })
    fireEvent.change(screen.getByLabelText(/标识 \(internal\)/), { target: { value: 'CTL_SYMPTOM' } })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))

    const payload = onApply.mock.calls[0][0] as { element: ElementMeta }
    expect(payload.element.code).toEqual({ internal: 'CTL_SYMPTOM', dataElement: 'DE02.01.002.00' })
  })

  it('两键都 trim', () => {
    const { onApply } = renderEdit(RADIO_EL)
    fireEvent.click(screen.getByRole('tab', { name: BASE_TAB }))
    fireEvent.change(screen.getByLabelText(/数据元码/), { target: { value: '  DE_Y  ' } })
    fireEvent.change(screen.getByLabelText(/标识 \(internal\)/), { target: { value: ' CTL_Y ' } })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))

    const payload = onApply.mock.calls[0][0] as { element: ElementMeta }
    expect(payload.element.code).toEqual({ internal: 'CTL_Y', dataElement: 'DE_Y' })
  })

  it('两键清空 → code 是空串 (无规范身份)', () => {
    const { onApply } = renderEdit(RADIO_EL)
    fireEvent.click(screen.getByRole('tab', { name: BASE_TAB }))
    fireEvent.change(screen.getByLabelText(/数据元码/), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText(/标识 \(internal\)/), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))

    const payload = onApply.mock.calls[0][0] as { element: ElementMeta }
    expect(payload.element.code).toEqual({ internal: '', dataElement: '' })
  })

  it('改键不碰候选与控件类型 (只动 code)', () => {
    const { onApply } = renderEdit(RADIO_EL)
    fireEvent.click(screen.getByRole('tab', { name: BASE_TAB }))
    fireEvent.change(screen.getByLabelText(/数据元码/), { target: { value: 'DE_NEW' } })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))

    const payload = onApply.mock.calls[0][0] as { element: ElementMeta; definition?: TemplateDefinition }
    expect(payload.element.name).toBe('症状')
    expect(payload.element.format?.enums?.data).toEqual([{ name: '是', value: 'Y' }])
    expect(payload.definition?.controlType).toBe('radio')
  })

  it('撞键提示: 别的控件已用该键 → 提示出现, n 把自己算进去', () => {
    renderEdit(RADIO_EL, new Map([['DE99.99.007', 1]]))
    fireEvent.click(screen.getByRole('tab', { name: BASE_TAB }))
    // RADIO_EL 的 dataElement 正是 DE99.99.007, 另一个控件也用它 → 共 2 个
    expect(screen.getByText(/已被 2 个控件使用/)).toBeTruthy()
  })

  it('无人撞键 → 不提示', () => {
    renderEdit(RADIO_EL, new Map())
    fireEvent.click(screen.getByRole('tab', { name: BASE_TAB }))
    expect(screen.queryByText(/已被 \d+ 个控件使用/)).toBeNull()
  })

  it('数据元码优先于标识算键 —— 只有标识撞车时不报', () => {
    renderEdit(RADIO_EL, new Map([['CTL_RADIO', 3]]))
    fireEvent.click(screen.getByRole('tab', { name: BASE_TAB }))
    expect(screen.queryByText(/已被 \d+ 个控件使用/)).toBeNull()
  })
})
