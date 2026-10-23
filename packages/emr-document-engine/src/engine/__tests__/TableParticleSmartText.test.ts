// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// TableParticle 表格 cell 内 smarttext 渲染 (契约 §4)
//
// 验证表格 cell 内嵌 smarttext 委托 ControlParticle (而非直接 fillText),
// 与正文一致地渲染控制盒 + 表现层/设计期样式:
//   - cell 内 smarttext → 画盒 (背景 fillRect + 边框 strokeRect)
//   - borderStyle 'none' → 不画盒 (仅 cell 边框)
//   - cell 内普通 text → 不画盒 (仅 cell 边框)
//   - cell 内 smarttext + label → 绘制附属字面量
// ================================================================

import { describe, it, expect, beforeAll } from 'vitest'
import { createTableParticle } from '../render/particles/TableParticle'
import { createControlParticle } from '../render/particles/ControlParticle'
import { particleRegistry } from '../render/particles/ParticleRegistry'
import type { SLIFItem } from '../layout/core/SLIF'
import type { PresentationStyle } from '../render/presentation/PresentationStyle'
import type { TemplateDefinition } from '../template/TemplateDefinition'

beforeAll(() => {
  if (!particleRegistry.has('smarttext')) {
    particleRegistry.register(createControlParticle())
  }
})

interface RectCall { x: number; y: number; w: number; h: number }
interface TextCall { text: string; x: number; y: number }

function makeRecordingCtx() {
  const state = { font: '' }
  const fillRects: RectCall[] = []
  const strokeRects: RectCall[] = []
  const texts: TextCall[] = []
  const ctx = {
    get font() { return state.font },
    set font(v: string) { state.font = v },
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    measureText(text: string) {
      return { width: text.length * 12 * 0.55 } as TextMetrics
    },
    fillRect(x: number, y: number, w: number, h: number) { fillRects.push({ x, y, w, h }) },
    strokeRect(x: number, y: number, w: number, h: number) { strokeRects.push({ x, y, w, h }) },
    fillText(text: string, x: number, y: number) { texts.push({ text, x, y }) },
    beginPath() {}, rect() {}, clip() {}, setLineDash() {},
    save() {}, restore() {},
  } as unknown as CanvasRenderingContext2D
  return { ctx, fillRects, strokeRects, texts }
}

function makeSmartTextCellItem(): SLIFItem {
  return {
    nodeId: 'st-1', nodeType: 'smarttext', type: 'smarttext',
    text: '[患者姓名]', x: 0, y: 0,
    width: 0, height: 0, ascent: 12 * 0.8, descent: 0,
    font: 'SimSun', size: 12,
  }
}

function makeTextCellItem(): SLIFItem {
  return {
    nodeId: 'tx-1', nodeType: 'text', type: 'text',
    text: '普通文本', x: 0, y: 0,
    width: 0, height: 0, ascent: 12 * 0.8, descent: 0,
    font: 'SimSun', size: 12,
  }
}

function makeTableItem(cellItems: SLIFItem[]): SLIFItem {
  return {
    nodeId: 'tbl-1', nodeType: 'table', type: 'table',
    x: 0, y: 0, width: 100, height: 30, ascent: 0, descent: 0,
    font: 'SimSun', size: 12,
    rows: [{
      height: 30,
      cells: [{ x: 0, y: 0, width: 100, height: 30, items: cellItems }],
    }],
  }
}

function renderTable(cellItems: SLIFItem[], style?: PresentationStyle, def?: TemplateDefinition) {
  const rec = makeRecordingCtx()
  const particle = createTableParticle()
  particle.render(rec.ctx, makeTableItem(cellItems), 0, 0, {
    presentationStyleOf: (id) => (id === 'st-1' ? style : undefined),
    templateDefinitionOf: (id) => (id === 'st-1' ? def : undefined),
  })
  return rec
}

describe('TableParticle 表格 cell 内 smarttext (契约 §4)', () => {
  it('cell 内 smarttext → 方括号框 (非盒), 与正文一致', () => {
    const r = renderTable([makeSmartTextCellItem()])
    // smarttext 方括号框画 `[ ]` (fillText), 不画 fillRect/strokeRect (非盒)
    expect(r.fillRects).toHaveLength(0)
    // 仅 cell 边框
    expect(r.strokeRects).toHaveLength(1)
    // 主文本 (占位符剥离外框) + 方括号仍绘制
    expect(r.texts.some((t) => t.text === '[')).toBe(true)
    expect(r.texts.some((t) => t.text === ']')).toBe(true)
    expect(r.texts.some((t) => t.text === '患者姓名')).toBe(true)
  })

  it('cell 内 smarttext borderStyle "none" → 不画盒 (仅 cell 边框)', () => {
    const r = renderTable([makeSmartTextCellItem()], { borderStyle: 'none' })
    expect(r.fillRects).toHaveLength(0)
    expect(r.strokeRects).toHaveLength(1)
  })

  it('cell 内普通 text → 不画盒 (仅 cell 边框)', () => {
    const r = renderTable([makeTextCellItem()])
    expect(r.fillRects).toHaveLength(0)
    expect(r.strokeRects).toHaveLength(1)
  })

  it('cell 内 smarttext + label → 绘制附属字面量', () => {
    const r = renderTable([makeSmartTextCellItem()], undefined, { label: '姓名：' })
    expect(r.texts.some((t) => t.text === '姓名：')).toBe(true)
  })

  // ---- 嵌套表 (契约 §31.13) ----
  //
  // cell 里可以合法地放一张表。这条分支此前不存在 —— 渲染循环只认
  // smarttext/text, 嵌套表项的 .text 为空, 会被 `if (!ci2.text) continue`
  // 静默跳过: 布局排了、渲染不画, 屏幕上什么也没有。

  it('cell 内嵌套表 → 递归渲染其文本, 并画出内外两层 cell 边框', () => {
    const nested = makeTableItem([makeTextCellItem()])
    const r = renderTable([nested])
    // 内层文本被真正绘制 (不是被 !ci2.text 跳过)
    expect(r.texts.some((t) => t.text === '普通文本')).toBe(true)
    // 外层 cell 边框 + 内层 cell 边框
    expect(r.strokeRects.length).toBe(2)
  })

  it('cell 内嵌套表: 内层 smarttext 仍走 ControlParticle (不是 fillText 绕过)', () => {
    const nested = makeTableItem([makeSmartTextCellItem()])
    const r = renderTable([nested])
    // 方括号框由 ControlParticle 绘制 —— 证明递归后仍经 registry 委托
    expect(r.texts.some((t) => t.text === '[')).toBe(true)
    expect(r.texts.some((t) => t.text === '患者姓名')).toBe(true)
  })
})

// ================================================================
// cell 内原子行内项 → 交回宿主渲染 (契约 §31.13.1)
//
// 图片/域/交叉引用/脚注引用的渲染能力在 Draw (图片缓存、按页解析的域值),
// TableParticle 不能自己画; 此前这些类型既没委托也没 fillText, 静默不画。
// ================================================================

describe('TableParticle cell 原子项委托 (契约 §31.13.1)', () => {
  it('image/field 交给 renderCellItem, 坐标含 cell 内边距', () => {
    const seen: { type?: string; x: number; y: number }[] = []
    const rec = makeRecordingCtx()
    createTableParticle().render(rec.ctx, makeTableItem([
      {
        nodeId: 'img-1', nodeType: 'image', type: 'image', text: '',
        x: 0, y: 0, width: 40, height: 30, ascent: 30, descent: 0,
        font: 'SimSun', size: 12,
      },
      {
        nodeId: 'fld-1', nodeType: 'field', type: 'field', text: '[页码]',
        x: 40, y: 0, width: 20, height: 16, ascent: 12, descent: 4,
        font: 'SimSun', size: 12, fieldType: 'page_number',
      },
    ]), 0, 0, {
      renderCellItem: (_c, item, x, y) => {
        seen.push({ type: item.type, x, y })
        return true
      },
    })

    expect(seen.map(s => s.type)).toEqual(['image', 'field'])
    // 第一项从 cell 左缘 + CELL_PADDING(6) 起画
    expect(seen[0].x).toBe(6)
    // 委托返回 true → 不再走 fillText 兜底
    expect(rec.texts).toHaveLength(0)
  })

  it('smarttext 仍走 ControlParticle, 不经过 renderCellItem', () => {
    let called = 0
    const rec = makeRecordingCtx()
    createTableParticle().render(rec.ctx, makeTableItem([makeSmartTextCellItem()]), 0, 0, {
      renderCellItem: () => { called++; return true },
    })
    expect(called).toBe(0)
    expect(rec.texts.some((t) => t.text === '患者姓名')).toBe(true)
  })
})
