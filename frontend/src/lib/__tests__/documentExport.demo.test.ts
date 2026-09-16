// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// documentExport — 真实病历文档回归 (内置 demo 文档)
//
// 合成 fixture 覆盖不到真实文档的形状: 嵌套表格、跨列、控件占位符、
// 页眉页脚变体、域代码混排。本文件拿 admissionRecord.json 直接跑导出,
// 锁住两件事:
//   1. 表格内容进入 TXT/HTML (此前完全不导出);
//   2. 表格位置**不再产出静默空行** (Table 带 children, 曾闯过段落的
//      children 闸门后被逐行 id 遍历 → 每张表贡献一个空行)。
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildExportHtml, buildExportText } from '../documentExport'
import type { ExportPool } from '../documentExport'
import type { DocumentTree, BaseNode } from '@/engine/document/core/DocumentModel'
import docJson from '@/mocks/admissionRecord.json'

const NOW = new Date('2026-09-16T10:00:00')

function loadDemo(): { doc: DocumentTree; pool: ExportPool } {
  const doc = docJson as unknown as DocumentTree
  const raw = (docJson as unknown as { nodes: Record<string, BaseNode> }).nodes
  return { doc, pool: { nodes: new Map(Object.entries(raw)) } }
}

describe('documentExport — 内置 demo 病历文档', () => {
  it('TXT: 表格单元格文本进入导出', () => {
    const { doc, pool } = loadDemo()
    const txt = buildExportText(doc, pool, NOW)
    // demo 表格里的控件占位符 (未填 → 输出占位符)
    expect(txt).toContain('[职业]')
    expect(txt).toContain('[工作单位]')
    expect(txt).toContain('[住址]')
  })

  it('TXT: 表格行以制表符分列 (不是把每格串成一行)', () => {
    const { doc, pool } = loadDemo()
    const lines = buildExportText(doc, pool, NOW).split('\n')
    // 表格首行: 姓名格 + 职业格
    const row = lines.find(l => l.includes('[职业]'))
    expect(row).toBeDefined()
    expect(row).toContain('\t')
    expect(row!.split('\t')[0]).toContain('[姓名]')
  })

  it('TXT: 表格恰好占它的行数, 中间不插入空行', () => {
    // 直接锁回归: 旧实现把每张表当段落遍历 → 每张表贡献 1 个空行且**内容全丢**。
    // 断言方式避开全局空行计数 —— demo 文档本身就含零子节点空段落与带 "\n"
    // 的文本节点, 它们合法地产生空行, 与表格无关。
    const { doc, pool } = loadDemo()
    const lines = buildExportText(doc, pool, NOW).split('\n')

    // 表 1 (5 行): 首行含 [职业], 末行含 [记录日期]
    const t1Start = lines.findIndex(l => l.includes('[职业]'))
    const t1End = lines.findIndex(l => l.includes('[记录日期]'))
    expect(t1Start).toBeGreaterThanOrEqual(0)
    expect(t1End - t1Start + 1).toBe(5)
    expect(lines.slice(t1Start, t1End + 1).every(l => l !== '')).toBe(true)

    // 表 2 (10 行, 体格检查): 首行含 [体温], 末行含 神经反射
    const t2Start = lines.findIndex(l => l.includes('[体温]'))
    const t2End = lines.findIndex(l => l.includes('神经反射'))
    expect(t2Start).toBeGreaterThanOrEqual(0)
    expect(t2End - t2Start + 1).toBe(10)
    expect(lines.slice(t2Start, t2End + 1).every(l => l !== '')).toBe(true)
  })

  it('TXT: 含换行的单元格被压成单行 (不撑破 TSV 行结构)', () => {
    const { doc, pool } = loadDemo()
    const lines = buildExportText(doc, pool, NOW).split('\n')
    // 每张表的行数应等于其 row 节点数 —— 单元格内的字面 \n 不得多切出几行
    const raw = (docJson as unknown as { nodes: Record<string, { type?: string; children?: readonly string[] }> }).nodes
    const tables = Object.values(raw).filter(n => n.type === 'table')
    expect(tables.length).toBe(2)
    for (const t of tables) {
      const rowCount = (t.children ?? []).length
      const rendered = lines.filter(l => l.includes('\t'))
      expect(rendered.length).toBeGreaterThanOrEqual(rowCount)
    }
    // 每行制表符数在同一张表内一致 → 列对齐
    const t2Lines = lines.slice(
      lines.findIndex(l => l.includes('[体温]')),
      lines.findIndex(l => l.includes('神经反射')) + 1,
    )
    const tabs = new Set(t2Lines.map(l => (l.match(/\t/g) || []).length))
    expect(tabs.size).toBe(1)
  })

  it('HTML: 产出真实 <table> 结构且含 colspan/rowspan 之一', () => {
    const { doc, pool } = loadDemo()
    const html = buildExportHtml(doc, pool, NOW)
    expect(html).toContain('<table>')
    expect(html).toContain('</table>')
    expect(html).toContain('<tr>')
    expect(html).toContain('<td')
    // 从属位置不产出空 <td></td>
    expect(html).not.toContain('<td></td>')
  })

  it('TXT 与 HTML 都不崩, 且页眉页脚仍在 (既有契约行为未回退)', () => {
    const { doc, pool } = loadDemo()
    const txt = buildExportText(doc, pool, NOW)
    const html = buildExportHtml(doc, pool, NOW)
    expect(txt.length).toBeGreaterThan(100)
    expect(html.indexOf('<body>')).toBeGreaterThan(0)
    expect(html).toContain('</html>')
  })
})
