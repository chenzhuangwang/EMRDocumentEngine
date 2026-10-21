// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// FootnoteLayout — 脚注布局引擎 (TASK-460, v5.0)
//
// 职责:
//   - 收集页面上所有 FootnoteRef → 分配连续编号
//   - 为每页底部预留脚注区域
//   - 生成脚注区 SLIF items (分隔线 + 编号文本 + 脚注内容)
// ================================================================

import type { SLIFPage, SLIFItem } from '../core/SLIF'
import { forEachPageItem } from '../core/SLIF'
import type { NodePool } from '../../document/core/NodePool'

// ---- 脚注条目 ----

export interface FootnoteEntry {
  /** FootnoteRef 节点 ID */
  refId: string
  /** 脚注编号 (从 1 开始, 跨页连续) */
  number: number
  /** FootnoteContent 节点 ID */
  contentId: string
  /** 脚注纯文本 */
  text: string
}

// ---- 脚注布局配置 ----

export interface FootnoteConfig {
  /** 脚注区最大高度 (占页面高度的比例, 默认 0.3) */
  maxHeightRatio?: number
  /** 分隔线宽度 (默认: 内容宽度的 1/3) */
  separatorWidth?: number
  /** 脚注字号 */
  fontSize?: number
  /** 脚注行高 */
  lineHeight?: number
}

const DEFAULT_CONFIG: Required<FootnoteConfig> = {
  maxHeightRatio: 0.3,
  separatorWidth: 0.33,
  fontSize: 12,
  lineHeight: 18,
}

// ---- FootnoteLayout ----

export class FootnoteLayout {
  private config: Required<FootnoteConfig>
  /** 全局脚注编号计数器 */
  private globalCounter = 0

  constructor(config: FootnoteConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 续排播种 (契约 §16.1): 把编号接在**复用页**之后。
   *
   * 复用页的脚注区已经生成好, Step 4 不会再处理它们; 但编号是跨页连续的,
   * 所以必须先把复用页里"会真正产出入条"的引用数一遍 —— 判据与
   * `collectFootnotes` 完全一致 (节点存在、有 footnoteId、内容节点存在),
   * 否则新页的编号会从 1 重新开始。
   */
  seedFrom(pages: readonly SLIFPage[], pool: NodePool): void {
    for (const page of pages) {
      // cell 内引用同样参与编号 (契约 §31.13.1) — 故必须展平, 不能只看顶层
      forEachPageItem(page, item => {
        if (item.nodeType !== 'footnote_ref') return
        const ref = pool.nodes.get(item.nodeId) as { footnoteId?: string } | undefined
        if (!ref?.footnoteId) return
        if (!pool.nodes.get(ref.footnoteId)) return
        this.globalCounter++
      })
    }
  }

  /**
   * 为给定页面收集脚注引用并分配编号
   */
  collectFootnotes(page: SLIFPage, pool: NodePool): FootnoteEntry[] {
    const entries: FootnoteEntry[] = []

    // cell 内引用与正文引用同权 (契约 §31.13.1); 顺序 = getFlatPageItems 顺序
    forEachPageItem(page, item => {
      if (item.nodeType !== 'footnote_ref') return
      const ref = pool.nodes.get(item.nodeId) as { footnoteId?: string } | undefined
      if (!ref?.footnoteId) return

      // 查找 FootnoteContent
      const content = pool.nodes.get(ref.footnoteId)
      if (!content) return

      this.globalCounter++
      const text = this.getFootnoteText(content, pool)

      entries.push({
        refId: item.nodeId,
        number: this.globalCounter,
        contentId: ref.footnoteId,
        text,
      })
    })

    return entries
  }

  /**
   * 生成脚注区域的 SLIF items
   *
   * @param entries 当前页的脚注条目 (已分配编号)
   * @param contentY 脚注区起始 Y 坐标 (页面底部)
   * @param contentWidth 内容区宽度
   * @param marginLeft 左边距
   * @returns SLIFItem[] 脚注渲染项
   */
  generateFootnoteItems(
    entries: FootnoteEntry[],
    contentY: number,
    contentWidth: number,
    marginLeft: number,
  ): SLIFItem[] {
    if (entries.length === 0) return []

    const { separatorWidth, fontSize, lineHeight } = this.config
    const items: SLIFItem[] = []
    let y = contentY

    // 分隔线
    const sepWidth = contentWidth * separatorWidth
    items.push({
      nodeId: 'footnote-separator',
      nodeType: 'separator',
      type: 'separator',
      text: '',
      x: marginLeft,
      y,
      width: sepWidth,
      height: 2,
      ascent: 1,
      descent: 1,
      font: 'SimSun',
      size: 1,
    })
    y += 8 // 分隔线与脚注内容间距

    // 脚注条目
    const numWidth = 20 // 编号区域宽度
    for (const entry of entries) {
      // 脚注编号 (上标样式)
      items.push({
        nodeId: `fn-num-${entry.refId}`,
        nodeType: 'text',
        type: 'text',
        text: `${entry.number}.`,
        x: marginLeft,
        y,
        width: numWidth,
        height: lineHeight,
        ascent: fontSize * 0.8,
        descent: fontSize * 0.2,
        font: 'SimSun',
        size: fontSize,
        superscript: true,
        color: '#000000',
      })

      // 脚注文本
      items.push({
        nodeId: entry.contentId,
        nodeType: 'text',
        type: 'text',
        text: entry.text,
        x: marginLeft + numWidth,
        y,
        width: contentWidth - numWidth,
        height: lineHeight,
        ascent: fontSize * 0.8,
        descent: fontSize * 0.2,
        font: 'SimSun',
        size: fontSize,
        color: '#333333',
      })

      y += lineHeight + 2
    }

    return items
  }

  /**
   * 计算脚注区所需高度
   */
  calculateFootnoteHeight(entries: FootnoteEntry[]): number {
    if (entries.length === 0) return 0
    // 分隔线 + 间距 + 每个脚注行
    return 8 + entries.length * (this.config.lineHeight + 2)
  }

  /** 重置全局编号 (新文档加载时) */
  resetCounter(): void {
    this.globalCounter = 0
  }

  /** 获取当前编号 */
  get currentNumber(): number {
    return this.globalCounter
  }

  // ---- 内部 ----

  /** 获取脚注内容的纯文本 */
  private getFootnoteText(content: { children?: readonly string[]; type?: string }, pool: NodePool): string {
    if (!content.children) return ''

    const parts: string[] = []
    for (const childId of content.children) {
      const child = pool.nodes.get(childId)
      if (!child) continue
      const c = child as { type?: string; children?: readonly string[] }

      if (c.type === 'paragraph' && c.children) {
        for (const paraChildId of c.children) {
          const pc = pool.nodes.get(paraChildId) as { type?: string; text?: string } | undefined
          if (pc?.type === 'text' || pc?.type === 'smarttext') {
            parts.push(pc.text || '')
          }
        }
      }
    }

    return parts.join(' ').trim().slice(0, 500) // 截断显示
  }
}
