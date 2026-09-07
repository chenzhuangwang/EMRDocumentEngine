// ============================================================
// LineBreaker — 多行文本控件 minRows 行高 (契约 §12.6.2 layer D)
//
// minRows>1 的 smarttext 元素应使整行垂直空间延展为 minRows 行,
// 首行 ascent 不变, descent 向下延展 (N-1) 行 → 行高 = minRows * size。
// ============================================================

import { describe, it, expect } from 'vitest'
import { LineBreaker } from '../layout/line/LineBreaker'
import type { LineElement } from '../layout/line/LineLayout'
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
