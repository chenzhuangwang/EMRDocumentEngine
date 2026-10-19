// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 命中索引增量重建 (M2b 收尾)
//
// 分页续排时, 前序页的 SLIF 逐字节未变 —— 命中索引没有理由全量重建。
// 两条判据:
//   1. rebuildFrom 保留前序桶、只换受影响页 (单元)
//   2. Draw.recomputeLayout 真的按分页模式选择重建起点 (接线)
// ================================================================

import { describe, it, expect } from 'vitest'
import { HitTestIndex } from '../render/HitTestIndex'
import { Draw } from '../render/Draw'
import { EventBus } from '../interaction/EventBus'
import { testHost, testMeasurer } from './helpers'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode,
} from '../document/factory/ElementFormatter'
import type { BaseNode, Paragraph } from '../document/core/DocumentModel'
import type { SLIFItem, SLIFPage } from '../layout/core/SLIF'

function item(nodeId: string, y: number): SLIFItem {
  return {
    nodeId, nodeType: 'text', type: 'text', text: 'x',
    x: 100, y, width: 200, height: 16,
    ascent: 12, descent: 4, font: 'SimSun', size: 16,
  } as SLIFItem
}

function page(pageIndex: number, items: SLIFItem[]): SLIFPage {
  return { pageIndex, width: 794, height: 1123, items }
}

describe('HitTestIndex.rebuildFrom', () => {
  it('保留前序页的桶, 只重建指定页及其后', () => {
    const index = new HitTestIndex(testMeasurer)
    const pages = [page(0, [item('p0', 100)]), page(1, [item('p1', 100)]), page(2, [item('old', 100)])]
    index.rebuild(pages)

    // 第 2 页换了内容
    pages[2] = page(2, [item('new', 100)])
    index.rebuildFrom(pages, 2)

    expect(index.hitTest(150, 105, 0)).toBe('p0')
    expect(index.hitTest(150, 105, 1)).toBe('p1')
    expect(index.hitTest(150, 105, 2)).toBe('new')
  })

  it('页数减少时清掉越界的旧桶', () => {
    const index = new HitTestIndex(testMeasurer)
    index.rebuild([page(0, [item('p0', 100)]), page(1, [item('p1', 100)])])
    expect(index.hitTest(150, 105, 1)).toBe('p1')

    index.rebuildFrom([page(0, [item('p0', 100)])], 1)
    expect(index.hitTest(150, 105, 1)).toBeNull()
  })

  it('startPage 超过总页数等价于清空后续', () => {
    const index = new HitTestIndex(testMeasurer)
    index.rebuild([page(0, [item('p0', 100)])])
    index.rebuildFrom([page(0, [item('p0', 100)])], 5)
    expect(index.hitTest(150, 105, 0)).toBe('p0')
  })
})

const SENTENCE = '患者三日前出现发热，伴畏寒乏力，无咳嗽咳痰，无腹痛腹泻，饮食睡眠尚可。'

function makeLongDoc(paragraphCount = 120) {
  const doc = createDocument('hit')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)
  const texts: string[] = []

  for (let i = 0; i < paragraphCount; i++) {
    const t = createTextNode(`第${i + 1}段：${SENTENCE}`)
    const p = createParagraph([t.id]) as Paragraph
    all.set(t.id, t as unknown as BaseNode)
    all.set(p.id, p as unknown as BaseNode)
    doc.body.children.push(p.id)
    texts.push(t.id)
  }

  return { doc, pool: buildNodePool(all, { body: doc.id }), texts }
}

describe('Draw 命中索引按分页模式重建', () => {
  it('续排时只从复用页之后重建; 无变化时整份跳过', () => {
    const { doc, pool, texts } = makeLongDoc()
    // Draw 构造经 host.surface 建 canvas — 必须先挂载容器
    const container = document.createElement('div')
    container.style.width = '800px'
    container.style.height = '600px'
    document.body.appendChild(container)
    testHost.surface.mount(container)

    const draw = new Draw(testHost, new EventBus(), testMeasurer, doc)
    draw.setDocument(doc, pool)

    draw.recomputeLayout(pool, 'paragraph')
    expect(draw.getHitIndexStats().rebuildStartPage).toBe(0)
    const total = draw.getHitIndexStats().totalPages
    expect(total).toBeGreaterThan(1)

    // 内容不变 → 整份复用, 索引不重建 (起点 = 总页数)
    draw.recomputeLayout(pool, 'paragraph')
    expect(draw.getHitIndexStats().rebuildStartPage).toBe(total)

    // 中段编辑 → 续排, 从复用页之后重建
    pool.updateNode(texts[100], { text: `第101段：${SENTENCE}（改）` } as Partial<BaseNode>)
    draw.recomputeLayout(pool, 'paragraph')
    const stats = draw.getHitIndexStats()
    expect(stats.rebuildStartPage).toBeGreaterThan(0)
    expect(stats.rebuildStartPage).toBeLessThan(total)

    // 前序页仍可命中 (桶没被清掉)
    expect(draw.hitTest(100, 100, 0)).toBeTruthy()
  })
})
