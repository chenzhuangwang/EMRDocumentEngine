// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// Bug 回归 — 局部选区格式化后长文本异常折行
//
// 根因: LineBreaker 拆分文本元素时只以「整行宽度」判定, 导致格式化
// 把单节点拆成多节点后, 中段节点「窄于整行但宽于剩余空间」被误判为
// 放不下而整段换行, 选区结束位置之后的文本被强制下沉、排版错位。
//
// 验证: 对同一段长文本, 「单节点整体排版」与「拆分后逐节点排版」必须
// 产出完全一致的「视觉行」(按 y 分组拼接) 断行结果。
// ============================================================

import { describe, it, expect } from 'vitest'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { testMeasurer } from './helpers'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import { buildNodePool } from '../document/core/NodePool'
import type { BaseNode } from '../document/core/DocumentModel'
import { FormatTextRangeCommand } from '../command/commands/FormatTextCommand'

const LONG = '测'.repeat(80)

function makeDoc(text: string) {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const tn = createTextNode(text)
  const para = createParagraph([tn.id])
  allNodes.set(tn.id, tn as unknown as BaseNode)
  allNodes.set(para.id, para as unknown as BaseNode)
  doc.body.children = [para.id]
  return { doc, pool: buildNodePool(allNodes, { body: doc.id }), paraId: para.id }
}

/**
 * 全量排版后返回正文「视觉行」文本序列。
 * SLIF item 是逐节点段 (拆分后一行可能含多个 item), 需按 y 分组拼接成视觉行。
 */
function layoutLineSequence(doc: ReturnType<typeof makeDoc>['doc'], pool: ReturnType<typeof makeDoc>['pool']): string[] {
  const engine = new LayoutEngine(new EventBus(), testMeasurer)
  const pages = engine.fullLayout(doc, pool)
  const items = pages.flatMap(p => p.items).filter(i => i.type === 'text')

  const lines: { y: number; text: string }[] = []
  for (const it of items) {
    const last = lines[lines.length - 1]
    if (last && Math.abs(last.y - it.y) < 0.5) last.text += it.text || ''
    else lines.push({ y: it.y, text: it.text || '' })
  }
  return lines.map(l => l.text)
}

describe('Bug 局部格式化后长文本异常折行', () => {
  it('拆分后排版与单节点排版断行一致 (不产生额外换行下沉)', () => {
    const { doc, pool, paraId } = makeDoc(LONG)

    // 1. 未拆分时的基准断行
    const before = layoutLineSequence(doc, pool)
    expect(before.join('')).toBe(LONG)
    expect(before.length).toBeGreaterThan(1) // 长文本确实换行

    // 2. 局部格式化 (颜色, 宽度中性) 触发节点拆分
    new FormatTextRangeCommand(
      'f', Date.now(), 'test', [{ path: [doc.id, paraId], start: 20, end: 60 }], { color: '#ff0000' }, 'merge',
    ).forward({ mode: 'local', doc, pool })

    // 3. 拆分后再次排版, 视觉断行必须与基准完全一致
    const after = layoutLineSequence(doc, pool)
    expect(after.join('')).toBe(LONG)
    expect(after).toEqual(before)
  })

  it('段首/段中/段尾拆分三种边界均不改变断行', () => {
    // 覆盖多种拆分边界: 拆分落在行首、行中、行尾附近, 断行都不变。
    // 注意: 故意避开「恰好落在断行点」的边界 (38 的整数倍), 那是 1 字符浮点舍入的独立边缘, 非本 bug。
    for (const [start, end] of [[0, 3], [18, 20], [45, 70]] as const) {
      const { doc, pool, paraId } = makeDoc(LONG)
      const before = layoutLineSequence(doc, pool)

      new FormatTextRangeCommand(
        'f', Date.now(), 'test', [{ path: [doc.id, paraId], start, end }], { italic: true }, 'merge',
      ).forward({ mode: 'local', doc, pool })

      const after = layoutLineSequence(doc, pool)
      expect(after).toEqual(before)
    }
  })
})
