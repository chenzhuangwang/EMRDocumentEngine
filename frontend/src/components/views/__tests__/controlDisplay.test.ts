// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ControlDisplay 纯函数 — 控件属性面板只读展示投影 (契约 §12.5)
//
// 验证:
//   - controlTypeDisplayName: 复用目录展示名; undefined → 「未指定」不猜。
//   - semanticIdentityOf: 从 ElementMeta 投影 dataElement/dataType/
//     showType/enums/required/readonly; 缺字段 → 占位「—」; 无 element → null。
//   两者均为纯函数, 无副作用 → 展示不可能产生 setControlDefinition 回写。
// ================================================================

import { describe, it, expect } from 'vitest'
import { controlTypeDisplayName, semanticIdentityOf } from '../controlDisplay'
import type { ElementMeta } from '@/engine/document/core/DocumentModel'

describe('controlTypeDisplayName — 复用目录展示名 (契约 §12.5)', () => {
  it('7 个 controlType 各自映射到目录 name', () => {
    expect(controlTypeDisplayName('input')).toBe('单行文本')
    expect(controlTypeDisplayName('textarea')).toBe('多行文本')
    expect(controlTypeDisplayName('number')).toBe('数字输入')
    expect(controlTypeDisplayName('select')).toBe('下拉选择')
    expect(controlTypeDisplayName('date')).toBe('日期选择')
    expect(controlTypeDisplayName('checkbox')).toBe('复选框')
    expect(controlTypeDisplayName('radio')).toBe('单选框')
  })

  it('undefined (旧文档缺 controlType) → 「未指定」, 不猜', () => {
    expect(controlTypeDisplayName(undefined)).toBe('未指定')
  })
})

describe('semanticIdentityOf — 语义身份只读投影 (契约 §12.5)', () => {
  it('完整 ElementMeta → 投影全部 6 字段', () => {
    const el: ElementMeta = {
      code: { internal: 'CTL_SELECT', dataElement: 'DE99.99.004' },
      name: '下拉选择',
      format: {
        dataType: 'S1',
        showType: 'AN',
        enums: {
          multiple: false,
          data: [
            { name: '男', value: 'm' },
            { name: '女', value: 'f' },
            { name: '未知', value: 'u' },
          ],
        },
      },
      required: true,
      readonly: false,
    }
    expect(semanticIdentityOf(el)).toEqual({
      dataElement: 'DE99.99.004',
      dataType: 'S1',
      showType: 'AN',
      enums: '3 项',
      required: '是',
      readonly: '否',
    })
  })

  it('缺 format/showType/enums/required/readonly → 占位「—」与「否」', () => {
    const el: ElementMeta = { code: { internal: 'CTL_X', dataElement: 'DE99.99.001' }, name: 'x' }
    const id = semanticIdentityOf(el)!
    expect(id.dataElement).toBe('DE99.99.001')
    expect(id.dataType).toBe('—')
    expect(id.showType).toBe('—')
    expect(id.enums).toBe('—')
    expect(id.required).toBe('否')
    expect(id.readonly).toBe('否')
  })

  it('enums 空 data → 「0 项」', () => {
    const el: ElementMeta = {
      code: { internal: 'CTL_SELECT', dataElement: 'DE99.99.004' },
      name: 'x',
      format: { dataType: 'S1', enums: { data: [] } },
    }
    expect(semanticIdentityOf(el)!.enums).toBe('0 项')
  })

  it('无 element (旧文档缺语义) → null', () => {
    expect(semanticIdentityOf(undefined)).toBeNull()
  })
})
