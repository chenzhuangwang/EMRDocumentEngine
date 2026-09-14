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
// 已知限制 (与本模块无关的既有缺口): 表格内容不参与导出。
// ============================================================

import {
  hfParagraphsForExport, resolveFieldText, smartTextDisplayValue,
} from '@/engine'
import type { DocumentTree, ListStyle } from '@/engine/document/core/DocumentModel'
import { ListParticle } from '@/engine/render/particles/ListParticle'

/** 导出期读取池的最小结构 (只读) */
export interface ExportPool {
  nodes: ReadonlyMap<string, unknown>
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
  return { pageNumber: 1, totalPages: 1, documentTitle: doc.title, now }
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

/**
 * 纯文本导出: 页眉块 → 正文块 → 页脚块 (块间空行分隔)。
 */
export function buildExportText(doc: DocumentTree, pool: ExportPool, now: Date = new Date()): string {
  const blocks: string[] = []
  const blocksToEmit: Array<readonly string[]> = [
    hfParagraphsForExport(doc, 'header'),
    doc.body.children,
    hfParagraphsForExport(doc, 'footer'),
  ]
  for (const ids of blocksToEmit) {
    const counters = makeOrderedCounters()
    const lines: string[] = []
    for (const paraId of ids) {
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

  emitHtmlBlock(doc.body.children, pool, doc, now, out)

  const footer = hfParagraphsForExport(doc, 'footer')
  if (footer.length > 0) {
    out.push('<footer>')
    emitHtmlBlock(footer, pool, doc, now, out)
    out.push('</footer>')
  }

  out.push('</body></html>')
  return out.join('')
}
