// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 分节符 breakType 分页语义 (契约 §31.10 PHASE 1)
//
// 此前 PageBreaker 对所有 section_break 一律断页, breakType 完全不被读取:
// continuous 也断页, even/odd 与 next_page 没有区别。本文件锁:
//   ① next_page 断页; ② continuous 不断页;
//   ③ even_page/odd_page 在奇偶不符时插入**真实空白页** (含页眉页脚带);
//   ④ 空白页进入 SLIF 页数组, 内容落在目标奇偶页。
// ================================================================

import { describe, it, expect } from 'vitest'
import { PageBreaker } from '../layout/page/PageBreaker'
import type { ILine } from '../layout/page/PageLayout'
import { DEFAULT_PAGE_SETUP } from '../document/core/DocumentModel'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { testMeasurer } from './helpers'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode, createSectionBreak,
} from '../document/factory/ElementFormatter'
import type { BaseNode, Paragraph, SectionBreak } from '../document/core/DocumentModel'
import type { SLIFPage } from '../layout/core/SLIF'

const SENTENCE = '患者三日前出现发热，伴畏寒乏力，无咳嗽咳痰，无腹痛腹泻，饮食睡眠尚可。'

function textLine(id: string, height: number): ILine {
  return {
    elements: [{ id, type: 'text', value: 'x' }],
    width: 10, height,
    maxAscent: height * 0.8, maxDescent: height * 0.2,
  }
}

function sectionLine(
  id: string, type: 'next_page' | 'continuous' | 'even_page' | 'odd_page' | undefined,
): ILine {
  return {
    elements: [{ id, type: 'section_break' }],
    width: 0, height: 0, maxAscent: 0, maxDescent: 0,
    sectionBreakType: type,
  }
}

function breakPages(lines: ILine[], headerLines: ILine[] = []) {
  return new PageBreaker().breakPages(
    lines, headerLines, [], DEFAULT_PAGE_SETUP, 0, 100,
  )
}

describe('PageBreaker: 分节符 breakType (契约 §31.10)', () => {
  it('next_page 断页', () => {
    const pages = breakPages([
      textLine('a', 50), sectionLine('sb', 'next_page'), textLine('b', 50),
    ])
    expect(pages.map(p => p.lines.map(l => l.elements[0].id))).toEqual([['a'], ['b']])
  })

  it('continuous 不断页, 内容留在当前页', () => {
    const pages = breakPages([
      textLine('a', 50), sectionLine('sb', 'continuous'), textLine('b', 50),
    ])
    expect(pages).toHaveLength(1)
    expect(pages[0].lines.map(l => l.elements[0].id)).toEqual(['a', 'b'])
  })

  it('未携带 breakType 的历史标记行按 next_page 处理', () => {
    const pages = breakPages([
      textLine('a', 50), sectionLine('sb', undefined), textLine('b', 50),
    ])
    expect(pages).toHaveLength(2)
  })

  it('even_page: 后续页已是偶数页 → 不插空白页', () => {
    // 当前页 page1 (index0); 断页后下一张是 page2 (偶数) → 直接放内容
    const pages = breakPages([
      textLine('a', 50), sectionLine('sb', 'even_page'), textLine('b', 50),
    ])
    expect(pages).toHaveLength(2)
    expect(pages[1].lines.map(l => l.elements[0].id)).toEqual(['b'])
  })

  it('even_page: 后续页是奇数页 → 插一张空白页, 内容落到偶数页', () => {
    // a、b 各占满一页 (page1、page2); 断页后下一张是 page3 (奇数) → 补空白页
    const pages = breakPages([
      textLine('a', 100), textLine('b', 100),
      sectionLine('sb', 'even_page'), textLine('c', 50),
    ])
    expect(pages.map(p => p.lines.map(l => l.elements[0].id))).toEqual([
      ['a'], ['b'], [], ['c'],
    ])
    // 空白页是真实页, 带页眉带
    expect(pages[2].headerLines).toBe(pages[0].headerLines)
  })

  it('odd_page: 后续页是偶数页 → 插空白页, 内容落到奇数页', () => {
    const pages = breakPages([
      textLine('a', 50), sectionLine('sb', 'odd_page'), textLine('b', 50),
    ])
    expect(pages.map(p => p.lines.map(l => l.elements[0].id))).toEqual([
      ['a'], [], ['b'],
    ])
  })

  it('连续两个 even_page: 奇偶按绝对物理页号累计, 不按节内计数', () => {
    // page1 有 a; 第一个 even 断页 → page2 放 b; 第二个 even 断页 → page3 奇,
    // 补空白 page3, c 落 page4 (偶数)
    const pages = breakPages([
      textLine('a', 50), sectionLine('sb1', 'even_page'), textLine('b', 50),
      sectionLine('sb2', 'even_page'), textLine('c', 50),
    ])
    expect(pages.map(p => p.lines.map(l => l.elements[0].id))).toEqual([
      ['a'], ['b'], [], ['c'],
    ])
  })
})

// ================================================================
// 布局接线: 分节符类型必须从节点进入 PageBreaker, 空白页必须进入 SLIF
// ================================================================

function makeDoc(breakType: SectionBreak['breakType'], sentences = 160) {
  const doc = createDocument('分节符')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)

  // 长段落占多页; 句数可调, 供奇偶用例挑选 P 的奇偶
  const t1 = createTextNode(Array.from({ length: sentences }, () => SENTENCE).join(''))
  const p1 = createParagraph([t1.id]) as Paragraph
  const sb = createSectionBreak(breakType)
  const t2 = createTextNode('分节符之后')
  const p2 = createParagraph([t2.id]) as Paragraph
  for (const n of [t1, p1, sb, t2, p2]) all.set(n.id, n as unknown as BaseNode)
  doc.body.children = [p1.id, sb.id, p2.id]

  return { doc, pool: buildNodePool(all, { body: doc.id }), tailTextId: t2.id }
}

function pageOfText(pages: SLIFPage[], textId: string): number {
  return pages.findIndex(p => p.items.some(i => i.nodeId === textId))
}

describe('LayoutEngine: 分节符 breakType 接线 (契约 §31.10)', () => {
  function layout(breakType: SectionBreak['breakType'], sentences = 160) {
    const { doc, pool, tailTextId } = makeDoc(breakType, sentences)
    const pages = new LayoutEngine(new EventBus(), testMeasurer).fullLayout(doc, pool)
    return { pages, tailTextId }
  }

  /**
   * 选一个句数, 使长段落占 P 页且 P 的奇偶 = wantParity (0-based 尾段页下标)。
   * 这样奇偶不符的补页分支一定被触发, 用例才有牙。
   */
  function layoutWithContentParity(breakType: SectionBreak['breakType'], wantParity: 0 | 1) {
    for (const sentences of [100, 110, 120, 130, 140, 150, 160]) {
      const next = layout('next_page', sentences)
      const P = next.pages.length - 1
      if (P % 2 === wantParity) return { ...layout(breakType, sentences), P }
    }
    throw new Error('找不到满足奇偶的夹具长度')
  }

  it('continuous: 后续段落接在长段落最后一页, 不额外分页', () => {
    const next = layout('next_page')
    const cont = layout('continuous')
    // next_page 下长段落占 P 页、尾段在 index P; continuous 应少一页且尾段在最后一页
    const P = next.pages.length - 1
    expect(P).toBeGreaterThanOrEqual(2)
    expect(cont.pages).toHaveLength(P)
    expect(pageOfText(cont.pages, cont.tailTextId)).toBe(P - 1)
  })

  it('even_page: 尾段落在偶数页; 奇偶不符时先补一张无正文 item 的空白页', () => {
    // P 为偶数 → next_page 下尾段在奇数页, 必须补一张空白页再落到偶数页
    const { pages, tailTextId, P } = layoutWithContentParity('even_page', 0)
    expect(P % 2).toBe(0)
    expect(pageOfText(pages, tailTextId)).toBe(P + 1)
    expect(pages[P].items).toHaveLength(0)
  })

  it('odd_page: 尾段落在奇数页; 奇偶不符时先补一张空白页', () => {
    // P 为奇数 → next_page 下尾段在偶数页, 必须补一张空白页再落到奇数页
    const { pages, tailTextId, P } = layoutWithContentParity('odd_page', 1)
    expect(P % 2).toBe(1)
    expect(pageOfText(pages, tailTextId)).toBe(P + 1)
    expect(pages[P].items).toHaveLength(0)
  })

  it('next_page: 尾段直接落在长段落之后的下一页', () => {
    const { pages, tailTextId } = layout('next_page')
    expect(pageOfText(pages, tailTextId)).toBe(pages.length - 1)
  })
})
