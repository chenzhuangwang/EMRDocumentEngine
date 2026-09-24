// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// documentExport — 文档 → 纯文本 / HTML 导出构建 (UI 层)
//
// 从 EditorPage.handleExport 抽出的纯函数, 便于单测 (不依赖 React)。
// 非平凡逻辑一律委托 engine: 页眉页脚变体解析 (hfParagraphsForExport),
// smarttext 显示值 (smartTextDisplayValue), 域代码 (resolveFieldText)。
//
// 块顺序: 页眉 → 正文 → 页脚 (导出无分页概念, 每个区域整体输出一次)。
// 表格参与导出: 经 buildMergeMatrix 还原列位 (合并单元格留空不重复值),
// TXT 以 \t 分隔单元格, HTML 以 colspan/rowspan 表达合并。
// 表格样式 (底纹/对齐) 不导出 —— 表现层不属内容导出 (契约 §2.2)。
// ============================================================

import {
  hfParagraphsForExport, resolveFieldText, smartTextDisplayValue, buildMergeMatrix, locale,
  bodyBlockSpine,
} from '@/engine'
import type { MergeMatrix } from '@/engine'
import type { DocumentTree, ListStyle } from '@/engine/document/core/DocumentModel'
import { ListParticle } from '@/engine/render/particles/ListParticle'

/** 导出期读取池的最小结构 (只读; 结构上满足引擎的 SpinePool, 契约 §31) */
export interface ExportPool {
  nodes: ReadonlyMap<string, { type: string; children?: readonly string[] }>
}

interface ParaLike {
  children?: readonly string[]
  list?: ListStyle
}
interface InlineLike {
  type?: string
  text?: string
  value?: unknown
  bold?: boolean
  italic?: boolean
  underline?: boolean
  fieldType?: string
  cachedValue?: string
}
interface TableLike { type?: string; children?: readonly string[] }
interface RowLike { children?: readonly string[] }
interface CellLike {
  type?: string
  children?: readonly string[]
  colspan?: number
  rowspan?: number
  isHeader?: boolean
}

/** 生成列表标记文本 (供 TXT/HTML 导出) */
export function getListMarker(list: ListStyle, orderNum?: number): string {
  const level = list.level || 1
  const indent = '  '.repeat(level - 1)
  if (list.type === 'bullet') {
    const bulletChar = list.bulletChar || ListParticle.resolveBulletChar(level)
    return indent + bulletChar + ' '
  }
  // ordered list
  const num = orderNum ?? (list.startAt || 1)
  const numberStyle = list.numberStyle || 'decimal'
  return indent + ListParticle.formatOrderedNumberRaw(num, numberStyle) + '. '
}

/** 有序列表计数器 (按 level 追踪), 每个容器块独立 */
function makeOrderedCounters() {
  const counters = new Map<number, number>()
  let lastLevel = 0
  return {
    /** 返回该段落的列表标记 (非列表返回 '') */
    marker(list?: ListStyle): string {
      if (!list) { lastLevel = 0; return '' }
      const level = list.level || 1
      if (list.type !== 'ordered' || level !== lastLevel) {
        if (lastLevel > 0) counters.delete(lastLevel)
      }
      lastLevel = level
      if (list.type === 'ordered' && !list.startAt) {
        const count = (counters.get(level) || 0) + 1
        counters.set(level, count)
        return getListMarker(list, count)
      }
      if (list.startAt) counters.set(level, list.startAt)
      return getListMarker(list)
    },
  }
}

/** 域代码在导出稿中的解析上下文 (无分页 → 页数类域退化为 1) */
function exportFieldContext(doc: DocumentTree, now: Date) {
  // locale 现读: 导出件里的日期域格式应与导出那一刻的界面语言一致
  // (与渲染期 Draw.resolveFieldText 同源, 否则屏幕与导出件不一致)
  return { pageNumber: 1, totalPages: 1, documentTitle: doc.title, now, locale: locale.getLocale() }
}

/** 单段落的纯文本 (text + smarttext 显示值 + 域代码), 与 TXT 语义一致 */
export function collectParagraphText(
  paraId: string,
  pool: ExportPool,
  doc: DocumentTree,
  now: Date,
): string {
  const para = pool.nodes.get(paraId) as ParaLike | undefined
  if (!para?.children) return ''
  const ctx = exportFieldContext(doc, now)
  let out = ''
  for (const cid of para.children) {
    const n = pool.nodes.get(cid) as InlineLike | undefined
    if (!n) continue
    if (n.type === 'text') out += (n.text || '')
    else if (n.type === 'smarttext') out += smartTextDisplayValue(n as { text: string; value?: never })
    else if (n.type === 'field') out += resolveFieldText(n.fieldType, n.cachedValue, ctx)
  }
  return out
}

/** 节点是否为表格 —— 表格同样带 children, 会闯过段落的 children 闸门, 必须显式分发 */
function isTableNode(id: string, pool: ExportPool): boolean {
  return (pool.nodes.get(id) as TableLike | undefined)?.type === 'table'
}

/** 表格网格 (含合并跨度) —— TXT 与 HTML 共用同一坐标解析, 不各推一套 */
function buildTableGrid(tableId: string, pool: ExportPool): MergeMatrix {
  const table = pool.nodes.get(tableId) as TableLike | undefined
  const rows = (table?.children ?? []).map((rowId) => {
    const row = pool.nodes.get(rowId) as RowLike | undefined
    const cells = (row?.children ?? []).map((cellId) => {
      const cell = pool.nodes.get(cellId) as CellLike | undefined
      return { id: cellId, colspan: cell?.colspan, rowspan: cell?.rowspan }
    })
    return { cells }
  })
  return buildMergeMatrix(rows)
}

/**
 * 网格位置 (row, col) 上的「起始单元格」id。
 *
 * 被合并跨度覆盖的从属位置返回 null —— 导出留空, 不重复父单元格的值
 * (HTML 侧由 colspan/rowspan 属性表达, TXT 侧留空格位保持列对齐)。
 */
function originCellAt(matrix: MergeMatrix, row: number, col: number): string | null {
  const cellId = matrix.getCell(row, col)
  if (!cellId) return null
  const span = matrix.getSpan(cellId)
  if (span && (span.row !== row || span.col !== col)) return null
  return cellId
}

/** 单元格纯文本: 内部段落按阅读顺序以空格连接; 嵌套表格压成单行 */
function collectCellText(
  cellId: string,
  pool: ExportPool,
  doc: DocumentTree,
  now: Date,
): string {
  const cell = pool.nodes.get(cellId) as CellLike | undefined
  if (!cell?.children) return ''
  const parts: string[] = []
  for (const childId of cell.children) {
    if (isTableNode(childId, pool)) {
      const nested = collectTableText(childId, pool, doc, now)
      if (nested) parts.push(nested)
    } else {
      parts.push(collectParagraphText(childId, pool, doc, now))
    }
  }
  // 单元格内容必须留在**单行**内: 文本节点里可能带字面 \n (作者敲的回车),
  // 若原样输出会把 TSV 的行结构撑破 —— 一张 10 行的表会变成 12 行, 且后续
  // 各行的列数与表头对不齐。
  return parts.filter((p) => p !== '').join(' ').replace(/\s*\n\s*/g, ' ')
}

/**
 * 表格纯文本: 行以 \n 分隔, 单元格以 \t 分隔 (制表符便于粘回表格)。
 * 单元格内的 smarttext / 域代码与正文同源 (复用 collectParagraphText)。
 */
export function collectTableText(
  tableId: string,
  pool: ExportPool,
  doc: DocumentTree,
  now: Date,
): string {
  const matrix = buildTableGrid(tableId, pool)
  const lines: string[] = []
  for (let r = 0; r < matrix.rows; r++) {
    const cells: string[] = []
    for (let c = 0; c < matrix.cols; c++) {
      const cellId = originCellAt(matrix, r, c)
      cells.push(cellId ? collectCellText(cellId, pool, doc, now) : '')
    }
    lines.push(cells.join('\t'))
  }
  return lines.join('\n')
}

/**
 * 纯文本导出: 页眉块 → 正文块 → 页脚块 (块间空行分隔)。
 */
export function buildExportText(doc: DocumentTree, pool: ExportPool, now: Date = new Date()): string {
  const blocks: string[] = []
  const blocksToEmit: Array<readonly string[]> = [
    hfParagraphsForExport(doc, 'header'),
    bodyBlockSpine(doc, pool),
    hfParagraphsForExport(doc, 'footer'),
  ]
  for (const ids of blocksToEmit) {
    const counters = makeOrderedCounters()
    const lines: string[] = []
    for (const paraId of ids) {
      // 表格先分发: 否则会以「有 children 的段落」身份闯过下面的闸门,
      // 再被逐个子节点当成行 id 遍历 → 静默产出一个空行。
      if (isTableNode(paraId, pool)) {
        counters.marker(undefined)   // 表格是块级非列表元素, 编号在此断掉
        const tableText = collectTableText(paraId, pool, doc, now)
        if (tableText) lines.push(tableText)
        continue
      }
      const para = pool.nodes.get(paraId) as ParaLike | undefined
      if (!para?.children) continue
      lines.push(counters.marker(para.list) + collectParagraphText(paraId, pool, doc, now))
    }
    if (lines.length > 0) blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n')
}

interface Run { text: string; bold: boolean; italic: boolean; underline: boolean }

/** 单段落的样式 run 序列 (text / smarttext / 域; 按 bold/italic/underline 断点) */
export function collectParagraphRuns(
  paraId: string,
  pool: ExportPool,
  doc: DocumentTree,
  now: Date,
): Run[] {
  const para = pool.nodes.get(paraId) as ParaLike | undefined
  if (!para?.children) return []
  const ctx = exportFieldContext(doc, now)
  const runs: Run[] = []
  for (const cid of para.children) {
    const n = pool.nodes.get(cid) as InlineLike | undefined
    if (!n) continue
    let piece = ''
    if (n.type === 'text') piece = n.text || ''
    else if (n.type === 'smarttext') piece = smartTextDisplayValue(n as { text: string; value?: never })
    else if (n.type === 'field') piece = resolveFieldText(n.fieldType, n.cachedValue, ctx)
    if (!piece) continue
    const run: Run = { text: piece, bold: !!n.bold, italic: !!n.italic, underline: !!n.underline }
    const last = runs[runs.length - 1]
    if (last && last.bold === run.bold && last.italic === run.italic && last.underline === run.underline) {
      last.text += run.text
    } else {
      runs.push(run)
    }
  }
  return runs
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function runsToHtml(runs: Run[]): string {
  let out = ''
  for (const r of runs) {
    let html = escapeHtml(r.text)
    if (r.bold) html = `<strong>${html}</strong>`
    if (r.italic) html = `<em>${html}</em>`
    if (r.underline) html = `<u>${html}</u>`
    out += html
  }
  return out
}

/** 渲染一个段落块 (列表 → <ol>/<ul>, 否则 <p>); 返回 HTML 片段数组 */
function emitHtmlBlock(
  ids: readonly string[],
  pool: ExportPool,
  doc: DocumentTree,
  now: Date,
  out: string[],
): void {
  const counters = makeOrderedCounters()
  let inListType = ''       // 'bullet' | 'ordered' | ''
  let inListLevel = 0
  const flushList = () => {
    if (inListType) {
      out.push(inListType === 'ordered' ? '</ol>' : '</ul>')
      inListType = ''
      inListLevel = 0
    }
  }

  for (const paraId of ids) {
    // 表格先分发并闭合已开启的列表 (与 TXT 侧同构)
    if (isTableNode(paraId, pool)) {
      flushList()
      counters.marker(undefined)
      emitHtmlTable(paraId, pool, doc, now, out)
      continue
    }
    const para = pool.nodes.get(paraId) as ParaLike | undefined
    if (!para?.children) continue
    const htmlText = runsToHtml(collectParagraphRuns(paraId, pool, doc, now))
    const list = para.list

    if (list) {
      const level = list.level || 1
      const listTag = list.type === 'ordered' ? 'ordered' : 'bullet'
      if (listTag !== inListType || level !== inListLevel) {
        flushList()
        out.push(listTag === 'ordered' ? '<ol>' : '<ul>')
        inListType = listTag
        inListLevel = level
      }
      out.push(`<li>${counters.marker(list)}${htmlText}</li>`)
    } else {
      flushList()
      counters.marker(undefined)
      if (htmlText) out.push(`<p>${htmlText}</p>`)
    }
  }
  flushList()
}

/**
 * 表格 → HTML 表格标记。合并跨度用 colspan/rowspan 属性表达 (从属位置不产出
 * <td>); isHeader → <th>; 底纹/对齐等表现层样式不导出 (契约 §2.2)。
 */
function emitHtmlTable(
  tableId: string,
  pool: ExportPool,
  doc: DocumentTree,
  now: Date,
  out: string[],
): void {
  const table = pool.nodes.get(tableId) as TableLike | undefined
  if (!table?.children?.length) return
  const matrix = buildTableGrid(tableId, pool)
  out.push('<table>')
  for (let r = 0; r < matrix.rows; r++) {
    out.push('<tr>')
    for (let c = 0; c < matrix.cols; c++) {
      const cellId = originCellAt(matrix, r, c)
      if (!cellId) continue
      const cell = pool.nodes.get(cellId) as CellLike | undefined
      const span = matrix.getSpan(cellId)
      const tag = cell?.isHeader ? 'th' : 'td'
      let attrs = ''
      if (span && span.colspan > 1) attrs += ` colspan="${span.colspan}"`
      if (span && span.rowspan > 1) attrs += ` rowspan="${span.rowspan}"`
      out.push(`<${tag}${attrs}>`)
      for (const childId of cell?.children ?? []) {
        if (isTableNode(childId, pool)) emitHtmlTable(childId, pool, doc, now, out)
        else out.push(runsToHtml(collectParagraphRuns(childId, pool, doc, now)))
      }
      out.push(`</${tag}>`)
    }
    out.push('</tr>')
  }
  out.push('</table>')
}

/**
 * HTML 导出: 页眉块 → 正文块 → 页脚块。
 * 页眉/页脚用 <header>/<footer> 包住, 便于区分。
 */
export function buildExportHtml(doc: DocumentTree, pool: ExportPool, now: Date = new Date()): string {
  const out: string[] = [
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>',
    escapeHtml(doc.title),
    '</title></head><body>',
  ]

  const header = hfParagraphsForExport(doc, 'header')
  if (header.length > 0) {
    out.push('<header>')
    emitHtmlBlock(header, pool, doc, now, out)
    out.push('</header>')
  }

  emitHtmlBlock(bodyBlockSpine(doc, pool), pool, doc, now, out)

  const footer = hfParagraphsForExport(doc, 'footer')
  if (footer.length > 0) {
    out.push('<footer>')
    emitHtmlBlock(footer, pool, doc, now, out)
    out.push('</footer>')
  }

  out.push('</body></html>')
  return out.join('')
}
