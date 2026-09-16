// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// documentExport — 导出构建 (页眉/页脚必须包含)
//
// 回归: 原 handleExport 的 TXT/HTML 两个分支只遍历 doc.body.children,
// 页眉页脚完全丢失; 且内层只收 text 子节点, smarttext / 域代码被丢弃。
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  buildExportHtml, buildExportText, collectParagraphText, getListMarker,
} from '../documentExport'
import type { ExportPool } from '../documentExport'
import {
  createDocument, createParagraph, createTextNode, createSmartTextNode, createFieldNode,
  createTable, createTableRow, createTableCell,
} from '@/engine/document/factory/ElementFormatter'
import type {
  DocumentTree, BaseNode, ElementMeta, TableCell,
} from '@/engine/document/core/DocumentModel'

const NOW = new Date('2026-09-11T10:30:00')

interface Built { doc: DocumentTree; pool: ExportPool }

function build(opts: {
  body?: string[]
  header?: string[]
  footer?: string[]
  firstPageHeader?: string[]
  differentFirstPage?: boolean
}): Built {
  const doc = createDocument('导出测试')
  const nodes = new Map<string, BaseNode>()
  nodes.set(doc.id, doc as unknown as BaseNode)

  const mkPara = (text: string, children?: string[]) => {
    const tn = createTextNode(text)
    const p = createParagraph(children ?? [tn.id])
    nodes.set(tn.id, tn as unknown as BaseNode)
    nodes.set(p.id, p as unknown as BaseNode)
    return p.id
  }

  const bodyIds = (opts.body ?? []).map(t => mkPara(t))
  doc.body.children = bodyIds
  doc.header = (opts.header ?? []).map(t => mkPara(t))
  doc.footer = (opts.footer ?? []).map(t => mkPara(t))
  if (opts.firstPageHeader) {
    doc.firstPageHeader = opts.firstPageHeader.map(t => mkPara(t))
    doc.headerFooterConfig = { differentFirstPage: opts.differentFirstPage ?? true, differentOddEven: false }
  }

  return { doc, pool: { nodes } as unknown as ExportPool }
}

/** 在 doc/pool 上加一个 smarttext 子节点 */
function addSmartText(built: Built, paraId: string, placeholder: string, value?: string): void {
  const el: ElementMeta = { code: { internal: 'C1', dataElement: 'DE1' }, name: '姓名', format: { dataType: 'S1' } }
  const st = createSmartTextNode(placeholder, el)
  if (value !== undefined) st.value = value
  ;(built.pool.nodes as Map<string, unknown>).set(st.id, st)
  const para = built.pool.nodes.get(paraId) as unknown as { children: string[] }
  para.children = [...para.children, st.id]
}

/** 在 doc/pool 上加一个域代码子节点 */
function addField(built: Built, paraId: string, fieldType: 'page_number' | 'document_title'): void {
  const fld = createFieldNode(fieldType)
  ;(built.pool.nodes as Map<string, unknown>).set(fld.id, fld)
  const para = built.pool.nodes.get(paraId) as unknown as { children: string[] }
  para.children = [...para.children, fld.id]
}

/**
 * 在 doc/pool 追加一张表格 (并置于正文末尾), 返回 table id。
 * rows 为「实际存在的单元格」文本矩阵 —— 合并行只写它应有的单元格数,
 * colspan/rowspan 经 cellOpts 指定 (与池中真实形状一致)。
 */
function addTable(
  built: Built,
  rows: string[][],
  cellOpts?: (r: number, c: number) => Partial<TableCell>,
): string {
  const nodes = built.pool.nodes as Map<string, unknown>
  const tableRows = rows.map((cells, r) => {
    const rowCells = cells.map((text, c) => {
      const tn = createTextNode(text)
      const p = createParagraph([tn.id])
      nodes.set(tn.id, tn as unknown as BaseNode)
      nodes.set(p.id, p as unknown as BaseNode)
      const cell = createTableCell([p.id], cellOpts?.(r, c))
      nodes.set(cell.id, cell as unknown as BaseNode)
      return cell
    })
    const row = createTableRow(rowCells)
    nodes.set(row.id, row as unknown as BaseNode)
    return row
  })
  const table = createTable(
    Array.from({ length: rows[0]?.length ?? 0 }, () => ({ width: 100 })),
    tableRows,
  )
  nodes.set(table.id, table as unknown as BaseNode)
  built.doc.body.children = [...built.doc.body.children, table.id]
  return table.id
}

/** 表格第一行各单元格内首个段落的 id (供在单元格里插 smarttext/域) */
function firstRowCellParagraphs(built: Built, tableId: string): string[] {
  const nodes = built.pool.nodes
  const table = nodes.get(tableId) as unknown as { children: string[] }
  const row = nodes.get(table.children[0]) as unknown as { children: string[] }
  return row.children.map(
    cid => (nodes.get(cid) as unknown as { children: string[] }).children[0],
  )
}

describe('TXT 导出 — 页眉/页脚必须出现', () => {
  it('顺序为 页眉 → 正文 → 页脚', () => {
    const b = build({ header: ['页眉文字'], body: ['正文第一段', '正文第二段'], footer: ['页脚文字'] })
    const txt = buildExportText(b.doc, b.pool, NOW)
    const iHead = txt.indexOf('页眉文字')
    const iBody = txt.indexOf('正文第一段')
    const iFoot = txt.indexOf('页脚文字')
    expect(iHead).toBeGreaterThanOrEqual(0)
    expect(iBody).toBeGreaterThan(iHead)
    expect(iFoot).toBeGreaterThan(iBody)
  })

  it('页眉/页脚各只输出一次 (导出无分页)', () => {
    const b = build({ header: ['HEAD'], body: ['A', 'B', 'C'], footer: ['FOOT'] })
    const txt = buildExportText(b.doc, b.pool, NOW)
    expect(txt.split('HEAD').length - 1).toBe(1)
    expect(txt.split('FOOT').length - 1).toBe(1)
  })

  it('页眉页脚皆空时不崩且只有正文', () => {
    const b = build({ body: ['只有正文'] })
    const txt = buildExportText(b.doc, b.pool, NOW)
    expect(txt).toBe('只有正文')
  })

  it('无正文只有页脚时仍输出页脚', () => {
    const b = build({ body: [], footer: ['仅页脚'] })
    expect(buildExportText(b.doc, b.pool, NOW)).toBe('仅页脚')
  })
})

describe('TXT 导出 — smarttext / 域代码', () => {
  it('smarttext 输出显示值 (非空值优先), 不再被丢弃', () => {
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], '[姓名]', '张三')
    expect(collectParagraphText(b.doc.body.children[0], b.pool, b.doc, NOW)).toBe('张三')
  })

  it('smarttext 未填 → 输出占位符', () => {
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], '[姓名]')
    expect(collectParagraphText(b.doc.body.children[0], b.pool, b.doc, NOW)).toBe('[姓名]')
  })

  it('域代码输出解析文本, 不再打成占位字面量', () => {
    const b = build({ body: [''] })
    addField(b, b.doc.body.children[0], 'document_title')
    expect(collectParagraphText(b.doc.body.children[0], b.pool, b.doc, NOW)).toBe('导出测试')
  })

  it('页脚内的域代码同样参与导出', () => {
    const b = build({ body: ['正文'], footer: ['第', ' 页'] })
    // 在页脚首段插入 document_title 域
    addField(b, b.doc.footer![0], 'document_title')
    const txt = buildExportText(b.doc, b.pool, NOW)
    expect(txt).toContain('第导出测试')
  })
})

describe('TXT 导出 — 页眉变体回退', () => {
  it('仅填首页页眉 (differentFirstPage) → 导出仍含页眉内容', () => {
    const b = build({ body: ['正文'], firstPageHeader: ['首页页眉'] })
    const txt = buildExportText(b.doc, b.pool, NOW)
    expect(txt).toContain('首页页眉')
  })

  it('默认页眉非空时优先默认变体', () => {
    const b = build({ body: ['正文'], header: ['默认页眉'], firstPageHeader: ['首页页眉'] })
    const txt = buildExportText(b.doc, b.pool, NOW)
    expect(txt).toContain('默认页眉')
    expect(txt).not.toContain('首页页眉')
  })
})

describe('HTML 导出 — 页眉/页脚块', () => {
  it('页眉包在 <header>, 页脚包在 <footer>, 且正文在其间', () => {
    const b = build({ header: ['页眉'], body: ['正文'], footer: ['页脚'] })
    const html = buildExportHtml(b.doc, b.pool, NOW)
    expect(html).toContain('<header>')
    expect(html).toContain('</header>')
    expect(html).toContain('<footer>')
    expect(html).toContain('</footer>')
    expect(html.indexOf('页眉')).toBeLessThan(html.indexOf('正文'))
    expect(html.indexOf('正文')).toBeLessThan(html.indexOf('页脚'))
  })

  it('页眉页脚为空 → 不产出 header/footer 标签', () => {
    const b = build({ body: ['正文'] })
    const html = buildExportHtml(b.doc, b.pool, NOW)
    expect(html).not.toContain('<header>')
    expect(html).not.toContain('<footer>')
    expect(html).toContain('<p>正文</p>')
  })

  it('smarttext 与域代码进入 HTML 文本', () => {
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], '[姓名]', '张三')
    addField(b, b.doc.body.children[0], 'document_title')
    const html = buildExportHtml(b.doc, b.pool, NOW)
    expect(html).toContain('张三')
    expect(html).toContain('导出测试')
  })

  it('HTML 转义 < > &', () => {
    const b = build({ body: ['a<b>&c'] })
    const html = buildExportHtml(b.doc, b.pool, NOW)
    expect(html).toContain('a&lt;b&gt;&amp;c')
  })
})

describe('列表标记与既有行为保持一致', () => {
  it('无序列表带项目符号', () => {
    const b = build({ body: ['项目'] })
    const para = b.pool.nodes.get(b.doc.body.children[0]) as unknown as { list?: unknown }
    para.list = { type: 'bullet', level: 1 }
    const txt = buildExportText(b.doc, b.pool, NOW)
    expect(txt).not.toBe('项目')
    expect(txt).toContain('项目')
  })

  it('有序列表按 level 递增编号', () => {
    const b = build({ body: ['甲', '乙'] })
    for (const id of b.doc.body.children) {
      ;(b.pool.nodes.get(id) as unknown as { list?: unknown }).list = { type: 'ordered', level: 1 }
    }
    const txt = buildExportText(b.doc, b.pool, NOW)
    const lines = txt.split('\n')
    expect(lines[0]).toContain(getListMarker({ type: 'ordered', level: 1 }, 1))
    expect(lines[1]).toContain(getListMarker({ type: 'ordered', level: 1 }, 2))
  })

  it('HTML 列表产出 <ol>/<li>', () => {
    const b = build({ body: ['甲', '乙'] })
    for (const id of b.doc.body.children) {
      ;(b.pool.nodes.get(id) as unknown as { list?: unknown }).list = { type: 'ordered', level: 1 }
    }
    const html = buildExportHtml(b.doc, b.pool, NOW)
    expect(html).toContain('<ol>')
    expect(html).toContain('</ol>')
    expect(html).toContain('<li>')
  })

  it('页眉块内列表编号独立于正文 (计数器按块重置)', () => {
    const b = build({ header: ['页眉甲', '页眉乙'], body: ['正文甲'] })
    for (const id of [b.doc.header![0], b.doc.header![1], b.doc.body.children[0]]) {
      ;(b.pool.nodes.get(id) as unknown as { list?: unknown }).list = { type: 'ordered', level: 1 }
    }
    const txt = buildExportText(b.doc, b.pool, NOW)
    // 块间以空行分隔 → 过滤空行后取各块的行
    const lines = txt.split('\n').filter(l => l !== '')
    // 页眉两条 → 1, 2; 正文块重新从 1 开始
    expect(lines[0]).toContain(getListMarker({ type: 'ordered', level: 1 }, 1))
    expect(lines[1]).toContain(getListMarker({ type: 'ordered', level: 1 }, 2))
    expect(lines[2]).toContain(getListMarker({ type: 'ordered', level: 1 }, 1))
  })
})

describe('表格导出 — 内容进入导出且不留静默空行', () => {
  it('TXT: 表格内容出现, 且不再产出空行', () => {
    const b = build({ body: ['前'] })
    const tableId = addTable(b, [['A', 'B'], ['C', 'D']])
    b.doc.body.children = [tableId, ...b.doc.body.children.filter(id => id !== tableId)]
    // 旧行为: 表格闯过段落闸门 → 被逐行 id 遍历 → 静默产出一个空行
    expect(buildExportText(b.doc, b.pool, NOW)).toBe('A\tB\nC\tD\n前')
  })

  it('TXT: 单元格以制表符分隔, 行以换行分隔', () => {
    const b = build({ body: [] })
    addTable(b, [['姓名', '张三'], ['性别', '男']])
    expect(buildExportText(b.doc, b.pool, NOW).split('\n'))
      .toEqual(['姓名\t张三', '性别\t男'])
  })

  it('TXT: 表格内 smarttext 与正文同源 (取显示值)', () => {
    const b = build({ body: [] })
    const tableId = addTable(b, [['', '']])
    addSmartText(b, firstRowCellParagraphs(b, tableId)[0], '[姓名]', '张三')
    expect(buildExportText(b.doc, b.pool, NOW)).toBe('张三\t')
  })

  it('TXT: colspan 的从属列留空, 不重复父值 (保持列对齐)', () => {
    const b = build({ body: [] })
    addTable(b, [['合并'], ['甲', '乙']], (r) => (r === 0 ? { colspan: 2 } : {}))
    expect(buildExportText(b.doc, b.pool, NOW).split('\n'))
      .toEqual(['合并\t', '甲\t乙'])
  })

  it('TXT: rowspan 覆盖的后续行留空, 不重复父值', () => {
    const b = build({ body: [] })
    addTable(
      b,
      [['跨行', '甲'], ['乙']],
      (r, c) => (r === 0 && c === 0 ? { rowspan: 2 } : {}),
    )
    expect(buildExportText(b.doc, b.pool, NOW).split('\n'))
      .toEqual(['跨行\t甲', '\t乙'])
  })

  it('空表格既不产出空行 (TXT) 也不产出空表标记 (HTML)', () => {
    const b = build({ body: ['前'] })
    const tableId = addTable(b, [])
    b.doc.body.children = [tableId, ...b.doc.body.children.filter(id => id !== tableId)]
    expect(buildExportText(b.doc, b.pool, NOW)).toBe('前')
    expect(buildExportHtml(b.doc, b.pool, NOW)).not.toContain('<table>')
  })

  it('HTML: 产出 <table>/<tr>/<td> 结构', () => {
    const b = build({ body: [] })
    addTable(b, [['A', 'B']])
    expect(buildExportHtml(b.doc, b.pool, NOW))
      .toContain('<table><tr><td>A</td><td>B</td></tr></table>')
  })

  it('HTML: colspan 以属性表达, 从属位置不产出 <td>', () => {
    const b = build({ body: [] })
    addTable(b, [['合并'], ['甲', '乙']], (r) => (r === 0 ? { colspan: 2 } : {}))
    const html = buildExportHtml(b.doc, b.pool, NOW)
    expect(html).toContain('<td colspan="2">合并</td>')
    expect(html).not.toContain('<td></td>')
  })

  it('HTML: rowspan 以属性表达', () => {
    const b = build({ body: [] })
    addTable(b, [['跨行', '甲'], ['乙']], (r, c) => (r === 0 && c === 0 ? { rowspan: 2 } : {}))
    expect(buildExportHtml(b.doc, b.pool, NOW)).toContain('<td rowspan="2">跨行</td>')
  })

  it('HTML: isHeader 单元格产出 <th>', () => {
    const b = build({ body: [] })
    addTable(b, [['表头', '值']], () => ({ isHeader: true }))
    expect(buildExportHtml(b.doc, b.pool, NOW)).toContain('<th>表头</th><th>值</th>')
  })

  it('HTML: 单元格内保留 bold run, 且内容被转义', () => {
    const b = build({ body: [] })
    const tableId = addTable(b, [['a<b']])
    const tn = createTextNode('粗', { bold: true })
    const paraId = firstRowCellParagraphs(b, tableId)[0]
    ;(b.pool.nodes as Map<string, unknown>).set(tn.id, tn as unknown as BaseNode)
    const para = b.pool.nodes.get(paraId) as unknown as { children: string[] }
    para.children = [...para.children, tn.id]
    const html = buildExportHtml(b.doc, b.pool, NOW)
    expect(html).toContain('a&lt;b')
    expect(html).toContain('<strong>粗</strong>')
  })

  it('页眉区域的表格同样参与导出', () => {
    const b = build({ body: ['正文'], header: ['页眉'] })
    const tableId = addTable(b, [['页眉表', '格']])
    // addTable 追加在正文, 移到页眉以验证该路径
    b.doc.body.children = b.doc.body.children.filter(id => id !== tableId)
    b.doc.header = [...b.doc.header!, tableId]
    const txt = buildExportText(b.doc, b.pool, NOW)
    expect(txt).toContain('页眉表\t格')
    expect(txt.indexOf('页眉表')).toBeGreaterThan(txt.indexOf('页眉'))
  })
})
