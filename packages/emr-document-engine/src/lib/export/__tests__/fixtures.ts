// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// 导出特性层的共享测试夹具
//
// 沿用 documentExport.test.ts 的 build()/addSmartText 约定 (doc + 池 Map),
// 另加 createSection 支持 —— 契约 §31.12 的「空 Section」与 §31.14.10 的
// 「sectionCode 重复」两条用例都需要真实的节结构。
// ============================================================

import {
  createDocument, createParagraph, createTextNode, createSmartTextNode,
  createTable, createTableRow, createTableCell, createSection,
} from '../../../engine/document/factory/ElementFormatter'
import type {
  DocumentTree, ElementMeta, TableCell,
} from '../../../engine/document/core/DocumentModel'
import type { FieldPool } from '../fields'

export interface Built {
  doc: DocumentTree
  pool: FieldPool
  /** 可写视图 —— 夹具用, 生产侧只读 */
  nodes: Map<string, unknown>
}

export function build(opts: {
  body?: string[]
  header?: string[]
  footer?: string[]
  title?: string
} = {}): Built {
  const doc = createDocument(opts.title ?? '导出测试')
  const nodes = new Map<string, unknown>()
  nodes.set(doc.id, doc)

  const mkPara = (text: string): string => {
    const tn = createTextNode(text)
    const p = createParagraph([tn.id])
    nodes.set(tn.id, tn)
    nodes.set(p.id, p)
    return p.id
  }

  doc.body.children = (opts.body ?? []).map(mkPara)
  doc.header = (opts.header ?? []).map(mkPara)
  doc.footer = (opts.footer ?? []).map(mkPara)

  return { doc, pool: { nodes } as unknown as FieldPool, nodes }
}

/** 在指定段落末尾追加一个 smarttext 控件 */
export function addSmartText(
  built: Built,
  paraId: string,
  element: ElementMeta,
  opts: { placeholder?: string; value?: string | number | string[] } = {},
): string {
  const st = createSmartTextNode(opts.placeholder ?? `[${element.name}]`, element)
  if (opts.value !== undefined) st.value = opts.value
  built.nodes.set(st.id, st)
  const para = built.nodes.get(paraId) as { children: string[] }
  para.children = [...para.children, st.id]
  return st.id
}

/** 把已有的段落收编进一个新建的 Section, 该节占第一个被收编段落的原位置 */
export function addSection(
  built: Built,
  paraIds: readonly string[],
  sectionCode?: string,
): string {
  const section = createSection([...paraIds], sectionCode)
  built.nodes.set(section.id, section)

  const children = built.doc.body.children
  const firstIdx = children.findIndex((id) => paraIds.includes(id))
  const remaining = children.filter((id) => !paraIds.includes(id))
  const at = firstIdx < 0 ? remaining.length : Math.min(firstIdx, remaining.length)
  built.doc.body.children = [...remaining.slice(0, at), section.id, ...remaining.slice(at)]
  return section.id
}

/** 在正文末尾追加一张表格, 返回 table id 与各单元格内首个段落的 id */
export function addTable(
  built: Built,
  rows: string[][],
  cellOpts?: (r: number, c: number) => Partial<TableCell>,
): { tableId: string; cellParagraphs: string[][] } {
  const cellParagraphs: string[][] = []
  const tableRows = rows.map((cells, r) => {
    const rowCells = cells.map((text, c) => {
      const tn = createTextNode(text)
      const p = createParagraph([tn.id])
      built.nodes.set(tn.id, tn)
      built.nodes.set(p.id, p)
      const cell = createTableCell([p.id], cellOpts?.(r, c))
      built.nodes.set(cell.id, cell)
      cellParagraphs[r] = cellParagraphs[r] ?? []
      cellParagraphs[r][c] = p.id
      return cell
    })
    const row = createTableRow(rowCells)
    built.nodes.set(row.id, row)
    return row
  })
  const table = createTable(
    Array.from({ length: rows[0]?.length ?? 0 }, () => ({ width: 100 })),
    tableRows,
  )
  built.nodes.set(table.id, table)
  built.doc.body.children = [...built.doc.body.children, table.id]
  return { tableId: table.id, cellParagraphs }
}

/** 便捷: 一个 dataType S1 的自由文本字段定义 */
export function s1Element(name: string, internal = 'CTL_INPUT', dataElement = 'DE1'): ElementMeta {
  return { code: { internal, dataElement }, name, format: { dataType: 'S1' } }
}

/** 便捷: 一个带枚举的字段定义 (枚举值是机器码, name 是显示名) */
export function enumElement(
  name: string,
  options: { name: string; value: string }[],
  opts: { multiple?: boolean; internal?: string; dataElement?: string } = {},
): ElementMeta {
  return {
    code: { internal: opts.internal ?? 'CTL_SELECT', dataElement: opts.dataElement ?? 'DE_ENUM' },
    name,
    format: { dataType: 'S1', enums: { multiple: opts.multiple ?? false, data: options } },
  }
}
