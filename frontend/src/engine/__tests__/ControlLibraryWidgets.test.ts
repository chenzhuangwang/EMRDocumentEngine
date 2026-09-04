// ================================================================
// CONTROL_WIDGETS — 通用控件 widget 目录 (契约 §12.4 补充, P1)
//
// 验证 Toolbar 的 type (catalog key) → widget 定义来源:
//   - 7 个通用控件 widget 各自 dataType/showType/enums/controlType 保真
//   - select 与 radio 同为 S1 单选, 仅 controlType 不同 (语义正交)
//   - checkbox 是 S1 多选 (enums.multiple === true)
//   - number 是 N + showType 'N'
// ================================================================

import { describe, it, expect } from 'vitest'
import { CONTROL_WIDGETS, controlWidgetById } from '../../platform/data/controlLibrary'

describe('CONTROL_WIDGETS 通用控件目录 (契约 §12.4)', () => {
  it('7 个通用控件 widget 条目', () => {
    expect(CONTROL_WIDGETS.map((w) => w.id).sort()).toEqual([
      'checkbox', 'date', 'input', 'number', 'radio', 'select', 'textarea',
    ])
  })

  it('每个 widget 的 definition 都携带 controlType + deletable/editable', () => {
    for (const w of CONTROL_WIDGETS) {
      expect(w.definition?.controlType, `${w.id} 缺 controlType`).toBeDefined()
      expect(w.definition?.deletable).toBe(true)
      expect(w.definition?.editable).toBe(true)
    }
  })

  it('input/textarea/number/date 的 dataType 映射正确', () => {
    expect(controlWidgetById('input')?.element.format?.dataType).toBe('S1')
    expect(controlWidgetById('textarea')?.element.format?.dataType).toBe('S2')
    expect(controlWidgetById('number')?.element.format?.dataType).toBe('N')
    expect(controlWidgetById('date')?.element.format?.dataType).toBe('D')
  })

  it('number 是 N + showType "N"', () => {
    const n = controlWidgetById('number')!
    expect(n.element.format?.dataType).toBe('N')
    expect(n.element.format?.showType).toBe('N')
  })

  it('select 与 radio 同为 S1 单选枚举, 仅 controlType 不同 (正交)', () => {
    const select = controlWidgetById('select')!
    const radio = controlWidgetById('radio')!
    expect(select.element.format?.dataType).toBe('S1')
    expect(radio.element.format?.dataType).toBe('S1')
    expect(select.element.format?.enums?.multiple).toBeFalsy()
    expect(radio.element.format?.enums?.multiple).toBeFalsy()
    expect(select.definition?.controlType).toBe('select')
    expect(radio.definition?.controlType).toBe('radio')
    expect(select.definition?.controlType).not.toBe(radio.definition?.controlType)
  })

  it('checkbox 是 S1 多选枚举 (enums.multiple === true)', () => {
    const cb = controlWidgetById('checkbox')!
    expect(cb.element.format?.dataType).toBe('S1')
    expect(cb.element.format?.enums?.multiple).toBe(true)
    expect(cb.definition?.controlType).toBe('checkbox')
  })

  it('未知 type → undefined (不产生兜底假定义)', () => {
    expect(controlWidgetById('not-a-widget')).toBeUndefined()
  })
})
