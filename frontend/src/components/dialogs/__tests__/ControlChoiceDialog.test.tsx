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
import type { ElementMeta, ElementEnumOption, TemplateDefinition } from '@/engine'

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
