// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// cdaExport — HL7 CDA 骨架
//
// 重点锁的是**不得静默丢内容**的那几条 (契约 §31.5 / §31.12 / §31.14.10):
// 空节要出、无节内容要出且被标记、重复节码要出且被标记、未填字段要出且带
// nullFlavor。良构性一律交给 DOMParser 判定。
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildCdaXml, UNASSIGNED_SECTION_CODE } from '../cdaExport'
import { collectFields } from '../fields'
import { sectionTreeOf } from '@/engine'
import { build, addSmartText, addSection, enumElement, s1Element } from './fixtures'

const NOW = new Date('2026-09-29T12:00:00Z')
const BASE = { now: NOW, language: 'zh-CN' } as const

const MARRIAGE = enumElement('婚姻', [ { name: '已婚', value: 'Y' }, { name: '未婚', value: 'N' } ])

function project(b: ReturnType<typeof build>) {
  return collectFields({
    doc: b.doc as never, pool: b.pool, sectionTree: sectionTreeOf(b.doc as never, b.pool),
  })
}

function parse(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  expect(doc.getElementsByTagName('parsererror').length, 'XML 必须是良构的').toBe(0)
  return doc
}

/** 按 localName 取元素 (忽略命名空间前缀差异) */
function byLocal(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter((e) => e.localName === name)
}

describe('buildCdaXml — 骨架与良构性', () => {
  it('产出良构的 ClinicalDocument, 带 CDA 与 emrde 两个命名空间', () => {
    const b = build({ body: [''], title: '入院记录' })
    addSmartText(b, b.doc.body.children[0], s1Element('姓名'), { value: '张三' })

    const { xml } = buildCdaXml({ projection: project(b), document: { id: 'd1', title: '入院记录' }, ...BASE })
    const doc = parse(xml)

    expect(doc.documentElement.localName).toBe('ClinicalDocument')
    expect(doc.documentElement.getAttribute('xmlns')).toBe('urn:hl7-org:v3')
    expect(doc.documentElement.getAttribute('xmlns:emrde')).toBe('urn:emrde:cda:1')
    expect(byLocal(doc, 'title')[0].textContent).toBe('入院记录')
    expect(byLocal(doc, 'structuredBody')).toHaveLength(1)
  })

  it('languageCode 用调用方给的语言, 不硬编码', () => {
    const b = build({ body: [''] })
    const zh = buildCdaXml({ projection: project(b), document: {}, ...BASE })
    const en = buildCdaXml({ projection: project(b), document: {}, now: NOW, language: 'en-US' })
    expect(byLocal(parse(zh.xml), 'languageCode')[0].getAttribute('code')).toBe('zh-CN')
    expect(byLocal(parse(en.xml), 'languageCode')[0].getAttribute('code')).toBe('en-US')
  })

  it('带溯源记录 (元素形式, 与 UI 边界注入的注释同源)', () => {
    const b = build({ body: [''] })
    const { xml } = buildCdaXml({ projection: project(b), document: {}, ...BASE })
    const prov = byLocal(parse(xml), 'provenance')
    expect(prov).toHaveLength(1)
    expect(prov[0].getAttribute('generator')).toMatch(/EMRDocumentEngine/)
    expect(prov[0].getAttribute('license')).toBe('MPL-2.0')
  })
})

describe('buildCdaXml — 节 (契约 §31.12 / §31.14.10)', () => {
  it('空 Section 仍然输出 <section> —— 这是本格式比 TXT/HTML 强的地方', () => {
    const b = build({ body: ['', ''] })
    // 一个只含空段落的节: 没有任何字段, 但节本身必须出现
    const [p1, p2] = b.doc.body.children
    addSection(b, [p2], 'empty_section')
    addSmartText(b, p1, s1Element('正文'))

    const { xml } = buildCdaXml({ projection: project(b), document: {}, ...BASE })
    const codes = byLocal(parse(xml), 'code').map((c) => c.getAttribute('code'))
    expect(codes).toContain('empty_section')
  })

  it('sectionCode 出现在该节 section 的 code/@code 上', () => {
    const b = build({ body: ['', ''] })
    const p2 = b.doc.body.children[1]
    addSection(b, [p2], 'past_history')
    addSmartText(b, p2, s1Element('既往史', 'C1', 'DE_PH'), { value: '无' })

    const { xml } = buildCdaXml({ projection: project(b), document: {}, ...BASE })
    const hit = byLocal(parse(xml), 'code').find((c) => c.getAttribute('code') === 'past_history')!
    expect(hit).toBeTruthy()
    expect(hit.getAttribute('codeSystem')).toBe('urn:emrde:section-code')
  })

  it('无节文档: 内容进合成节 UNASSIGNED 并标 anonymous (不静默丢弃)', () => {
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], s1Element('姓名'), { value: '张三' })

    const { xml } = buildCdaXml({ projection: project(b), document: {}, ...BASE })
    const doc = parse(xml)
    const codes = byLocal(doc, 'code').map((c) => c.getAttribute('code'))
    expect(codes).toContain(UNASSIGNED_SECTION_CODE)
    expect(byLocal(doc, 'anonymous')).toHaveLength(1)
    // 字段本身必须在
    expect(byLocal(doc, 'observation')).toHaveLength(1)
  })

  it('两节共用同一 sectionCode: 两节都输出, 且都带 sectionCodeDuplicate', () => {
    const b = build({ body: ['', '', '', ''] })
    const [a1, a2, b1, b2] = b.doc.body.children
    addSection(b, [a1, a2], 'past_history')
    addSection(b, [b1, b2], 'past_history')
    addSmartText(b, a2, s1Element('A', 'C', 'DE_A'), { value: '1' })
    addSmartText(b, b2, s1Element('B', 'C', 'DE_B'), { value: '2' })

    const { xml } = buildCdaXml({ projection: project(b), document: {}, ...BASE })
    const doc = parse(xml)
    const dupCode = byLocal(doc, 'code').filter((c) => c.getAttribute('code') === 'past_history')
    expect(dupCode).toHaveLength(2)                        // 不去重
    expect(byLocal(doc, 'sectionCodeDuplicate')).toHaveLength(2)
  })

  it('匿名节 (无 sectionCode) 被显式标记, 内容不丢', () => {
    const b = build({ body: ['', ''] })
    const p2 = b.doc.body.children[1]
    addSection(b, [p2])                    // 无 code
    addSmartText(b, p2, s1Element('匿名节字段', 'C', 'DE_X'), { value: 'v' })

    const { xml } = buildCdaXml({ projection: project(b), document: {}, ...BASE })
    const doc = parse(xml)
    expect(byLocal(doc, 'anonymous').length).toBeGreaterThanOrEqual(1)
    expect(byLocal(doc, 'observation')).toHaveLength(1)
  })
})

describe('buildCdaXml — 字段值', () => {
  it('枚举字段同时给机器码与显示名, 并带完整候选表', () => {
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], MARRIAGE, { value: 'N' })

    const { xml } = buildCdaXml({ projection: project(b), document: {}, ...BASE })
    const doc = parse(xml)
    const value = byLocal(doc, 'value')[0]
    expect(value.getAttribute('xsi:type')).toBe('CD')
    expect(value.getAttribute('code')).toBe('N')          // 机器码
    expect(value.getAttribute('displayName')).toBe('未婚') // 显示名
    const options = byLocal(doc, 'option').map((o) => `${o.getAttribute('name')}=${o.getAttribute('value')}`)
    expect(options).toEqual(['已婚=Y', '未婚=N'])
  })

  it('自由文本字段: 值进 ST 的 value 属性 (与码/名二分无关)', () => {
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], s1Element('姓名'), { value: '张三' })

    const { xml } = buildCdaXml({ projection: project(b), document: {}, ...BASE })
    const value = byLocal(parse(xml), 'value')[0]
    expect(value.getAttribute('xsi:type')).toBe('ST')
    expect(value.getAttribute('value')).toBe('张三')
  })

  it('未填字段: value 带 nullFlavor="NI", 占位符进 text (不消失)', () => {
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], s1Element('职业'), { placeholder: '[职业]' })

    const { xml } = buildCdaXml({ projection: project(b), document: {}, ...BASE })
    const doc = parse(xml)
    const value = byLocal(doc, 'value')[0]
    expect(value.getAttribute('nullFlavor')).toBe('NI')
    expect(value.getAttribute('value')).toBeNull()
    const text = byLocal(doc, 'text').map((t) => t.textContent)
    expect(text.some((t) => t?.includes('[职业]'))).toBe(true)
  })

  it('多选字段拆成多条 observation, 各带 emrde:index (不造一个无法切分的串)', () => {
    const multi = enumElement('过敏史', [
      { name: '青霉素', value: 'pcn' }, { name: '磺胺', value: 'sulfa' },
    ], { multiple: true })
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], multi, { value: ['pcn', 'sulfa'] })

    const { xml } = buildCdaXml({ projection: project(b), document: {}, ...BASE })
    const doc = parse(xml)
    expect(byLocal(doc, 'observation')).toHaveLength(2)
    const idx = byLocal(doc, 'multiple').map((m) => m.getAttribute('index'))
    expect(idx).toEqual(['0', '1'])
  })

  it('每条 observation 都带 emrde:nodeId (退化编码下按码取值不可靠)', () => {
    const b = build({ body: ['', ''] })
    addSmartText(b, b.doc.body.children[0], s1Element('A', 'C', 'DE99.99.001'), { value: '1' })
    addSmartText(b, b.doc.body.children[1], s1Element('B', 'C', 'DE99.99.001'), { value: '2' })

    const { xml } = buildCdaXml({ projection: project(b), document: {}, ...BASE })
    const doc = parse(xml)
    const obs = byLocal(doc, 'observation')
    expect(obs).toHaveLength(2)
    const nodeIds = byLocal(doc, 'nodeId').map((n) => n.getAttribute('value'))
    expect(nodeIds.filter(Boolean)).toHaveLength(2)
    expect(new Set(nodeIds).size).toBe(2)                   // 两条可区分
  })

  it('重复数据元码在 diagnostics 里被点名', () => {
    const b = build({ body: ['', ''] })
    addSmartText(b, b.doc.body.children[0], s1Element('A', 'C', 'DE_DUP'), { value: '1' })
    addSmartText(b, b.doc.body.children[1], s1Element('B', 'C', 'DE_DUP'), { value: '2' })

    const { xml } = buildCdaXml({ projection: project(b), document: {}, ...BASE })
    const dups = byLocal(parse(xml), 'duplicateElementCode').map((d) => d.getAttribute('code'))
    expect(dups).toEqual(['DE_DUP'])
  })

  it('number 值出 xsi:type="INT"', () => {
    const numEl = { code: { internal: 'CTL_NUMBER', dataElement: 'DE_N' }, name: '年龄', format: { dataType: 'N' as const } }
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], numEl, { value: 42 })

    const { xml } = buildCdaXml({ projection: project(b), document: {}, ...BASE })
    const value = byLocal(parse(xml), 'value')[0]
    expect(value.getAttribute('xsi:type')).toBe('INT')
    expect(value.getAttribute('value')).toBe('42')
  })

  it('脱敏标记字段: 值仍输出真值, 同时带 emrde:masked', () => {
    const el = s1Element('身份证')
    el.privacy = { enabled: true, maskChar: '*', maskRule: 'partial' }
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], el, { value: '310101199001011234' })

    const { xml } = buildCdaXml({ projection: project(b), document: {}, ...BASE })
    const doc = parse(xml)
    expect(byLocal(doc, 'masked')).toHaveLength(1)
    expect(byLocal(doc, 'value')[0].getAttribute('value')).toBe('310101199001011234')
  })

  it('值里含 XML 元字符不会破坏良构性', () => {
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], s1Element('备注'), { value: `a<b>&"c'</b>` })

    const { xml } = buildCdaXml({ projection: project(b), document: {}, ...BASE })
    const doc = parse(xml)
    expect(byLocal(doc, 'value')[0].getAttribute('value')).toBe(`a<b>&"c'</b>`)
  })

  it('剔除的非法字符数被上报 (不静默)', () => {
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], s1Element('备注'), {
      value: `坏${String.fromCharCode(0x01)}字`,
    })
    const { droppedChars } = buildCdaXml({ projection: project(b), document: {}, ...BASE })
    // 同一个非法字符会在三处出现: 节叙述 (text)、observation 的 text、value 属性。
    // 本模块按**出现次数**计数 —— 报的是「剔了多少次」, 不是「去了几个不同的字」。
    expect(droppedChars).toBe(3)
  })
})
