// ============================================================
// Bug 2 回归 — 局部选区格式化后选区偏移
//
// 根因: LayoutEngine 曾对同一行内所有元素赋予相同的 x (行起始),
// 导致 FormatTextRangeCommand 拆分文本节点后, 多个 SLIF item 共用
// 同一 x, 选区高亮/光标/命中检测整体左移错位。
//
// 验证: 拆分后 layout 产出的相邻文本 item x 严格递增且逐元素累积,
// 且正文与页眉页脚两条布局链路都满足该不变量。
// ============================================================

import { describe, it, expect } from 'vitest'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { testMeasurer } from './helpers'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import { buildNodePool } from '../document/core/NodePool'
import type { BaseNode } from '../document/core/DocumentModel'
import { FormatTextRangeCommand } from '../command/commands/FormatTextCommand'

function makeDoc(text: string) {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const tn = createTextNode(text)
  const para = createParagraph([tn.id])
  allNodes.set(tn.id, tn as unknown as BaseNode)
  allNodes.set(para.id, para as unknown as BaseNode)
  doc.body.children = [para.id]
  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool, paraId: para.id }
}

/** 将 "Hello" 在 [1,4) 局部加粗 → 拆成 "H"/"ell"/"o", 再全量排版, 返回正文 text items */
function layoutAfterPartialFormat() {
  const { doc, pool, paraId } = makeDoc('Hello')
  new FormatTextRangeCommand(
    'f', Date.now(), 'test', [{ path: [doc.id, paraId], start: 1, end: 4 }], { bold: true }, 'merge',
  ).forward({ mode: 'local', doc, pool })
  const engine = new LayoutEngine(new EventBus(), testMeasurer)
  const pages = engine.fullLayout(doc, pool)
  return pages.flatMap(p => p.items).filter(i => i.type === 'text')
}

describe('Bug2 选区偏移 — SLIF 逐元素 x 累积', () => {
  it('拆分 "Hello"→"H"/"ell"/"o" 后, 正文相邻 text item x 严格递增且按宽度累积', () => {
    const items = layoutAfterPartialFormat()
    expect(items.map(i => i.text)).toEqual(['H', 'ell', 'o'])

    // 默认 marginLeft = 90, 首项 x 应为行起始
    expect(items[0].x).toBeCloseTo(90, 1)

    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1]
      expect(items[i].x).toBeCloseTo(prev.x + prev.width, 1)
    }

    // 关键回归点: 不能都等于行起始 (旧 bug)
    expect(items[1].x).toBeGreaterThan(items[0].x)
    expect(items[2].x).toBeGreaterThan(items[1].x)
  })

  it('页眉段内局部格式化后, headerItems 同样逐元素累积 x', () => {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const tn = createTextNode('Header')
    const hpara = createParagraph([tn.id])
    allNodes.set(tn.id, tn as unknown as BaseNode)
    allNodes.set(hpara.id, hpara as unknown as BaseNode)
    doc.header = [hpara.id]
    doc.body.children = []
    const pool = buildNodePool(allNodes, { body: doc.id })

    new FormatTextRangeCommand(
      'f', Date.now(), 'test', [{ path: [doc.id, hpara.id], start: 2, end: 4 }], { bold: true }, 'merge',
    ).forward({ mode: 'local', doc, pool })

    const engine = new LayoutEngine(new EventBus(), testMeasurer)
    const pages = engine.fullLayout(doc, pool)
    const headerTexts = pages.flatMap(p => p.headerItems ?? []).filter(i => i.type === 'text')

    expect(headerTexts.map(i => i.text)).toEqual(['He', 'ad', 'er'])
    expect(headerTexts[1].x).toBeGreaterThan(headerTexts[0].x)
    expect(headerTexts[2].x).toBeGreaterThan(headerTexts[1].x)
  })
})
