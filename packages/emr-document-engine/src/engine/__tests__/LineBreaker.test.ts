// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// LineBreaker — 多行文本控件 minRows 行高 (契约 §12.6.2 layer D)
//
// minRows>1 的 smarttext 元素应使整行垂直空间延展为 minRows 行,
// 首行 ascent 不变, descent 向下延展 (N-1) 行 → 行高 = minRows * size。
// ============================================================

import { describe, it, expect } from 'vitest'
import { LineBreaker } from '../layout/line/LineBreaker'
import type { LineElement } from '../layout/line/LineLayout'
import { CONTROL_BOX_PADDING } from '../document/control/ControlBox'
import { testMeasurer } from './helpers'

const options = {
  maxWidth: 1000,
  wordBreak: 'break-all' as const,
  defaultFont: 'SimSun',
  defaultSize: 16,
}

function breaker(): LineBreaker {
  return new LineBreaker(testMeasurer)
}

function el(control?: { minRows?: number }): LineElement {
  return { id: 'st-1', type: 'smarttext', value: '[字段]', size: 16, control }
}

describe('LineBreaker — minRows 多行文本域行高', () => {
  it('无 minRows → 单行行高 = size', () => {
    const lines = breaker().breakLines([el()], options)
    expect(lines).toHaveLength(1)
    expect(lines[0].height).toBeCloseTo(16)
    expect(lines[0].maxAscent).toBeCloseTo(16 * 0.8)
    expect(lines[0].maxDescent).toBeCloseTo(16 * 0.2)
  })

  it('minRows=3 → 行高 = 3 * size, 首行 ascent 不变, descent 向下延展 2 行', () => {
    const lines = breaker().breakLines([el({ minRows: 3 })], options)
    expect(lines).toHaveLength(1)
    expect(lines[0].height).toBeCloseTo(3 * 16)
    expect(lines[0].maxAscent).toBeCloseTo(16 * 0.8)
    expect(lines[0].maxDescent).toBeCloseTo(16 * 0.2 + 2 * 16)
  })

  it('minRows=1 → 等同单行 (不额外延展)', () => {
    const lines = breaker().breakLines([el({ minRows: 1 })], options)
    expect(lines[0].height).toBeCloseTo(16)
    expect(lines[0].maxDescent).toBeCloseTo(16 * 0.2)
  })

  it('文本与 minRows 控件同行 → 行高取较大者 (控件延展)', () => {
    const textEl: LineElement = { id: 't-1', type: 'text', value: '前置文本', size: 16 }
    const ctl: LineElement = el({ minRows: 3 })
    const lines = breaker().breakLines([textEl, ctl], options)
    expect(lines).toHaveLength(1)
    // 文本 descent=3.2, 控件 descent=35.2 → 行高由控件主导
    expect(lines[0].height).toBeCloseTo(3 * 16)
    expect(lines[0].maxDescent).toBeCloseTo(16 * 0.2 + 2 * 16)
  })
})

describe('LineBreaker — smarttext 盒宽参与换行 (契约 §12.6, 排版不重叠)', () => {
  it('smarttext 行宽 = 文本宽 + 2*内边距 (盒宽同源)', () => {
    const lines = breaker().breakLines([el()], options)
    const textW = testMeasurer.measureWidth('[字段]', { font: 'SimSun', size: 16 })
    expect(lines[0].width).toBeCloseTo(textW + CONTROL_BOX_PADDING * 2, 0)
  })

  it('smarttext 是原子控件: 超出剩余宽度整块换行, 不逐字拆分', () => {
    const boxW = testMeasurer.measureWidth('[字段]', { font: 'SimSun', size: 16 }) + CONTROL_BOX_PADDING * 2
    // maxWidth 放得下一个控件盒但放不下两个 → 第二块整块下沉到下一行
    const lines = breaker().breakLines([el(), el()], { ...options, maxWidth: boxW + 1 })
    expect(lines).toHaveLength(2)
    // 每行仅一个 smarttext, value 未被拆散
    for (const line of lines) {
      const smarts = line.elements.filter(e => e.type === 'smarttext')
      expect(smarts).toHaveLength(1)
      expect(smarts[0].value).toBe('[字段]')
    }
  })
})

describe('LineBreaker — 段落行距倍率 (ParagraphStyle.lineHeight)', () => {
  it('lineHeight=1.5 → 行高 = size * 1.5 (ascent/descent 不变)', () => {
    const lines = breaker().breakLines([el()], { ...options, lineHeight: 1.5 })
    expect(lines[0].height).toBeCloseTo(16 * 1.5)
    expect(lines[0].maxAscent).toBeCloseTo(16 * 0.8)
    expect(lines[0].maxDescent).toBeCloseTo(16 * 0.2)
  })
  it('lineHeight=2 → 行高 = size * 2', () => {
    const lines = breaker().breakLines([el()], { ...options, lineHeight: 2 })
    expect(lines[0].height).toBeCloseTo(32)
  })
  it('未设 lineHeight → 行高 = size (回归)', () => {
    const lines = breaker().breakLines([el()], options)
    expect(lines[0].height).toBeCloseTo(16)
  })
})
