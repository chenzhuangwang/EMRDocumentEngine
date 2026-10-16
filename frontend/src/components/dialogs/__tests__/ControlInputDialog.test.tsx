// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ControlInputDialog 组件测试 (契约 §12.7)
//
// 查询口径: Radix Dialog 经 Portal 挂到 document.body, **不在 render() 返回的
// container 里** —— 凡按 DOM 结构直查 (querySelector) 一律走 screen / document.body;
// 按语义查询 (getByRole / getByPlaceholderText / getByLabelText) 不受影响。
//
// Radix Tabs 各 Content 默认以 hidden 控制可见性 (forceMount 已开), 故按 tab
// 切换后内容都在 DOM 里, placeholder 直查即可, 无需 { hidden: true }。
//
// v6.1: 文案全部走 i18n (zh-CN 为默认 locale)。tab 标签为
// 常规/格式/高级/数据绑定/内部; 形态按钮为 单行文本/数字/日期/日期时间/下拉。
// ================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ControlInputDialog } from '../ControlInputDialog'
import type { CalcResult, ElementMeta, TemplateDefinition } from '@emrde/document-engine'
import { bootstrapLocale } from '@/i18n/bootstrap'
import { locale } from '@emrde/document-engine'

const INPUT_EL: ElementMeta = {
  code: { internal: 'CTL_INPUT', dataElement: 'DE99.99.001' }, name: '旧名',
  format: { dataType: 'S1' },
}
const INPUT_DEF: TemplateDefinition = { controlType: 'input', label: '旧标签', editable: true }

beforeEach(() => { bootstrapLocale() })
afterEach(() => { locale.setLocale('zh-CN') })

function renderDialog() {
  const onApply = vi.fn()
  const onClose = vi.fn()
  render(<ControlInputDialog open mode="create" initial={{ element: INPUT_EL, definition: INPUT_DEF }} onClose={onClose} onApply={onApply} />)
  return { onApply, onClose }
}

/**
 * 形态按钮查询。
 *
 * Radix Tabs.Content 即使 forceMount, 非激活面板仍带 `hidden` 属性 ——
 * 于是那些按钮**不在可访问性树里**, getByRole 找不到 (格式 tab 未激活时)。
 * 这里统一用 getByText + selector:'button' 直查 DOM, 不受 hidden 影响。
 */
function kindButton(label: string): HTMLElement {
  return screen.getByText(label, { selector: 'button' })
}

/** 点击形态按钮 (格式 tab 内的 kind 选择器) */
function pickKind(label: string) {
  fireEvent.click(screen.getByRole('tab', { name: '格式' }))
  fireEvent.click(kindButton(label))
}

const insertBtn = () => screen.getByRole('button', { name: '插入' })
const applyBtn = () => screen.getByRole('button', { name: '应用' })

describe('ControlInputDialog', () => {
  it('常规 tab: 改数据元名称与标签 → 应用 payload 含新 element.name/label', () => {
    const { onApply } = renderDialog()
    fireEvent.change(screen.getByLabelText(/数据元名称/), { target: { value: '新名' } })
    fireEvent.change(screen.getByLabelText(/控件标签/), { target: { value: '新标签：' } })
    fireEvent.click(insertBtn())
    expect(onApply).toHaveBeenCalledTimes(1)
    const payload = onApply.mock.calls[0][0] as { element: ElementMeta; definition?: TemplateDefinition }
    expect(payload.element.name).toBe('新名')
    expect(payload.element.format?.dataType).toBe('S1')
    expect(payload.definition?.label).toBe('新标签：')
    expect(payload.definition?.controlType).toBe('input')
  })

  it('格式: 数据类型 S1→数字 (N) → controlType 联动为 number', () => {
    const { onApply } = renderDialog()
    pickKind('数字')
    fireEvent.click(insertBtn())
    const payload = onApply.mock.calls[0][0] as { element: ElementMeta; definition?: TemplateDefinition }
    expect(payload.element.format?.dataType).toBe('N')
    expect(payload.definition?.controlType).toBe('number')
  })

  it('校验: 数字录入 scale → payload.format.scale (含格式 N 联动)', () => {
    const { onApply } = renderDialog()
    pickKind('数字')
    fireEvent.click(screen.getByRole('tab', { name: '高级' }))
    fireEvent.change(screen.getByLabelText(/小数位数/), { target: { value: '2' } })
    fireEvent.click(insertBtn())
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

describe('ControlInputDialog — 格式形态 (单行文本/数字/日期/日期时间/下拉)', () => {
  it('格式 tab 只含 单行文本/数字/日期/日期时间/下拉 (无 多行文本)', () => {
    renderDialog()
    for (const label of ['单行文本', '数字', '日期', '日期时间', '下拉']) {
      expect(kindButton(label)).toBeTruthy()
    }
    expect(screen.queryByText('多行文本', { selector: 'button' })).toBeNull()
  })

  it('选下拉 → 填候选 + 勾多选 → 应用 payload controlType=select, enums.data/multiple 正确', () => {
    const { onApply } = renderDialog()
    pickKind('下拉')
    fireEvent.click(screen.getByRole('button', { name: /添加选项/ }))
    fireEvent.change(screen.getByPlaceholderText('显示名 (候选项)'), { target: { value: '轻度' } })
    fireEvent.change(screen.getByPlaceholderText('值 (候选项值)'), { target: { value: 'mild' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /允许多选/ }))
    fireEvent.click(insertBtn())
    const payload = onApply.mock.calls[0][0] as { element: ElementMeta; definition?: TemplateDefinition }
    expect(payload.element.format?.dataType).toBe('S1')
    expect(payload.definition?.controlType).toBe('select')
    expect(payload.element.format?.enums?.multiple).toBe(true)
    expect(payload.element.format?.enums?.data).toEqual([{ name: '轻度', value: 'mild' }])
  })

  it('选数字 → 应用 payload controlType=number, dataType=N', () => {
    const { onApply } = renderDialog()
    pickKind('数字')
    fireEvent.click(insertBtn())
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
    pickKind('日期时间')
    fireEvent.click(insertBtn())
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

/** 打开「数据绑定」tab 并返回可查询的 scope */
function renderSelectToBinding() {
  const onApply = vi.fn()
  const onClose = vi.fn()
  render(<ControlInputDialog open mode="edit" initial={{ element: SELECT_EL, definition: SELECT_DEF }} onClose={onClose} onApply={onApply} />)
  fireEvent.click(screen.getByRole('tab', { name: '数据绑定' }))
  return { onApply }
}

const hexInput = () => screen.getByPlaceholderText(/32 位 hex/) as HTMLInputElement

describe('ControlInputDialog — 数据绑定 (码表)', () => {
  it('下拉 + 清空 inline 候选 + 绑码表 → payload 含 dictionary 且不含 enums 键', () => {
    const { onApply } = renderSelectToBinding()
    // 清掉唯一的 inline 候选项
    fireEvent.change(screen.getByPlaceholderText('显示名 (候选项)'), { target: { value: '' } })
    fireEvent.change(screen.getByPlaceholderText('值 (候选项值)'), { target: { value: '' } })
    fireEvent.change(hexInput(), { target: { value: DICT_ID } })
    fireEvent.click(applyBtn())

    const payload = onApply.mock.calls[0][0] as { element: ElementMeta }
    expect(payload.element.format?.dictionary).toBe(DICT_ID)
    // 关键: 不能留下空 enums 对象, 否则码表永远解析不到
    expect(Object.prototype.hasOwnProperty.call(payload.element.format, 'enums')).toBe(false)
  })

  it('下拉 + 有 inline 候选 + 绑码表 → 两者并存 (inline 恒优先, 码表不生效)', () => {
    const { onApply } = renderSelectToBinding()
    fireEvent.change(hexInput(), { target: { value: DICT_ID } })
    fireEvent.click(applyBtn())

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
    expect(hexInput().value).toBe(DICT_ID)
  })

  it('清空按钮 → 解绑 (payload 无 dictionary)', () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    const withDict: ElementMeta = { ...SELECT_EL, format: { dataType: 'S1', dictionary: DICT_ID } }
    render(<ControlInputDialog open mode="edit" initial={{ element: withDict, definition: SELECT_DEF }} onClose={onClose} onApply={onApply} />)
    fireEvent.click(screen.getByRole('tab', { name: '数据绑定' }))
    fireEvent.click(screen.getByRole('button', { name: '清空' }))
    fireEvent.click(applyBtn())

    const payload = onApply.mock.calls[0][0] as { element: ElementMeta }
    expect(payload.element.format?.dictionary).toBeUndefined()
  })

  it('非下拉形态 → 数据绑定 tab 只给说明, 不提供绑定控件', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('tab', { name: '数据绑定' }))
    expect(screen.queryByPlaceholderText(/32 位 hex/)).toBeNull()
    expect(screen.getByText(/仅「下拉」形态可绑定外部码表/)).toBeTruthy()
  })

  it('显式把下拉改成单行文本 → 清除码表绑定 (形态编辑不残留死引用)', () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    const withDict: ElementMeta = { ...SELECT_EL, format: { dataType: 'S1', dictionary: DICT_ID } }
    render(<ControlInputDialog open mode="edit" initial={{ element: withDict, definition: SELECT_DEF }} onClose={onClose} onApply={onApply} />)
    pickKind('单行文本')
    fireEvent.click(applyBtn())

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
    fireEvent.click(applyBtn())

    const payload = onApply.mock.calls[0][0] as { element: ElementMeta }
    expect(payload.element.format?.dictionary).toBe(DICT_ID)
  })
})

// ================================================================
// 语义身份可编辑 (契约 §12.5 / §12.10.1)
//
// 这两个键此前**在 UI 里根本写不进去** —— 全仓 19 处 `code: {...}` 都是只读构造,
// 没有一处从输入框回写。于是"用数据元码绑定"对手插控件是不通的, 绑定 API 只剩
// ambiguous。本组用例把"能写进去"钉成事实。
//
// 作用域是**本弹框**; 轻量属性面板仍只读 (那条由 DesignControlProperties.test.tsx
// 的断言锁定, 本组不动它)。
// ================================================================

describe('ControlInputDialog — 语义身份可编辑 (契约 §12.5)', () => {
  const OTHER_TAB = '内部'

  function renderEdit(element: ElementMeta, otherKeyUsage?: Map<string, number>) {
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(
      <ControlInputDialog
        open mode="edit" initial={{ element, definition: undefined }}
        otherKeyUsage={otherKeyUsage}
        onClose={onClose} onApply={onApply}
      />,
    )
    return { onApply, onClose }
  }

  it('改数据元码与标识 → 应用 payload 的 element.code 随之更新', () => {
    const { onApply } = renderEdit(INPUT_EL)
    fireEvent.click(screen.getByRole('tab', { name: OTHER_TAB }))
    fireEvent.change(screen.getByLabelText(/数据元码/), { target: { value: 'DE02.01.001.00' } })
    fireEvent.change(screen.getByLabelText(/标识 \(internal\)/), { target: { value: 'CTL_NAME' } })
    fireEvent.click(applyBtn())

    const payload = onApply.mock.calls[0][0] as { element: ElementMeta }
    expect(payload.element.code).toEqual({ internal: 'CTL_NAME', dataElement: 'DE02.01.001.00' })
  })

  it('两键都 trim —— 首尾空格会让"看着一样"的键算成不同键, 绑定就撞不上', () => {
    const { onApply } = renderEdit(INPUT_EL)
    fireEvent.click(screen.getByRole('tab', { name: OTHER_TAB }))
    fireEvent.change(screen.getByLabelText(/数据元码/), { target: { value: '  DE_X  ' } })
    fireEvent.change(screen.getByLabelText(/标识 \(internal\)/), { target: { value: '  CTL_X ' } })
    fireEvent.click(applyBtn())

    const payload = onApply.mock.calls[0][0] as { element: ElementMeta }
    expect(payload.element.code).toEqual({ internal: 'CTL_X', dataElement: 'DE_X' })
  })

  it('两键清空 → code 是空串 (无规范身份), 不是缺字段', () => {
    const { onApply } = renderEdit(INPUT_EL)
    fireEvent.click(screen.getByRole('tab', { name: OTHER_TAB }))
    fireEvent.change(screen.getByLabelText(/数据元码/), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText(/标识 \(internal\)/), { target: { value: '' } })
    fireEvent.click(applyBtn())

    const payload = onApply.mock.calls[0][0] as { element: ElementMeta }
    // ElementCode 的两项都是必填 string, 清空 = 空串 (与 elementIdentity 判 null 的口径一致)
    expect(payload.element.code).toEqual({ internal: '', dataElement: '' })
  })

  it('改键不影响其他字段 (name / format 原样带过)', () => {
    const { onApply } = renderEdit(INPUT_EL)
    fireEvent.click(screen.getByRole('tab', { name: OTHER_TAB }))
    fireEvent.change(screen.getByLabelText(/数据元码/), { target: { value: 'DE_NEW' } })
    fireEvent.click(applyBtn())

    const payload = onApply.mock.calls[0][0] as { element: ElementMeta }
    expect(payload.element.name).toBe('旧名')
    expect(payload.element.format?.dataType).toBe('S1')
  })

  it('撞键提示: 别的控件已用该键 → 出现提示, 且 n 把自己算进去', () => {
    renderEdit(INPUT_EL, new Map([['DE99.99.001', 1]]))
    fireEvent.click(screen.getByRole('tab', { name: OTHER_TAB }))
    // INPUT_EL 的 dataElement 正是 DE99.99.001, 另一个控件也用它 → 一共 2 个
    expect(screen.getByText(/已被 2 个控件使用/)).toBeTruthy()
  })

  it('无人撞键 → 不出现提示 (空键不算撞: 无身份的控件不为绑定服务)', () => {
    renderEdit(INPUT_EL, new Map())
    fireEvent.click(screen.getByRole('tab', { name: OTHER_TAB }))
    expect(screen.queryByText(/已被 \d+ 个控件使用/)).toBeNull()
  })

  it('提示随输入实时变化: 改成没人用的键 → 提示消失', () => {
    renderEdit(INPUT_EL, new Map([['DE99.99.001', 1]]))
    fireEvent.click(screen.getByRole('tab', { name: OTHER_TAB }))
    expect(screen.getByText(/已被 2 个控件使用/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/数据元码/), { target: { value: 'DE_UNIQUE' } })
    expect(screen.queryByText(/已被 \d+ 个控件使用/)).toBeNull()
  })

  it('数据元码优先于标识算键 (§12.10.1) —— 只有标识撞车时不报', () => {
    // 别的控件用的是 CTL_INPUT (标识), 但本控件的 dataElement 有值 → 生效键是它
    renderEdit(INPUT_EL, new Map([['CTL_INPUT', 3]]))
    fireEvent.click(screen.getByRole('tab', { name: OTHER_TAB }))
    expect(screen.queryByText(/已被 \d+ 个控件使用/)).toBeNull()
  })
})

// ================================================================
// 计算 (契约 §12.12.9)
//
// 与 ControlChoiceDialog 的同名用例组**成对存在** —— 两个弹框共用同一个
// FormulaField, 但各自的 draft 组装 (draftFrom / result) 是独立的: 只在一边测,
// 另一边漏接 draft.formula 也不会红。批次一在"语义身份"上正是这么栽的。
// ================================================================

describe('ControlInputDialog — 计算 (契约 §12.12.9)', () => {
  const FORMULA_TAB = '计算'

  function renderFormula(definition?: TemplateDefinition, onPreviewFormula?: (f: string) => CalcResult) {
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(
      <ControlInputDialog
        open mode="edit"
        initial={{ element: INPUT_EL, definition }}
        referenceKeys={[{ key: 'DE99.99.001', name: '旧名', ambiguous: false }]}
        onPreviewFormula={onPreviewFormula}
        onClose={onClose} onApply={onApply}
      />,
    )
    return { onApply, onClose }
  }

  const formulaBox = () => screen.getByPlaceholderText(/收缩压/) as HTMLTextAreaElement

  it('「计算」tab 打开时回填既有公式', () => {
    renderFormula({ ...INPUT_DEF, formula: '[DE99.99.001] + 1' })
    fireEvent.click(screen.getByRole('tab', { name: FORMULA_TAB }))
    expect(formulaBox().value).toBe('[DE99.99.001] + 1')
  })

  it('写公式 → 应用 payload 的 definition.formula 随之更新', () => {
    const { onApply } = renderFormula(INPUT_DEF)
    fireEvent.click(screen.getByRole('tab', { name: FORMULA_TAB }))
    fireEvent.change(formulaBox(), { target: { value: '[DE99.99.001] * 2' } })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))

    const payload = onApply.mock.calls[0][0] as { definition?: TemplateDefinition }
    expect(payload.definition?.formula).toBe('[DE99.99.001] * 2')
    // 其余定义字段不受影响
    expect(payload.definition?.controlType).toBe('input')
  })

  it('清空公式 → payload 里没有 formula 键 (真删键, 不是写空串)', () => {
    const { onApply } = renderFormula({ ...INPUT_DEF, formula: '[DE99.99.001] + 1' })
    fireEvent.click(screen.getByRole('tab', { name: FORMULA_TAB }))
    fireEvent.change(formulaBox(), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))

    const payload = onApply.mock.calls[0][0] as { definition?: TemplateDefinition }
    expect(payload.definition && 'formula' in payload.definition).toBe(false)
  })

  it('公式算不出来也**不阻断应用** —— 作者可能正写到一半', () => {
    const { onApply } = renderFormula(
      INPUT_DEF,
      () => ({ ok: false, error: { code: 'syntax', message: 'unexpected end' } }),
    )
    fireEvent.click(screen.getByRole('tab', { name: FORMULA_TAB }))
    fireEvent.change(formulaBox(), { target: { value: '[DE99.99.001] +' } })

    // 错误照实显示 (且是分类的) …
    expect(screen.getByText(/语法错误/)).toBeTruthy()
    // … 但「应用」照旧可点、照旧提交 —— 与 §12.10.2 撞键提示同一姿势
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    const payload = onApply.mock.calls[0][0] as { definition?: TemplateDefinition }
    expect(payload.definition?.formula).toBe('[DE99.99.001] +')
  })
})
