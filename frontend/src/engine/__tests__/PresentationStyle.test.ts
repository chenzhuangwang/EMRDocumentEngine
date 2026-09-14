// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// PresentationStyle 单元测试 (契约 §2.2)
//
// 覆盖:
//   1. 边界 (type-level + 运行时): DocumentModel 的 SmartTextNode /
//      ElementMeta / Paragraph 不得携带表现层字段 (borderStyle/
//      contentWrap/contentStyle/minWidth/textAlign) —— 它们只属于
//      渲染域的表现层样式。
//   2. store 读写语义: set/get/has/delete/clear/size/遍历。
// ============================================================

import { describe, it, expect, expectTypeOf } from 'vitest'
import { PresentationStyleStore } from '../render/presentation/PresentationStyle'
import type { PresentationStyle } from '../render/presentation/PresentationStyle'
import type { SmartTextNode, ElementMeta, Paragraph } from '../document/core/DocumentModel'
import { createSmartTextNode } from '../document/factory/ElementFormatter'

const PRESENTATION_FIELDS = ['borderStyle', 'contentWrap', 'contentStyle', 'minWidth', 'textAlign'] as const

describe('PresentationStyle 边界 (契约 §2.2)', () => {
  it('type-level: SmartTextNode 不得携带表现层字段', () => {
    expectTypeOf<SmartTextNode>().not.toHaveProperty('borderStyle')
    expectTypeOf<SmartTextNode>().not.toHaveProperty('contentWrap')
    expectTypeOf<SmartTextNode>().not.toHaveProperty('contentStyle')
    expectTypeOf<SmartTextNode>().not.toHaveProperty('minWidth')
    expectTypeOf<SmartTextNode>().not.toHaveProperty('textAlign')
  })

  it('type-level: ElementMeta 不得携带表现层字段', () => {
    expectTypeOf<ElementMeta>().not.toHaveProperty('borderStyle')
    expectTypeOf<ElementMeta>().not.toHaveProperty('contentWrap')
    expectTypeOf<ElementMeta>().not.toHaveProperty('contentStyle')
    expectTypeOf<ElementMeta>().not.toHaveProperty('minWidth')
    expectTypeOf<ElementMeta>().not.toHaveProperty('textAlign')
  })

  it('type-level: Paragraph 不得携带表现层字段', () => {
    expectTypeOf<Paragraph>().not.toHaveProperty('borderStyle')
    expectTypeOf<Paragraph>().not.toHaveProperty('contentWrap')
    expectTypeOf<Paragraph>().not.toHaveProperty('contentStyle')
    expectTypeOf<Paragraph>().not.toHaveProperty('minWidth')
    expectTypeOf<Paragraph>().not.toHaveProperty('textAlign')
  })

  it('运行时: createSmartTextNode 结果不含表现层字段', () => {
    const element = { code: { internal: 'HDSD00.02.055', dataElement: 'DE08.10.052.00' }, name: '医疗机构组织机构代码' }
    const st = createSmartTextNode('[机构代码]', element)
    for (const k of PRESENTATION_FIELDS) {
      expect(k in st, `SmartTextNode 不应含字段 ${k}`).toBe(false)
    }
  })
})

describe('PresentationStyleStore', () => {
  it('set/get/has 基本读写', () => {
    const store = new PresentationStyleStore()
    const id = 'node-1'
    expect(store.has(id)).toBe(false)
    expect(store.get(id)).toBeUndefined()

    store.set(id, { borderStyle: 'solid', minWidth: '168px' })
    expect(store.has(id)).toBe(true)
    expect(store.get(id)?.borderStyle).toBe('solid')
    expect(store.get(id)?.minWidth).toBe('168px')
  })

  it('set 同节点覆盖旧值', () => {
    const store = new PresentationStyleStore()
    store.set('n', { contentWrap: true })
    store.set('n', { contentWrap: false, textAlign: 'center' })
    expect(store.get('n')).toEqual({ contentWrap: false, textAlign: 'center' })
  })

  it('delete 返回是否确实删除, clear/size 一致', () => {
    const store = new PresentationStyleStore()
    store.set('a', {})
    store.set('b', {})
    expect(store.size).toBe(2)
    expect(store.delete('a')).toBe(true)
    expect(store.delete('a')).toBe(false)
    expect(store.size).toBe(1)
    store.clear()
    expect(store.size).toBe(0)
  })

  it('entries/keys/values 遍历', () => {
    const store = new PresentationStyleStore()
    store.set('a', { textAlign: 'left' })
    store.set('b', { contentWrap: true })
    expect([...store.keys()].sort()).toEqual(['a', 'b'])
    expect([...store.values()].length).toBe(2)
    const entries = new Map<string, PresentationStyle>(store.entries())
    expect(entries.get('b')?.contentWrap).toBe(true)
  })

  it('minWidth 兼容 number 与 string 两种来源', () => {
    const store = new PresentationStyleStore()
    store.set('x', { minWidth: 15 })
    store.set('y', { minWidth: '168px' })
    expect(store.get('x')?.minWidth).toBe(15)
    expect(store.get('y')?.minWidth).toBe('168px')
  })
})
