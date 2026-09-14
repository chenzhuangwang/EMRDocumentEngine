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
})
