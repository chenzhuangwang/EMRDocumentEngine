// ============================================================
// ControlValue — validateControlValue 纯函数单测 (契约 §12.6)
//
// 覆盖: VR-8 写锁 / VR-2·VR-13 空值归一 / VR-5 类型 / VR-9 枚举成员 /
//       VR-10 scale / VR-11 minLength·maxLength / VR-12 checkbox 顺序 / D 格式。
// ============================================================

import { describe, it, expect } from 'vitest'
import { validateControlValue } from '../document/control/ControlValue'
import type { ElementMeta, ElementEnumOption } from '../document/core/DocumentModel'

function element(format: ElementMeta['format'], extra?: Partial<ElementMeta>): ElementMeta {
  return { code: { internal: 'CTL_X', dataElement: 'DE00.00.000.00' }, name: 'x', format, ...extra }
}

function opt(value: string): ElementEnumOption {
  return { name: value, value }
}

describe('validateControlValue — 写锁 (VR-8)', () => {
  it('TemplateDefinition.editable=false → 拒绝 (含清空)', () => {
    const el = element({ dataType: 'S1' })
    expect(validateControlValue('x', el, { editable: false })).toEqual({ ok: false, reason: 'write_locked' })
    expect(validateControlValue(undefined, el, { editable: false })).toEqual({ ok: false, reason: 'write_locked' })
  })

  it('ElementMeta.readonly=true → 拒绝 (含清空)', () => {
    const ro = element({ dataType: 'S1' }, { readonly: true })
    expect(validateControlValue('x', ro)).toEqual({ ok: false, reason: 'write_locked' })
    expect(validateControlValue(undefined, ro)).toEqual({ ok: false, reason: 'write_locked' })
  })
})

describe('validateControlValue — 空值归一 (VR-2/VR-13)', () => {
  it('undefined / "" / [] → ok 且 value 为 undefined', () => {
    const el = element({ dataType: 'S1' })
    expect(validateControlValue(undefined, el)).toEqual({ ok: true, value: undefined })
    expect(validateControlValue('', el)).toEqual({ ok: true, value: undefined })
    const multi = element({ dataType: 'S1', enums: { multiple: true, data: [opt('a')] } })
    expect(validateControlValue([], multi)).toEqual({ ok: true, value: undefined })
  })

  it('空枚举集合 + 非 editable → undefined 清空仍允许', () => {
    const emptyEnum = element({ dataType: 'S1', enums: { data: [] } })
    expect(validateControlValue(undefined, emptyEnum)).toEqual({ ok: true, value: undefined })
  })
})

describe('validateControlValue — 类型 (VR-5)', () => {
  it('S1/S2/S3 → string; 数字 → type_mismatch', () => {
    for (const dt of ['S1', 'S2', 'S3'] as const) {
      const el = element({ dataType: dt })
      expect(validateControlValue('abc', el)).toEqual({ ok: true, value: 'abc' })
      expect(validateControlValue(123, el)).toEqual({ ok: false, reason: 'type_mismatch' })
    }
  })

  it('N → number; 字符串 → type_mismatch', () => {
    const el = element({ dataType: 'N' })
    expect(validateControlValue(42, el)).toEqual({ ok: true, value: 42 })
    expect(validateControlValue('42', el)).toEqual({ ok: false, reason: 'type_mismatch' })
  })

  it('NaN / Infinity → type_mismatch (非有限数)', () => {
    const el = element({ dataType: 'N' })
    expect(validateControlValue(NaN, el)).toEqual({ ok: false, reason: 'type_mismatch' })
    expect(validateControlValue(Infinity, el)).toEqual({ ok: false, reason: 'type_mismatch' })
  })
})

describe('validateControlValue — 数值精度 (VR-10)', () => {
  it('scale=2: 1.234 拒绝, 1.23 / 1.2 / 1 通过', () => {
    const el = element({ dataType: 'N', scale: 2 })
    expect(validateControlValue(1.234, el)).toEqual({ ok: false, reason: 'number_scale_exceeded' })
    expect(validateControlValue(1.23, el)).toEqual({ ok: true, value: 1.23 })
    expect(validateControlValue(1.2, el)).toEqual({ ok: true, value: 1.2 })
    expect(validateControlValue(1, el)).toEqual({ ok: true, value: 1 })
  })
})

describe('validateControlValue — 字符串长度 (VR-11)', () => {
  it('minLength/maxLength 越界拒绝, 不截断', () => {
    const el = element({ dataType: 'S1', minLength: 2, maxLength: 5 })
    expect(validateControlValue('a', el)).toEqual({ ok: false, reason: 'string_length_out_of_range' })
    expect(validateControlValue('abcdef', el)).toEqual({ ok: false, reason: 'string_length_out_of_range' })
    expect(validateControlValue('abc', el)).toEqual({ ok: true, value: 'abc' })
  })
})

describe('validateControlValue — 日期 (D)', () => {
  it('YYYY-MM-DD 通过; 斜杠 / ISO 时间戳拒绝', () => {
    const el = element({ dataType: 'D' })
    expect(validateControlValue('2026-09-07', el)).toEqual({ ok: true, value: '2026-09-07' })
    expect(validateControlValue('2026/09/07', el)).toEqual({ ok: false, reason: 'date_format_invalid' })
    expect(validateControlValue('2026-09-07T00:00:00', el)).toEqual({ ok: false, reason: 'date_format_invalid' })
  })
})

describe('validateControlValue — 枚举单选 (VR-6/VR-9)', () => {
  const select = element({ dataType: 'S3', enums: { data: [opt('a'), opt('b')] } })

  it('候选项通过; 非候选项 + 非 editable 拒绝', () => {
    expect(validateControlValue('a', select)).toEqual({ ok: true, value: 'a' })
    expect(validateControlValue('z', select)).toEqual({ ok: false, reason: 'enum_value_not_allowed' })
  })

  it('非候选项 + editable=true 允许自定义 string', () => {
    const free = element({ dataType: 'S3', enums: { data: [opt('a')], editable: true } })
    expect(validateControlValue('z', free)).toEqual({ ok: true, value: 'z' })
  })

  it('枚举控件传 string[] → type_mismatch (multiple≠true)', () => {
    expect(validateControlValue(['a'], select)).toEqual({ ok: false, reason: 'type_mismatch' })
  })
})

describe('validateControlValue — 枚举多选 / checkbox (VR-6/VR-12)', () => {
  const multi = element({ dataType: 'S3', enums: { multiple: true, data: [opt('b'), opt('a'), opt('c')] } })

  it('按声明顺序归一', () => {
    expect(validateControlValue(['a', 'c', 'b'], multi)).toEqual({ ok: true, value: ['b', 'a', 'c'] })
  })

  it('非候选项 + 非 editable 拒绝', () => {
    expect(validateControlValue(['a', 'z'], multi)).toEqual({ ok: false, reason: 'enum_value_not_allowed' })
  })

  it('传单 string → type_mismatch', () => {
    expect(validateControlValue('a', multi)).toEqual({ ok: false, reason: 'type_mismatch' })
  })
})

describe('validateControlValue — 空候选集合 (data 空/缺失)', () => {
  it('data=[] + 非 editable → 非空值拒绝 (不退回自由文本)', () => {
    const el = element({ dataType: 'S3', enums: { data: [] } })
    expect(validateControlValue('x', el)).toEqual({ ok: false, reason: 'enum_value_not_allowed' })
    const multiEmpty = element({ dataType: 'S3', enums: { multiple: true, data: [] } })
    expect(validateControlValue(['x'], multiEmpty)).toEqual({ ok: false, reason: 'enum_value_not_allowed' })
  })

  it('data=[] + editable=true → 允许自定义 string', () => {
    const el = element({ dataType: 'S3', enums: { data: [], editable: true } })
    expect(validateControlValue('custom', el)).toEqual({ ok: true, value: 'custom' })
  })

  it('enums 存在但 data 缺失 → 等同空候选', () => {
    const el = element({ dataType: 'S3', enums: {} })
    expect(validateControlValue('x', el)).toEqual({ ok: false, reason: 'enum_value_not_allowed' })
  })
})
