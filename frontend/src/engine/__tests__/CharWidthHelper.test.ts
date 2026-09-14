// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// CharWidthHelper 逐字符累积宽度测试
// 验证半角/全角字符宽度区分
// ============================================================

import { describe, it, expect } from 'vitest'
import { cumulativeCharWidths, findCharIndexAtX, cumulativeWidthUpTo, computeOffsetInItems } from '../layout/text/CharWidthHelper'
import type { OffsetHitItem } from '../layout/text/CharWidthHelper'
import { testMeasurer } from './helpers'

const FONT_CFG = { font: 'SimSun', size: 16 }

describe('cumulativeCharWidths', () => {
  it('空文本返回空数组', () => {
    expect(cumulativeCharWidths('', FONT_CFG, testMeasurer)).toEqual([])
  })

  it('纯 ASCII "ABC" — 每个字符宽度 = 16*0.55 = 8.8', () => {
    const w = cumulativeCharWidths('ABC', FONT_CFG, testMeasurer)
    expect(w.length).toBe(3)
    expect(w[0]).toBeCloseTo(8.8, 1)
    expect(w[1]).toBeCloseTo(17.6, 1)
    expect(w[2]).toBeCloseTo(26.4, 1)
  })

  it('纯中文 "你好" — 每个字符宽度 = 16', () => {
    const w = cumulativeCharWidths('你好', FONT_CFG, testMeasurer)
    expect(w.length).toBe(2)
    expect(w[0]).toBeCloseTo(16, 1)
    expect(w[1]).toBeCloseTo(32, 1)
  })

  it('混合 "A你B好" — A(8.8) + 你(16) + B(8.8) + 好(16)', () => {
    const w = cumulativeCharWidths('A你B好', FONT_CFG, testMeasurer)
    expect(w.length).toBe(4)
    expect(w[0]).toBeCloseTo(8.8, 1)
    expect(w[1]).toBeCloseTo(24.8, 1)
    expect(w[2]).toBeCloseTo(33.6, 1)
    expect(w[3]).toBeCloseTo(49.6, 1)
  })

  it('混合 "123中文abc" — 数字+中文+字母各不同宽度', () => {
    const w = cumulativeCharWidths('123中文abc', FONT_CFG, testMeasurer)
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
    const cum = cumulativeCharWidths('ABC', FONT_CFG, testMeasurer)
    expect(findCharIndexAtX(0, cum, 3)).toBe(0)
    expect(findCharIndexAtX(-10, cum, 3)).toBe(0)
  })

  it('relativeX >= 总宽度 → 返回 textLen', () => {
    const cum = cumulativeCharWidths('ABC', FONT_CFG, testMeasurer)
    expect(findCharIndexAtX(30, cum, 3)).toBe(3)
    expect(findCharIndexAtX(26.4, cum, 3)).toBe(3)
  })

  it('"ABC" 中 relativeX=5 → 超过 A 中点 4.4, 返回 1', () => {
    const cum = cumulativeCharWidths('ABC', FONT_CFG, testMeasurer)  // [8.8, 17.6, 26.4]
    expect(findCharIndexAtX(5, cum, 3)).toBe(1)  // 5 > 8.8/2=4.4 → 光标在A之后
  })

  it('"ABC" 中 relativeX=8.8 → 恰好在边界, 返回 1', () => {
    const cum = cumulativeCharWidths('ABC', FONT_CFG, testMeasurer)
    expect(findCharIndexAtX(8.8, cum, 3)).toBe(1)
  })

  it('"你好" 中 relativeX=8 → 在 你 中间偏左, 返回 0', () => {
    const cum = cumulativeCharWidths('你好', FONT_CFG, testMeasurer)  // [16, 32]
    expect(findCharIndexAtX(8, cum, 2)).toBe(0)  // 8 < 8 (mid) → 0
  })

  it('"你好" 中 relativeX=16 → 边界, 返回 1', () => {
    const cum = cumulativeCharWidths('你好', FONT_CFG, testMeasurer)
    expect(findCharIndexAtX(16, cum, 2)).toBe(1)
  })

  it('"你好" 中 relativeX=24 → 恰好在 好 中点, 左偏返回 1', () => {
    const cum = cumulativeCharWidths('你好', FONT_CFG, testMeasurer)
    expect(findCharIndexAtX(24, cum, 2)).toBe(1)  // 24 = mid(16,32), left-biased
  })

  it('混合 "A你" — relativeX=10 (A 之后, 你 中) → 返回 1', () => {
    const cum = cumulativeCharWidths('A你', FONT_CFG, testMeasurer)  // [8.8, 24.8]
    // mid(0, 8.8) = 4.4, 10 > 8.8 → 继续
    // mid(8.8, 24.8) = 16.8, 10 < 16.8 → 返回 1
    expect(findCharIndexAtX(10, cum, 2)).toBe(1)
  })

  it('混合 "A你" — relativeX=20 (在 你 字符内偏右) → 返回 2', () => {
    const cum = cumulativeCharWidths('A你', FONT_CFG, testMeasurer)  // [8.8, 24.8]
    // mid(8.8, 24.8) = 16.8, 20 > 16.8 → 返回 2
    expect(findCharIndexAtX(20, cum, 2)).toBe(2)
  })

  it('空文本 + empty cumWidths → 总是返回 0', () => {
    expect(findCharIndexAtX(10, [], 0)).toBe(0)
  })
})

describe('cumulativeWidthUpTo', () => {
  it('offset=0 → 返回 0', () => {
    expect(cumulativeWidthUpTo('ABC', 0, FONT_CFG, testMeasurer)).toBe(0)
  })

  it('offset=1 → 返回第一个字符累积宽度 (A = 8.8)', () => {
    expect(cumulativeWidthUpTo('ABC', 1, FONT_CFG, testMeasurer)).toBeCloseTo(8.8, 1)
  })

  it('offset=3 → 返回全部 ABC 宽度', () => {
    expect(cumulativeWidthUpTo('ABC', 3, FONT_CFG, testMeasurer)).toBeCloseTo(26.4, 1)
  })

  it('offset 超出长度 → 返回全部宽度', () => {
    expect(cumulativeWidthUpTo('ABC', 10, FONT_CFG, testMeasurer)).toBeCloseTo(26.4, 1)
  })

  it('混合 "A你" offset=1 → A 宽度', () => {
    expect(cumulativeWidthUpTo('A你', 1, FONT_CFG, testMeasurer)).toBeCloseTo(8.8, 1)
  })

  it('混合 "A你" offset=2 → A + 你 宽度', () => {
    expect(cumulativeWidthUpTo('A你', 2, FONT_CFG, testMeasurer)).toBeCloseTo(24.8, 1)
  })

  it('空文本返回 0', () => {
    expect(cumulativeWidthUpTo('', 5, FONT_CFG, testMeasurer)).toBe(0)
  })
})

describe('computeOffsetInItems — 拆分节点后行尾/中段点击', () => {
  function item(text: string, x: number, width: number): OffsetHitItem {
    return { text, x, y: 0, width, ascent: 12, descent: 4, font: 'SimSun', size: 16 }
  }

  // 用 measurer 推导宽度, 保证 x/width 与 cumulativeCharWidths 内部一致 (避免硬编码浮点误差)
  const wH = cumulativeWidthUpTo('H', 1, FONT_CFG, testMeasurer)
  const wEll = cumulativeWidthUpTo('ell', 3, FONT_CFG, testMeasurer)
  const wO = cumulativeWidthUpTo('o', 1, FONT_CFG, testMeasurer)
  const x0 = 90
  const x1 = x0 + wH
  const x2 = x1 + wEll
  // "Hello" 经局部选区格式化拆成 "H"/"ell"/"o" 三个相邻 item
  const splitItems: OffsetHitItem[] = [
    item('H', x0, wH),
    item('ell', x1, wEll),
    item('o', x2, wO),
  ]

  it('点击文字末尾 (越过最后 item 右边界) → 返回整段长度 5 (旧 bug 返回 1)', () => {
    expect(computeOffsetInItems(splitItems, x2 + wO + 1, 5, testMeasurer)).toBe(5)
    expect(computeOffsetInItems(splitItems, x2 + wO + 100, 5, testMeasurer)).toBe(5)
  })

  it('点击中间 item "ell" 第一个字符内部 → 返回 offset 2 (旧 bug 返回 1)', () => {
    const cumEll = cumulativeCharWidths('ell', FONT_CFG, testMeasurer)
    const relX = cumEll[0] + (cumEll[1] - cumEll[0]) * 0.3 // 明显在第一个 'l' 内部
    expect(computeOffsetInItems(splitItems, x1 + relX, 5, testMeasurer)).toBe(2)
  })

  it('点击第三个 item "o" 右半 → 返回 offset 5', () => {
    const cumO = cumulativeCharWidths('o', FONT_CFG, testMeasurer)
    expect(computeOffsetInItems(splitItems, x2 + cumO[0] * 0.6, 5, testMeasurer)).toBe(5)
  })

  it('点击行首之前 → 返回 0', () => {
    expect(computeOffsetInItems(splitItems, x0 - 10, 5, testMeasurer)).toBe(0)
  })

  it('点击恰在 "H"/"ell" 边界 → 返回 1', () => {
    expect(computeOffsetInItems(splitItems, x1, 5, testMeasurer)).toBe(1)
  })

  it('单 item 行 (未拆分) 点击末尾 → 仍返回整段长度', () => {
    const wHello = cumulativeWidthUpTo('Hello', 5, FONT_CFG, testMeasurer)
    const single = [item('Hello', x0, wHello)]
    expect(computeOffsetInItems(single, x0 + wHello + 1, 5, testMeasurer)).toBe(5)
  })

  it('不同行: 点击第二行 item → 正确累积第一行长度', () => {
    const wAB = cumulativeWidthUpTo('AB', 2, FONT_CFG, testMeasurer)
    const wCD = cumulativeWidthUpTo('CD', 2, FONT_CFG, testMeasurer)
    const twoLines: OffsetHitItem[] = [
      item('AB', x0, wAB),     // 第一行 y=0
      item('CD', x0, wCD),     // 第二行 y=16
    ]
    twoLines[1].y = 16
    // 点击第二行 CD 末尾 → 累积 AB(2) + CD(2) = 4
    expect(computeOffsetInItems(twoLines, x0 + wCD, 20, testMeasurer)).toBe(4)
  })
})

describe('computeOffsetInItems — 图片原子命中 (拖选覆盖图片)', () => {
  function imgItem(x: number, width: number): OffsetHitItem {
    return { type: 'image', x, y: 0, width, ascent: 80, descent: 0 }
  }

  it('命中图片右半 → 返回 1 (选区覆盖图片)', () => {
    expect(computeOffsetInItems([imgItem(90, 100)], 90 + 60, 40, testMeasurer)).toBe(1)
  })

  it('命中图片左半 → 返回 0 (光标在图片前)', () => {
    expect(computeOffsetInItems([imgItem(90, 100)], 90 + 30, 40, testMeasurer)).toBe(0)
  })

  it('越过图片右边界 (行尾) → 返回 1', () => {
    expect(computeOffsetInItems([imgItem(90, 100)], 90 + 100 + 10, 40, testMeasurer)).toBe(1)
  })

  it('文本 + 图片: 命中图片右半 → 累积文本长度 + 1', () => {
    const wAB = cumulativeWidthUpTo('AB', 2, FONT_CFG, testMeasurer)
    const items: OffsetHitItem[] = [
      { text: 'AB', x: 90, y: 0, width: wAB, ascent: 12, descent: 4, font: 'SimSun', size: 16 },
      imgItem(90 + wAB, 100),
    ]
    expect(computeOffsetInItems(items, 90 + wAB + 60, 40, testMeasurer)).toBe(3)
  })
})
