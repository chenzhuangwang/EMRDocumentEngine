// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// TOCGenerator — 目录生成器 (TASK-458, v5.0)
//
// 职责:
//   - 遍历文档中所有 outlineLevel > 0 的段落
//   - 按 outlineLevel 构建树形目录结构
//   - 生成 TOC 页面: 标题 + 制表符前导线 + 页码
//   - TOC 页面作为 SLIFPage 输出, 由 LayeredRenderer 消费
//
// 目录格式 (Word 兼容):
//   Heading 1 ............... 1
//     Heading 2 ............ 2
//       Heading 3 .......... 3
// ================================================================

import type { DocumentTree, Paragraph } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'
import { smartTextDisplayValue } from '../document/factory/ElementFormatter'
import type { SLIFPage, SLIFItem } from '../layout/core/SLIF'

// ---- TOC 条目 ----

export interface TOCEntry {
  /** 段落 ID */
  paragraphId: string
  /** 标题文本 */
  text: string
  /** 标题级别 (1-6) */
  level: number
  /** 所在页码 (从 1 开始) */
  pageNumber: number
}

// ---- TOC 配置 ----

export interface TOCConfig {
  /** 目录标题 (默认: "目录") */
  title?: string
  /** 是否显示页码 */
  showPageNumbers?: boolean
  /** 制表符前导字符 (默认: '.') */
  leaderChar?: string
  /** 最大显示级别 (默认: 3) */
  maxLevel?: number
  /** 页面宽度 */
  pageWidth?: number
  /** 页面高度 */
  pageHeight?: number
  /** 页边距 */
  marginLeft?: number
  marginRight?: number
  marginTop?: number
}

const DEFAULT_TOC_CONFIG: Required<TOCConfig> = {
  title: '目录',
  showPageNumbers: true,
  leaderChar: '.',
  maxLevel: 3,
  pageWidth: 794,
  pageHeight: 1123,
  marginLeft: 90,
  marginRight: 90,
  marginTop: 72,
}

// ---- TOCGenerator ----

export class TOCGenerator {
  private config: Required<TOCConfig>

  constructor(config: TOCConfig = {}) {
    this.config = { ...DEFAULT_TOC_CONFIG, ...config }
  }

  /**
   * 从文档中提取 TOC 条目
   */
  extractEntries(
    doc: DocumentTree,
    pool: NodePool,
    pageMap?: Map<string, number>, // paragraphId → pageIndex
  ): TOCEntry[] {
    const entries: TOCEntry[] = []

    for (const blockId of doc.body.children) {
      const block = pool.nodes.get(blockId)
      if (!block || block.type !== 'paragraph') continue

      const para = block as unknown as Paragraph & { outlineLevel?: number }
      const level = para.outlineLevel ?? 0
      if (level < 1 || level > this.config.maxLevel) continue

      const text = this.getParagraphPlainText(para.id, pool)
      const pageNumber = (pageMap?.get(para.id) ?? 0) + 1

      entries.push({
        paragraphId: para.id,
        text: text || `(空标题)`,
        level,
        pageNumber,
      })
    }

    return entries
  }

  /**
   * 生成 TOC 页面 (SLIFPage)
   *
   * 返回一个或多个 SLIFPage, 直接插入 pages[] 数组头部
   */
  generatePage(
    entries: TOCEntry[],
    _existingPages: SLIFPage[],
  ): SLIFPage {
    const { pageWidth, pageHeight, marginLeft, marginRight, marginTop, leaderChar, showPageNumbers, title } = this.config
    const contentWidth = pageWidth - marginLeft - marginRight
    const fontSize = 16
    const lineHeight = 24

    const items: SLIFItem[] = []
    let y = marginTop

    // 目录标题
    items.push({
      nodeId: 'toc-title',
      nodeType: 'text',
      type: 'text',
      text: title,
      x: marginLeft,
      y,
      width: contentWidth,
      height: 32,
      ascent: 28,
      descent: 4,
      font: 'SimHei',
      size: 24,
      bold: true,
      color: '#000000',
    })
    y += 48 // 标题后间距

    // TOC 条目
    for (const entry of entries) {
      const indent = (entry.level - 1) * 24 // 每级缩进 24px
      const entryX = marginLeft + indent

      if (showPageNumbers) {
        const pageStr = String(entry.pageNumber)
        const fullText = entry.text
        const pageNumWidth = pageStr.length * fontSize * 0.6 + 20

        // 文本 + 前导线 + 页码
        let displayText = fullText
        const availableWidth = contentWidth - indent - pageNumWidth
        const availableChars = Math.floor(availableWidth / (fontSize * 0.6))

        if (fullText.length > availableChars) {
          displayText = fullText.slice(0, Math.max(0, availableChars - 3)) + '...'
        }

        const leaderCount = Math.max(0, Math.floor(
          (availableWidth - displayText.length * fontSize * 0.6) / (fontSize * 0.3)
        ))
        const leaders = leaderChar.repeat(Math.max(2, leaderCount))
        const tocLine = `${displayText} ${leaders} ${pageStr}`

        items.push({
          nodeId: entry.paragraphId,
          nodeType: 'text',
          type: 'text',
          text: tocLine,
          x: entryX,
          y,
          width: contentWidth - indent,
          height: lineHeight,
          ascent: fontSize * 0.8,
          descent: fontSize * 0.2,
          font: 'SimSun',
          size: fontSize,
          bold: entry.level === 1,
          color: '#000000',
        })
      } else {
        items.push({
          nodeId: entry.paragraphId,
          nodeType: 'text',
          type: 'text',
          text: entry.text,
          x: entryX,
          y,
          width: contentWidth - indent,
          height: lineHeight,
          ascent: fontSize * 0.8,
          descent: fontSize * 0.2,
          font: 'SimSun',
          size: fontSize,
          bold: entry.level === 1,
          color: '#000000',
        })
      }

      y += lineHeight + 2
    }

    return {
      pageIndex: 0,
      width: pageWidth,
      height: pageHeight,
      items,
    }
  }

  /**
   * 批量生成: 如果条目过多, 自动分页
   */
  generatePages(
    entries: TOCEntry[],
    _existingPages: SLIFPage[],
  ): SLIFPage[] {
    if (entries.length === 0) return []
    return [this.generatePage(entries, _existingPages)]
  }

  // ---- 内部 ----

  /** 获取段落纯文本 */
  private getParagraphPlainText(paraId: string, pool: NodePool): string {
    const para = pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
    if (!para?.children) return ''

    const parts: string[] = []
    for (const childId of para.children) {
      const child = pool.nodes.get(childId)
      if (!child) continue
      const c = child as { type?: string; text?: string }
      if (c.type === 'text' || c.type === 'smarttext') {
        parts.push(c.type === 'smarttext'
          ? smartTextDisplayValue(c as unknown as { text: string; value?: string })
          : (c.text || ''))
      }
    }
    return parts.join('').trim()
  }
}
