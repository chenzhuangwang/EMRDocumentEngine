// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// fields — 真实病历文档回归 (内置 demo)
//
// 合成夹具覆盖不到真实文档的形状。这份 demo 恰好带着两个「机器码 ≠ 显示名」
// 的真实控件 (婚姻 N→未婚、民族 w→维吾尔族) —— 正是既存 TXT/HTML 导出出错的
// 那一类数据, 也是本投影必须正确处理的核心用例。
//
// 同时它是一份**编码退化**样本: 28 个控件里 27 个共用同一个 dataElement 占位码。
// 这条事实必须被显式记录 (diagnostics.duplicateElementCodes), 否则下游会以为
// 按码取值是可用的。
// ============================================================

import { describe, it, expect } from 'vitest'
import { collectFields } from '../fields'
import { sectionTreeOf } from '@/engine'
import type { DocumentTree, BaseNode } from '@/engine/document/core/DocumentModel'
import type { TemplateDefinition } from '@/engine/template/TemplateDefinition'
import docJson from '@/mocks/admissionRecord.json'

function loadDemo() {
  const doc = docJson as unknown as DocumentTree
  const raw = (docJson as unknown as { nodes: Record<string, BaseNode> }).nodes
  const pool = { nodes: new Map(Object.entries(raw)) }
  const defsRaw = (docJson as unknown as { templateDefinitions?: Record<string, TemplateDefinition> }).templateDefinitions
  const templateDefinitions = defsRaw ? new Map(Object.entries(defsRaw)) : undefined
  return { doc, pool, templateDefinitions }
}

describe('fields — 内置 demo 病历文档', () => {
  it('收齐全部 28 个控件 (页眉页脚与表格内的也算)', () => {
    const { doc, pool, templateDefinitions } = loadDemo()
    const p = collectFields({ doc, pool, templateDefinitions, sectionTree: sectionTreeOf(doc, pool) })
    expect(p.diagnostics.fieldCount).toBe(28)
  })

  it('枚举控件的机器码与显示名都给了 (婚姻 N→未婚, 民族 w→维吾尔族)', () => {
    const { doc, pool, templateDefinitions } = loadDemo()
    const p = collectFields({ doc, pool, templateDefinitions, sectionTree: sectionTreeOf(doc, pool) })

    const marriage = p.fields.find((f) => f.name === '婚姻')!
    expect(marriage.value).toBe('N')
    expect(marriage.display).toBe('未婚')
    expect(marriage.displaySource).toBe('enum')

    const nation = p.fields.find((f) => f.name === '民族')!
    expect(nation.value).toBe('w')
    expect(nation.display).toBe('维吾尔族')
  })

  it('未填控件不被过滤, 且带占位符', () => {
    const { doc, pool, templateDefinitions } = loadDemo()
    const p = collectFields({ doc, pool, templateDefinitions, sectionTree: sectionTreeOf(doc, pool) })

    expect(p.diagnostics.filledCount).toBe(2)
    const unfilled = p.fields.filter((f) => !f.filled)
    expect(unfilled.length).toBe(26)
    expect(unfilled.every((f) => f.value === null)).toBe(true)
    // 未填的 display 就是占位符 (屏幕上也是这么显示的)
    expect(unfilled.every((f) => f.display === f.placeholder)).toBe(true)
    expect(unfilled.every((f) => f.displaySource === 'placeholder')).toBe(true)
  })

  it('退化编码被显式记录: 27 个控件共用 DE99.99.001', () => {
    const { doc, pool, templateDefinitions } = loadDemo()
    const p = collectFields({ doc, pool, templateDefinitions, sectionTree: sectionTreeOf(doc, pool) })
    expect(p.diagnostics.duplicateElementCodes).toContain('DE99.99.001')

    const shared = p.fields.filter((f) => f.code.dataElement === 'DE99.99.001')
    expect(shared.length).toBeGreaterThan(20)
  })

  it('demo 无 Section: 所有字段的节归属为空', () => {
    const { doc, pool, templateDefinitions } = loadDemo()
    const p = collectFields({ doc, pool, templateDefinitions, sectionTree: sectionTreeOf(doc, pool) })
    expect(p.sections).toEqual([])
    expect(p.fields.every((f) => f.sectionId === null && f.sectionCode === null)).toBe(true)
  })

  it('表格内的控件带表格归属 (demo 有 2 张表)', () => {
    const { doc, pool, templateDefinitions } = loadDemo()
    const p = collectFields({ doc, pool, templateDefinitions, sectionTree: sectionTreeOf(doc, pool) })
    const inTable = p.fields.filter((f) => f.location.tableId !== null)
    expect(inTable.length).toBeGreaterThan(0)
    expect(inTable.every((f) => f.location.cellIndex !== null)).toBe(true)
  })

  it('controlType 从 templateDefinitions 带出', () => {
    const { doc, pool, templateDefinitions } = loadDemo()
    const p = collectFields({ doc, pool, templateDefinitions, sectionTree: sectionTreeOf(doc, pool) })
    expect(p.fields.some((f) => f.controlType === 'input')).toBe(true)
    expect(p.fields.every((f) => f.controlType !== undefined)).toBe(true)
  })

  it('order 是连续的 0..27 (阅读顺序)', () => {
    const { doc, pool, templateDefinitions } = loadDemo()
    const p = collectFields({ doc, pool, templateDefinitions, sectionTree: sectionTreeOf(doc, pool) })
    expect(p.fields.map((f) => f.order)).toEqual(
      Array.from({ length: p.fields.length }, (_, i) => i),
    )
  })
})
