// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// controlConfigShared 纯函数测试 (契约 §12.7 家族路由 + 向导种子)
// ================================================================

import { describe, it, expect } from 'vitest'
import { controlFamilyOf, initialConfigForCreate, cleanDefinition, semanticCodeOf, effectiveBindingKeyOf } from '../controlConfigShared'
import type { ElementFormat, ElementMeta, TemplateDefinition } from '@emrde/document-engine'

function baseEl(dataType: ElementFormat['dataType']): ElementMeta {
  return {
    code: { internal: 'CTL_X', dataElement: 'DE99.99.001' }, name: 'x',
    format: { dataType },
  }
}
function enumsEl(dataType: ElementFormat['dataType']): ElementMeta {
  const e = baseEl(dataType)
  e.format!.enums = { multiple: false, data: [{ name: '是', value: 'Y' }] }
  return e
}

describe('controlFamilyOf (路由用, 不回写)', () => {
  it('def.controlType 输入族 → input', () => {
    for (const ct of ['input', 'textarea', 'number', 'date'] as const) {
      expect(controlFamilyOf(baseEl('S1'), { controlType: ct })).toBe('input')
    }
  })
  it('def.controlType radio/checkbox → choice; select/datetime → input (输入域弹框)', () => {
    expect(controlFamilyOf(baseEl('S1'), { controlType: 'radio' })).toBe('choice')
    expect(controlFamilyOf(baseEl('S1'), { controlType: 'checkbox' })).toBe('choice')
    expect(controlFamilyOf(baseEl('S1'), { controlType: 'select' })).toBe('input')
    expect(controlFamilyOf(baseEl('DT'), { controlType: 'datetime' })).toBe('input')
  })
  it('undefined + 有 enums → choice; undefined 无 enums → input (按 dataType 路由)', () => {
    expect(controlFamilyOf(enumsEl('S1'))).toBe('choice')
    expect(controlFamilyOf(baseEl('N'))).toBe('input')
    expect(controlFamilyOf(baseEl('D'))).toBe('input')
  })
})

describe('initialConfigForCreate (向导种子)', () => {
  it('textInput → input: dataType S1 / def.controlType input', () => {
    const c = initialConfigForCreate('textInput')
    expect(c.element.format?.dataType).toBe('S1')
    expect(c.definition?.controlType).toBe('input')
  })
  it('radio → controlType radio (单选枚举)', () => {
    expect(initialConfigForCreate('radio').definition?.controlType).toBe('radio')
  })
  it('checkbox → controlType checkbox 且 enums.multiple=true', () => {
    const c = initialConfigForCreate('checkbox')
    expect(c.definition?.controlType).toBe('checkbox')
    expect(c.element.format?.enums?.multiple).toBe(true)
  })
  it('每次调用返回深克隆 (互不污染)', () => {
    const a = initialConfigForCreate('textInput')
    a.element.name = '改'
    expect(initialConfigForCreate('textInput').element.name).not.toBe('改')
  })
  it('不含库默认 label (不把「文本输入：」当默认标签带进文档)', () => {
    expect(initialConfigForCreate('textInput').definition?.label).toBeUndefined()
    expect(initialConfigForCreate('radio').definition?.label).toBeUndefined()
    expect(initialConfigForCreate('checkbox').definition?.label).toBeUndefined()
  })
})

describe('cleanDefinition', () => {
  it('丢弃空串/undefined, 保留 false 布尔与数值', () => {
    const d: TemplateDefinition = { controlType: 'input', label: '', editable: false, tips: 't', deletable: undefined, single: true }
    const out = cleanDefinition(d)
    expect(out).toEqual({ controlType: 'input', editable: false, tips: 't', single: true })
  })
  it('全空/undefined → undefined', () => {
    expect(cleanDefinition({ label: '', tips: undefined })).toBeUndefined()
    expect(cleanDefinition(undefined)).toBeUndefined()
  })
})

// ================================================================
// 语义身份 (契约 §12.5 / §12.10.1) —— 两个配置弹框共用的那两条规则
// ================================================================

describe('semanticCodeOf (契约 §12.5)', () => {
  it('两键都 trim —— 留着首尾空格会让"看着一样的键"算成不同键', () => {
    expect(semanticCodeOf('  CTL_X ', '  DE_X  ')).toEqual({ internal: 'CTL_X', dataElement: 'DE_X' })
  })

  it('清空 → 空串 (ElementCode 两项都是必填 string, 不是缺字段)', () => {
    expect(semanticCodeOf('', '')).toEqual({ internal: '', dataElement: '' })
  })

  it('只 trim 首尾: 中间的空格是键的一部分, 不动', () => {
    expect(semanticCodeOf('CTL A', 'DE A')).toEqual({ internal: 'CTL A', dataElement: 'DE A' })
  })
})

describe('effectiveBindingKeyOf (契约 §12.10.1)', () => {
  it('dataElement 优先; 为空才回退 internal —— 与 elementIdentity 同顺序', () => {
    expect(effectiveBindingKeyOf('CTL_X', 'DE_X')).toBe('DE_X')
    expect(effectiveBindingKeyOf('CTL_X', '')).toBe('CTL_X')
  })

  it('判定前先 trim (否则"  " 会被当成有身份)', () => {
    expect(effectiveBindingKeyOf('CTL_X', '   ')).toBe('CTL_X')
    expect(effectiveBindingKeyOf('  ', '  ')).toBe('')
  })

  it('两键皆空 → 空串 = 无规范身份', () => {
    expect(effectiveBindingKeyOf('', '')).toBe('')
  })
})
