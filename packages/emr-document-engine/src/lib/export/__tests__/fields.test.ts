// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// fields — 字段清单语义投影
//
// 本文件锁住三件在三个导出格式间共享的事实:
//   1. 显示值走枚举映射 (controlValueDisplay), **不是**原始机器码;
//   2. 未填字段不被过滤;
//   3. 节归属 / 表格归属 / 重复数据元码都被显式表达。
// ============================================================

import { describe, it, expect } from 'vitest'
import { collectFields } from '../fields'
import { sectionTreeOf } from '../../../engine'
import {
  build, addSmartText, addSection, addTable, s1Element, enumElement,
} from './fixtures'

const MARRIAGE = enumElement('婚姻', [ { name: '已婚', value: 'Y' }, { name: '未婚', value: 'N' } ])
const NATION = enumElement('民族', [ { name: '汉族', value: 'hz' }, { name: '维吾尔族', value: 'w' } ])

describe('collectFields — 显示值', () => {
  it('枚举值映射回候选 name, 同时保留原始机器码', () => {
    const b = build({ body: [''] })
    const paraId = b.doc.body.children[0]
    addSmartText(b, paraId, MARRIAGE, { placeholder: '[婚姻]', value: 'N' })

    const p = collectFields({ doc: b.doc as never, pool: b.pool })
    expect(p.fields).toHaveLength(1)
    expect(p.fields[0].value).toBe('N')       // 机器码原样
    expect(p.fields[0].display).toBe('未婚')   // 显示名 —— 与屏幕一致
    expect(p.fields[0].displaySource).toBe('enum')
    expect(p.fields[0].name).toBe('婚姻')
    expect(p.fields[0].placeholder).toBe('[婚姻]')
  })

  it('多选值逐项映射显示名', () => {
    const multi = enumElement('过敏史', [
      { name: '青霉素', value: 'pcn' }, { name: '磺胺', value: 'sulfa' },
    ], { multiple: true })
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], multi, { value: ['pcn', 'sulfa'] })

    const f = collectFields({ doc: b.doc as never, pool: b.pool }).fields[0]
    expect(f.value).toEqual(['pcn', 'sulfa'])
    expect(f.display).toBe('青霉素、磺胺')
    expect(f.multiple).toBe(true)
  })

  it('未填 → value=null 且 display=占位符, 字段本身仍在清单里', () => {
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], s1Element('姓名'), { placeholder: '[姓名]' })

    const p = collectFields({ doc: b.doc as never, pool: b.pool })
    expect(p.fields).toHaveLength(1)
    expect(p.fields[0].filled).toBe(false)
    expect(p.fields[0].value).toBeNull()
    expect(p.fields[0].display).toBe('[姓名]')
    expect(p.fields[0].displaySource).toBe('placeholder')
    expect(p.diagnostics).toEqual({
      fieldCount: 1, filledCount: 0, duplicateElementCodes: [],
    })
  })

  it('空数组视为未填 (契约 §12.6.1)', () => {
    const multi = enumElement('过敏史', [ { name: '青霉素', value: 'pcn' } ], { multiple: true })
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], multi, { value: [] })
    const f = collectFields({ doc: b.doc as never, pool: b.pool }).fields[0]
    expect(f.filled).toBe(false)
    expect(f.value).toBeNull()
  })

  it('空串视为未填', () => {
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], s1Element('姓名'), { value: '' })
    expect(collectFields({ doc: b.doc as never, pool: b.pool }).fields[0].filled).toBe(false)
  })
})

describe('collectFields — 区域与顺序', () => {
  it('正文 → 页眉 → 页脚, order 跨区域连续', () => {
    const b = build({ body: ['', ''], header: [''], footer: [''] })
    addSmartText(b, b.doc.body.children[0], s1Element('正文A', 'C1', 'DE_A'))
    addSmartText(b, b.doc.body.children[1], s1Element('正文B', 'C1', 'DE_B'))
    addSmartText(b, b.doc.header![0], s1Element('页眉C', 'C1', 'DE_C'))
    addSmartText(b, b.doc.footer![0], s1Element('页脚D', 'C1', 'DE_D'))

    const p = collectFields({ doc: b.doc as never, pool: b.pool })
    expect(p.fields.map((f) => f.name)).toEqual(['正文A', '正文B', '页眉C', '页脚D'])
    expect(p.fields.map((f) => f.order)).toEqual([0, 1, 2, 3])
    expect(p.fields.map((f) => f.region)).toEqual(['body', 'body', 'header', 'footer'])
  })

  it('表格单元格内的字段被收进清单并带表格归属', () => {
    const b = build({ body: [] })
    const { cellParagraphs } = addTable(b, [['', '']])
    addSmartText(b, cellParagraphs[0][1], s1Element('格内', 'C1', 'DE_CELL'))

    const f = collectFields({ doc: b.doc as never, pool: b.pool }).fields[0]
    expect(f.name).toBe('格内')
    expect(f.location.tableId).toBeTruthy()
    expect(f.location.cellIndex).toEqual({ row: 0, col: 1 })
  })

  it('非表格内字段的归属为空', () => {
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], s1Element('正文'))
    const f = collectFields({ doc: b.doc as never, pool: b.pool }).fields[0]
    expect(f.location).toEqual({ tableId: null, cellIndex: null })
  })
})

describe('collectFields — 节归属', () => {
  it('节内字段带上 sectionId 与 sectionCode', () => {
    const b = build({ body: ['', ''] })
    const [p1, p2] = b.doc.body.children
    addSection(b, [p2], 'past_history')
    addSmartText(b, p2, s1Element('既往史字段', 'C1', 'DE_PH'))

    const p = collectFields({
      doc: b.doc as never, pool: b.pool, sectionTree: sectionTreeOf(b.doc as never, b.pool),
    })
    const f = p.fields.find((x) => x.name === '既往史字段')!
    expect(f.sectionCode).toBe('past_history')
    expect(f.sectionId).toBeTruthy()
    expect(p.sections).toHaveLength(1)
    expect(p.sections[0].anonymous).toBe(false)
    expect(p.sections[0].codeDuplicate).toBe(false)
    void p1
  })

  it('无节文档: 字段 sectionId/sectionCode 为 null, sections 为空', () => {
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], s1Element('孤儿'))
    const p = collectFields({ doc: b.doc as never, pool: b.pool, sectionTree: sectionTreeOf(b.doc as never, b.pool) })
    expect(p.sections).toEqual([])
    expect(p.fields[0].sectionId).toBeNull()
    expect(p.fields[0].sectionCode).toBeNull()
  })

  it('匿名节被标记 (无 sectionCode), 不静默丢弃', () => {
    const b = build({ body: ['', ''] })
    addSection(b, [b.doc.body.children[1]])
    const p = collectFields({ doc: b.doc as never, pool: b.pool, sectionTree: sectionTreeOf(b.doc as never, b.pool) })
    expect(p.sections).toHaveLength(1)
    expect(p.sections[0].anonymous).toBe(true)
    expect(p.sections[0].code).toBeNull()
  })

  it('重复 sectionCode 的两个节都被标记 codeDuplicate (契约 §31.14.10 未强制唯一)', () => {
    const b = build({ body: ['', '', '', ''] })
    const [a1, a2, b1, b2] = b.doc.body.children
    addSection(b, [a1, a2], 'past_history')
    addSection(b, [b1, b2], 'past_history')

    const p = collectFields({ doc: b.doc as never, pool: b.pool, sectionTree: sectionTreeOf(b.doc as never, b.pool) })
    expect(p.sections).toHaveLength(2)
    expect(p.sections.every((s) => s.codeDuplicate)).toBe(true)
    expect(p.sections.every((s) => s.code === 'past_history')).toBe(true)
  })
})

describe('collectFields — 诊断', () => {
  it('重复 dataElement 码被列进 diagnostics (mock 文档是退化样本)', () => {
    const b = build({ body: ['', ''] })
    addSmartText(b, b.doc.body.children[0], s1Element('姓名', 'CTL_INPUT', 'DE99.99.001'))
    addSmartText(b, b.doc.body.children[1], s1Element('职业', 'CTL_INPUT', 'DE99.99.001'))
    addSmartText(b, b.doc.body.children[1], s1Element('性别', 'CTL_INPUT', 'DE_UNIQUE'))

    const p = collectFields({ doc: b.doc as never, pool: b.pool })
    expect(p.diagnostics.duplicateElementCodes).toEqual(['DE99.99.001'])
    expect(p.diagnostics.fieldCount).toBe(3)
  })

  it('已填计数正确', () => {
    const b = build({ body: ['', ''] })
    addSmartText(b, b.doc.body.children[0], s1Element('A'), { value: 'x' })
    addSmartText(b, b.doc.body.children[1], s1Element('B'))
    const p = collectFields({ doc: b.doc as never, pool: b.pool })
    expect(p.diagnostics).toMatchObject({ fieldCount: 2, filledCount: 1 })
  })
})

describe('collectFields — 定义层与隐私标记', () => {
  it('controlType 从 TemplateDefinition 按 nodeId 取 (不在 ElementMeta 上)', () => {
    const b = build({ body: [''] })
    const nodeId = addSmartText(b, b.doc.body.children[0], MARRIAGE, { value: 'N' })
    const defs = new Map([[nodeId, { controlType: 'radio', label: '婚姻状况' }]])

    const f = collectFields({ doc: b.doc as never, pool: b.pool, templateDefinitions: defs }).fields[0]
    expect(f.controlType).toBe('radio')
    expect(f.definition.label).toBe('婚姻状况')
  })

  it('无 TemplateDefinition → controlType 为 null, 各字段为 null', () => {
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], MARRIAGE)
    const f = collectFields({ doc: b.doc as never, pool: b.pool }).fields[0]
    expect(f.controlType).toBeNull()
    expect(f.definition).toEqual({
      label: null, prefix: null, suffix: null, tips: null,
      single: null, editable: null, deletable: null,
    })
  })

  it('privacy.enabled → masked:true, 但值仍导出真值 (本轮既定策略)', () => {
    const el = s1Element('身份证')
    el.privacy = { enabled: true, maskChar: '*', maskRule: 'partial' }
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], el, { value: '310101199001011234' })

    const f = collectFields({ doc: b.doc as never, pool: b.pool }).fields[0]
    expect(f.masked).toBe(true)
    expect(f.value).toBe('310101199001011234')
    expect(f.display).toBe('310101199001011234')
  })

  it('枚举候选被带出 (下游无需回池查定义)', () => {
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], NATION, { value: 'w' })
    const f = collectFields({ doc: b.doc as never, pool: b.pool }).fields[0]
    expect(f.enumOptions).toEqual([ { name: '汉族', value: 'hz' }, { name: '维吾尔族', value: 'w' } ])
    expect(f.display).toBe('维吾尔族')
  })

  it('字典来源的枚举经注入的 optionsOf 取得', () => {
    const dictEl: import('../../../engine').ElementMeta = {
      code: { internal: 'CTL_SELECT', dataElement: 'DE_DICT' }, name: '职业',
      format: { dataType: 'S1', dictionary: 'occupation' },
    }
    const b = build({ body: [''] })
    const nodeId = addSmartText(b, b.doc.body.children[0], dictEl, { value: '11' })

    const f = collectFields({
      doc: b.doc as never, pool: b.pool,
      optionsOf: (id) => (id === nodeId ? [ { name: '医生', value: '11' } ] : undefined),
    }).fields[0]
    expect(f.enumOptions).toEqual([ { name: '医生', value: '11' } ])
    expect(f.display).toBe('医生')
    expect(f.displaySource).toBe('enum')
    expect(f.format.dictionary).toBe('occupation')
  })

  it('有候选表但值查不到 → display 原样输出, displaySource 标为 raw (不假装映射过)', () => {
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], MARRIAGE, { value: 'X' })
    const f = collectFields({ doc: b.doc as never, pool: b.pool }).fields[0]
    expect(f.display).toBe('X')
    expect(f.displaySource).toBe('raw')
    expect(f.value).toBe('X')
  })

  it('无候选表的自由文本 → raw', () => {
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], s1Element('姓名'), { value: '张三' })
    const f = collectFields({ doc: b.doc as never, pool: b.pool }).fields[0]
    expect(f.display).toBe('张三')
    expect(f.displaySource).toBe('raw')
    expect(f.enumOptions).toBeNull()
  })
})
