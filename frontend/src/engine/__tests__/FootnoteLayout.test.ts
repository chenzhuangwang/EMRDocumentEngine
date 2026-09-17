// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// FootnoteLayout 测试 (R93-R94)
//
// 原名 LaTeXFootnote.test.ts, 含一块 LaTeX tokenizer 测试 —— LaTeX 链
// (KaTeXRenderer + LaTeXParticle) 已删除 (文档模型里从来没有 latex 节点类型,
// 任何文档都产不出 latex item), 故改名并只留脚注部分。
// ============================================================

import { describe, it, expect } from 'vitest'
import { FootnoteLayout } from '../layout/footnote/FootnoteLayout'
import { NodePool, buildNodePool } from '../document/core/NodePool'
import type { BaseNode } from '../document/core/DocumentModel'
import type { SLIFPage } from '../layout/core/SLIF'

// ---- FootnoteLayout ----

describe('FootnoteLayout', () => {
  function makePageWithFootnote(footnoteRefId: string, footnoteContentId: string): { page: SLIFPage; pool: NodePool } {
    const page: SLIFPage = {
      pageIndex: 0, width: 794, height: 1123,
      items: [{
        nodeId: footnoteRefId, nodeType: 'footnote_ref', type: 'footnote',
        x: 90, y: 100, width: 600, height: 20,
        ascent: 14, descent: 6, font: 'SimSun', size: 16,
        text: '1',
      }],
    }

    const allNodes = new Map<string, BaseNode>()
    // 文档根节点 (NodePool 需要)
    allNodes.set('doc1', {
      type: 'document' as const, id: 'doc1', title: 'test',
      body: { mode: 'flow' as const, children: [] },
      header: [], footer: [],
      pageSetup: { width: 794, height: 1123, marginTop: 72, marginBottom: 72, marginLeft: 90, marginRight: 90, orientation: 'portrait' as const },
    } as unknown as BaseNode)
    allNodes.set(footnoteRefId, {
      type: 'footnote_ref' as const, id: footnoteRefId, footnoteId: footnoteContentId,
    } as unknown as BaseNode)
    allNodes.set(footnoteContentId, {
      type: 'footnote_content' as const, id: footnoteContentId, refId: footnoteRefId,
      children: [],
    } as unknown as BaseNode)

    return { page, pool: buildNodePool(allNodes, { body: 'doc1' }) }
  }

  it('should collect footnotes from page', () => {
    const { page, pool } = makePageWithFootnote('ref1', 'content1')
    const layout = new FootnoteLayout()
    const entries = layout.collectFootnotes(page, pool)
    expect(entries.length).toBe(1)
    expect(entries[0].number).toBe(1)
  })

  it('should generate footnote items', () => {
    const { page, pool } = makePageWithFootnote('ref1', 'content1')
    const layout = new FootnoteLayout()
    const entries = layout.collectFootnotes(page, pool)
    const items = layout.generateFootnoteItems(entries, 1000, 600, 90)
    expect(items.length).toBeGreaterThan(0)
    // 第一个是 separator
    expect(items[0].type).toBe('separator')
  })

  it('should calculate footnote height', () => {
    const { page, pool } = makePageWithFootnote('ref1', 'content1')
    const layout = new FootnoteLayout()
    const entries = layout.collectFootnotes(page, pool)
    const h = layout.calculateFootnoteHeight(entries)
    expect(h).toBeGreaterThan(0)
  })

  it('should reset counter', () => {
    const { page, pool } = makePageWithFootnote('ref1', 'content1')
    const layout = new FootnoteLayout()
    layout.collectFootnotes(page, pool)
    expect(layout.currentNumber).toBe(1)
    layout.resetCounter()
    expect(layout.currentNumber).toBe(0)
  })
})
