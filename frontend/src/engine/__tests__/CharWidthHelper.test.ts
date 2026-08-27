// ============================================================
// CharWidthHelper 逐字符累积宽度测试
// 验证半角/全角字符宽度区分
// ============================================================

import { describe, it, expect } from 'vitest'
import { cumulativeCharWidths, findCharIndexAtX, cumulativeWidthUpTo } from '../layout/text/CharWidthHelper'

const FONT_CFG = { font: 'SimSun', size: 16 }

describe('cumulativeCharWidths', () => {
  it('空文本返回空数组', () => {
    expect(cumulativeCharWidths('', FONT_CFG)).toEqual([])
  })

  it('纯 ASCII "ABC" — 每个字符宽度 = 16*0.55 = 8.8', () => {
    const w = cumulativeCharWidths('ABC', FONT_CFG)
    expect(w.length).toBe(3)
    expect(w[0]).toBeCloseTo(8.8, 1)
    expect(w[1]).toBeCloseTo(17.6, 1)
    expect(w[2]).toBeCloseTo(26.4, 1)
  })

  it('纯中文 "你好" — 每个字符宽度 = 16', () => {
    const w = cumulativeCharWidths('你好', FONT_CFG)
    expect(w.length).toBe(2)
    expect(w[0]).toBeCloseTo(16, 1)
    expect(w[1]).toBeCloseTo(32, 1)
  })

  it('混合 "A你B好" — A(8.8) + 你(16) + B(8.8) + 好(16)', () => {
    const w = cumulativeCharWidths('A你B好', FONT_CFG)
    expect(w.length).toBe(4)
    expect(w[0]).toBeCloseTo(8.8, 1)
    expect(w[1]).toBeCloseTo(24.8, 1)
    expect(w[2]).toBeCloseTo(33.6, 1)
    expect(w[3]).toBeCloseTo(49.6, 1)
  })

  it('混合 "123中文abc" — 数字+中文+字母各不同宽度', () => {
    const w = cumulativeCharWidths('123中文abc', FONT_CFG)
    // 1(8.8), 2(8.8), 3(8.8), 中(16), 文(16), a(8.8), b(8.8), c(8.8)
    expect(w.length).toBe(8)
    expect(w[0]).toBeCloseTo(8.8, 1)
    expect(w[1]).toBeCloseTo(17.6, 1)
    expect(w[2]).toBeCloseTo(26.4, 1)
    expect(w[3]).toBeCloseTo(42.4, 1)  // + 中文16
    expect(w[4]).toBeCloseTo(58.4, 1)  // + 中文16
    expect(w[5]).toBeCloseTo(67.2, 1)  // + a(8.8)
    expect(w[6]).toBeCloseTo(76.0, 1)  // + b(8.8)
    expect(w[7]).toBeCloseTo(84.8, 1)  // + c(8.8)
  })
})

describe('findCharIndexAtX', () => {
  it('relativeX <= 0 → 返回 0', () => {
    const cum = cumulativeCharWidths('ABC', FONT_CFG)
    expect(findCharIndexAtX(0, cum, 3)).toBe(0)
    expect(findCharIndexAtX(-10, cum, 3)).toBe(0)
  })

  it('relativeX >= 总宽度 → 返回 textLen', () => {
    const cum = cumulativeCharWidths('ABC', FONT_CFG)
    expect(findCharIndexAtX(30, cum, 3)).toBe(3)
    expect(findCharIndexAtX(26.4, cum, 3)).toBe(3)
  })

  it('"ABC" 中 relativeX=5 → 超过 A 中点 4.4, 返回 1', () => {
    const cum = cumulativeCharWidths('ABC', FONT_CFG)  // [8.8, 17.6, 26.4]
    expect(findCharIndexAtX(5, cum, 3)).toBe(1)  // 5 > 8.8/2=4.4 → 光标在A之后
  })

  it('"ABC" 中 relativeX=8.8 → 恰好在边界, 返回 1', () => {
    const cum = cumulativeCharWidths('ABC', FONT_CFG)
    expect(findCharIndexAtX(8.8, cum, 3)).toBe(1)
  })

  it('"你好" 中 relativeX=8 → 在 你 中间偏左, 返回 0', () => {
    const cum = cumulativeCharWidths('你好', FONT_CFG)  // [16, 32]
    expect(findCharIndexAtX(8, cum, 2)).toBe(0)  // 8 < 8 (mid) → 0
  })

  it('"你好" 中 relativeX=16 → 边界, 返回 1', () => {
    const cum = cumulativeCharWidths('你好', FONT_CFG)
    expect(findCharIndexAtX(16, cum, 2)).toBe(1)
  })

  it('"你好" 中 relativeX=24 → 恰好在 好 中点, 左偏返回 1', () => {
    const cum = cumulativeCharWidths('你好', FONT_CFG)
    expect(findCharIndexAtX(24, cum, 2)).toBe(1)  // 24 = mid(16,32), left-biased
  })

  it('混合 "A你" — relativeX=10 (A 之后, 你 中) → 返回 1', () => {
    const cum = cumulativeCharWidths('A你', FONT_CFG)  // [8.8, 24.8]
    // mid(0, 8.8) = 4.4, 10 > 8.8 → 继续
    // mid(8.8, 24.8) = 16.8, 10 < 16.8 → 返回 1
    expect(findCharIndexAtX(10, cum, 2)).toBe(1)
  })

  it('混合 "A你" — relativeX=20 (在 你 字符内偏右) → 返回 2', () => {
    const cum = cumulativeCharWidths('A你', FONT_CFG)  // [8.8, 24.8]
    // mid(8.8, 24.8) = 16.8, 20 > 16.8 → 返回 2
    expect(findCharIndexAtX(20, cum, 2)).toBe(2)
  })

  it('空文本 + empty cumWidths → 总是返回 0', () => {
    expect(findCharIndexAtX(10, [], 0)).toBe(0)
  })
})

describe('cumulativeWidthUpTo', () => {
  it('offset=0 → 返回 0', () => {
    expect(cumulativeWidthUpTo('ABC', 0, FONT_CFG)).toBe(0)
  })

  it('offset=1 → 返回第一个字符累积宽度 (A = 8.8)', () => {
    expect(cumulativeWidthUpTo('ABC', 1, FONT_CFG)).toBeCloseTo(8.8, 1)
  })

  it('offset=3 → 返回全部 ABC 宽度', () => {
    expect(cumulativeWidthUpTo('ABC', 3, FONT_CFG)).toBeCloseTo(26.4, 1)
  })

  it('offset 超出长度 → 返回全部宽度', () => {
    expect(cumulativeWidthUpTo('ABC', 10, FONT_CFG)).toBeCloseTo(26.4, 1)
  })

  it('混合 "A你" offset=1 → A 宽度', () => {
    expect(cumulativeWidthUpTo('A你', 1, FONT_CFG)).toBeCloseTo(8.8, 1)
  })

  it('混合 "A你" offset=2 → A + 你 宽度', () => {
    expect(cumulativeWidthUpTo('A你', 2, FONT_CFG)).toBeCloseTo(24.8, 1)
  })

  it('空文本返回 0', () => {
    expect(cumulativeWidthUpTo('', 5, FONT_CFG)).toBe(0)
  })
})
