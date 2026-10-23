// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 常量交叉引用的增量布局 (契约 §16.1)
//
// 交叉引用此前一律被排除在增量安全集之外, 理由是显示文本依赖上一轮页映射。
// 但那只对**带 {page}/{number} 占位符**的交叉引用成立: 不带占位符时
// resolveCrossRefDisplay 原样返回 displayText, 是常量, 节点版本已覆盖其改动。
// 本文件锁住: 常量交叉引用 (正文与表格 cell) 可增量, 占位符版仍回落全量。
// ================================================================

import { describe, it, expect } from 'vitest'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { testMeasurer } from './helpers'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode,
  createTable, createTableRow, createTableCell,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree, Paragraph } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'

const SENTENCE = '患者三日前出现发热，伴畏寒乏力，无咳嗽咳痰，无腹痛腹泻，饮食睡眠尚可。'

function newEngine(): LayoutEngine {
  return new LayoutEngine(new EventBus(), testMeasurer)
}

function canonical(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(obj).sort()) out[key] = walk(obj[key])
      return out
    }
    return v
  }
  return JSON.stringify(walk(value))
}

/**
 * body = [表格(可选; 1×1, cell 内为常量交叉引用)] + n 个填充段落。
 * 交叉引用放在文档最前面 (若放表格里, 首段即表格)。
 */
function makeDoc(opts: { xrefText: string; fillers: number; inCell: boolean }) {
  const doc = createDocument('常量交叉引用')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)

  const xref = {
    type: 'cross_reference', id: 'xref-1', refType: 'bookmark',
    targetRef: 'bm-1', displayText: opts.xrefText,
  } as unknown as BaseNode
  all.set(xref.id, xref)
  const headPara = createParagraph([xref.id]) as Paragraph
  all.set(headPara.id, headPara as unknown as BaseNode)

  let headId = headPara.id
  if (opts.inCell) {
    const cell = createTableCell([headPara.id])
    const row = createTableRow([cell])
    const table = createTable([{ width: 100, mode: 'percentage' }], [row])
    for (const n of [table, row, cell]) all.set(n.id, n as unknown as BaseNode)
    headId = table.id
  }
  doc.body.children = [headId]

  const textIds: string[] = []
  for (let i = 0; i < opts.fillers; i++) {
    const t = createTextNode(`第${i + 1}段：${SENTENCE}${SENTENCE}`)
    const p = createParagraph([t.id]) as Paragraph
    all.set(t.id, t as unknown as BaseNode)
    all.set(p.id, p as unknown as BaseNode)
    doc.body.children.push(p.id)
    textIds.push(t.id)
  }
  // 书签挂在最后一个段落的文本上 (常量显示文本不需要它, 但保持文档语义完整)
  all.set('bm-1', {
    type: 'bookmark', id: 'bm-1', name: '目标', targetId: textIds[textIds.length - 1],
  } as unknown as BaseNode)

  return {
    doc, pool: buildNodePool(all, { body: doc.id }), textIds,
    xrefId: xref.id, tableId: opts.inCell ? headId : undefined,
  }
}

function editLastText(doc: DocumentTree, pool: NodePool): void {
  const lastBlockId = doc.body.children[doc.body.children.length - 1]
  const para = pool.nodes.get(lastBlockId) as unknown as { children: string[] }
  pool.updateNode(para.children[0], { text: `${SENTENCE}（已修改）` } as Partial<BaseNode>)
}

describe('常量交叉引用的增量布局 (契约 §16.1)', () => {
  it('正文常量交叉引用可缓存: 无改动重排整份复用', () => {
    const { doc, pool } = makeDoc({ xrefText: '见第一章', fillers: 40, inCell: false })
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    engine.fullLayout(doc, pool, 'paragraph')
    expect(engine.getPaginationStats().mode).toBe('reuse-all')
  })

  it('正文常量交叉引用: 编辑末段 → 续排且与全量逐字节一致', () => {
    const { doc, pool } = makeDoc({ xrefText: '见第一章', fillers: 40, inCell: false })
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    editLastText(doc, pool)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    expect(engine.getPaginationStats().mode).toBe('resume')
    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('cell 内常量交叉引用: 表格子树仍可增量', () => {
    const { doc, pool } = makeDoc({ xrefText: '见第一章', fillers: 40, inCell: true })
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    editLastText(doc, pool)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    expect(engine.getPaginationStats().mode).toBe('resume')
    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('带 {page} 的交叉引用仍回落全量 (自指输入)', () => {
    const { doc, pool } = makeDoc({ xrefText: '见第{page}页', fillers: 40, inCell: false })
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    editLastText(doc, pool)
    engine.fullLayout(doc, pool, 'paragraph')

    expect(engine.getPaginationStats().mode).toBe('full')
  })

  it('cell 内带 {page} 的交叉引用同样回落全量', () => {
    const { doc, pool } = makeDoc({ xrefText: '见第{page}页', fillers: 40, inCell: true })
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    editLastText(doc, pool)
    engine.fullLayout(doc, pool, 'paragraph')

    expect(engine.getPaginationStats().mode).toBe('full')
  })
})
