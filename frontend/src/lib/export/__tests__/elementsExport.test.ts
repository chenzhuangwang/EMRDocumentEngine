// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// elementsExport — 结构化元素产物
//
// 锁三件事: 产物可 JSON 往返 (不丢字段)、枚举的「码 + 名」同时在、未填字段
// 以 null 显式表达而不是被 JSON.stringify 吞掉。
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildElementsDocument, ELEMENTS_KIND, ELEMENTS_SCHEMA_VERSION } from '../elementsExport'
import { collectFields } from '../fields'
import { build, addSmartText, enumElement, s1Element } from './fixtures'

const NOW = new Date('2026-09-29T12:00:00.000Z')

const MARRIAGE = enumElement('婚姻', [ { name: '已婚', value: 'Y' }, { name: '未婚', value: 'N' } ])

function demoProjection() {
  const b = build({ body: ['', ''], title: '入院记录' })
  addSmartText(b, b.doc.body.children[0], s1Element('姓名', 'CTL_INPUT', 'DE_NAME'), { value: '张三' })
  addSmartText(b, b.doc.body.children[1], MARRIAGE, { value: 'N' })
  return collectFields({ doc: b.doc as never, pool: b.pool })
}

describe('buildElementsDocument', () => {
  it('顶层形状稳定 (schemaVersion / kind / generatedAt)', () => {
    const out = buildElementsDocument({
      projection: demoProjection(),
      document: { id: 'd1', title: '入院记录' },
      now: NOW,
    })
    expect(out.schemaVersion).toBe(ELEMENTS_SCHEMA_VERSION)
    expect(out.kind).toBe(ELEMENTS_KIND)
    expect(out.generatedAt).toBe('2026-09-29T12:00:00.000Z')
  })

  it('枚举字段机器码与显示名同时存在', () => {
    const out = buildElementsDocument({
      projection: demoProjection(), document: {}, now: NOW,
    })
    const fields = out.fields as { name: string; value: unknown; display: string; displaySource: string }[]
    const marriage = fields.find((f) => f.name === '婚姻')!
    expect(marriage.value).toBe('N')
    expect(marriage.display).toBe('未婚')
    expect(marriage.displaySource).toBe('enum')
  })

  it('经 JSON 往返后未填字段仍是 null, 不是消失', () => {
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], s1Element('职业'), { placeholder: '[职业]' })
    const out = buildElementsDocument({
      projection: collectFields({ doc: b.doc as never, pool: b.pool }),
      document: {}, now: NOW,
    })
    const roundTripped = JSON.parse(JSON.stringify(out)) as { fields: Record<string, unknown>[] }
    expect(roundTripped.fields).toHaveLength(1)
    expect('value' in roundTripped.fields[0]).toBe(true)
    expect(roundTripped.fields[0].value).toBeNull()
    expect(roundTripped.fields[0].filled).toBe(false)
  })

  it('文档级可观测值与字段清单分开 (fields 只放控件)', () => {
    const out = buildElementsDocument({
      projection: demoProjection(),
      document: {
        id: 'd1', title: '入院记录', modelVersion: '4.5.0',
        layout: { pageWidth: 794, pageHeight: 1123, pageCount: 3 },
        stats: { words: 120 },
      },
      now: NOW,
    })
    expect(out.document).toMatchObject({
      id: 'd1', title: '入院记录', modelVersion: '4.5.0',
      layout: { pageWidth: 794, pageHeight: 1123, pageCount: 3 },
      stats: { words: 120 },
    })
    // fields 里不得混入文档级信息
    const fields = out.fields as Record<string, unknown>[]
    expect(fields.every((f) => !('layout' in f) && !('metadata' in f))).toBe(true)
  })

  it('缺省文档信息落成 null 而不是被省略 (形状稳定, 消费方不必判 undefined)', () => {
    const out = buildElementsDocument({ projection: demoProjection(), document: {}, now: NOW })
    expect(out.document).toEqual({
      id: null, title: null, modelVersion: null,
      pageSetup: null, layout: null, metadata: null, stats: null,
    })
  })

  it('诊断随产物一起出 (退化编码对下游可见)', () => {
    const b = build({ body: ['', ''] })
    addSmartText(b, b.doc.body.children[0], s1Element('A', 'C', 'DE_DUP'))
    addSmartText(b, b.doc.body.children[1], s1Element('B', 'C', 'DE_DUP'))
    const out = buildElementsDocument({
      projection: collectFields({ doc: b.doc as never, pool: b.pool }), document: {}, now: NOW,
    })
    expect(out.diagnostics).toEqual({
      fieldCount: 2, filledCount: 0, duplicateElementCodes: ['DE_DUP'],
    })
  })
})
