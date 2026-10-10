// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// canvasTokens — 闸门测试 (v6.1 画布主题)
//
// 校验: 4 预设 × 28 token 全部填值; standard 预设与今天硬编码 hex 严格对齐;
//       dark 预设可读性; 字段完整; 工具函数正确。
//
// 风格对齐 chromeTokens.test.ts (chrome 主题闸门)。
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  CANVAS_TOKENS, CANVAS_TOKEN_NAMES, STANDARD_CANVAS_TOKENS,
  asRgb, withAlpha, isCanvasTokenName,
  type CanvasTokenName,
} from '../canvasTokens'

const RGB_TRIPLE = /^\d{1,3} \d{1,3} \d{1,3}$/

describe('CANVAS_TOKENS', () => {
  it('CANVAS_TOKEN_NAMES 与 standard 键集一致 (无遗漏/无多)', () => {
    const nameSet = new Set<string>(CANVAS_TOKEN_NAMES)
    const standardKeys = Object.keys(CANVAS_TOKENS.standard)
    expect(new Set(standardKeys)).toEqual(nameSet)
  })

  it('4 预设 × 28 token 全部填值 (无 undefined / 空串)', () => {
    for (const preset of ['standard', 'eyeCare', 'print', 'dark'] as const) {
      const set = CANVAS_TOKENS[preset]
      for (const name of CANVAS_TOKEN_NAMES) {
        expect(set[name], `${preset}.${name} 应有值`).toBeTruthy()
      }
    }
  })

  it('每个值是 R G B 三元组字符串 (0-255, 空格分隔)', () => {
    for (const preset of ['standard', 'eyeCare', 'print', 'dark'] as const) {
      for (const name of CANVAS_TOKEN_NAMES) {
        const v = CANVAS_TOKENS[preset][name]
        expect(v, `${preset}.${name} 应是 "R G B" 形态`).toMatch(RGB_TRIPLE)
      }
    }
  })

  it('STANDARD_CANVAS_TOKENS 是 standard 预设的引用 (避免两份)', () => {
    expect(STANDARD_CANVAS_TOKENS).toBe(CANVAS_TOKENS.standard)
  })

  it('isCanvasTokenName 收窄 (hasOwnProperty 守卫原型链)', () => {
    expect(isCanvasTokenName('pageBg')).toBe(true)
    expect(isCanvasTokenName('cursorColor')).toBe(true)
    expect(isCanvasTokenName('toString')).toBe(false)  // 原型链上的键
    expect(isCanvasTokenName('not-a-token')).toBe(false)
    expect(isCanvasTokenName(null)).toBe(false)
    expect(isCanvasTokenName(undefined)).toBe(false)
    expect(isCanvasTokenName(42)).toBe(false)
  })
})

describe('CANVAS_TOKENS.standard 视觉零回归守门', () => {
  // 与今天 Draw / 各 Particle 硬编码 hex 严格对照 —— 任一失守即视觉回归
  // (除 cursorColor: 旧 '#000000' → 新 '17 24 39', 设计意图)
  const regressionMap: Record<CanvasTokenName, string> = {
    pageBg:           '255 255 255',         // #FFFFFF
    canvasBg:         '245 245 245',         // #F5F5F5
    textInk:          '31 41 55',            // #1F2937
    secondaryInk:     '55 65 81',            // #374151
    fallbackInk:      '55 65 81',            // #374151
    cursorColor:      '17 24 39',            // #111827 (设计意图; 旧 '#000000')
    selectionBg:      '59 130 246',
    selectionBgCell:  '59 130 246',
    selectionBorder:  '37 99 235',
    hfFocusRing:      '147 197 253',         // #93C5FD
    hfMask:           '107 114 128',         // #6B7280
    hfDivider:        '204 204 204',         // #CCCCCC
    revisionInsert:   '22 163 74',           // #16A34A
    revisionDelete:   '220 38 38',           // #DC2626
    revisionModify:   '37 99 235',           // #2563EB
    invisibleChar:    '147 197 253',         // #93C5FD
    commentHighlight: '255 230 100',
    tableBorder:      '156 163 175',         // #9CA3AF
    tableHeaderBg:    '243 244 246',         // #F3F4F6
    placeholder:      '156 163 175',         // #9CA3AF
    frameFilled:      '107 114 128',         // #6B7280
    frameReadonly:    '209 213 219',         // #D1D5DB
    frameMasked:      '248 113 113',         // #F87171
    glyphSelected:    '37 99 235',           // #2563EB
    glyphUnselected:  '156 163 175',         // #9CA3AF
    footnoteRef:      '37 99 235',           // #2563EB
    imagePlaceholder: '229 231 235',         // #E5E7EB
    imagePlaceholderBorder: '156 163 175',   // #9CA3AF
  }

  for (const [name, expected] of Object.entries(regressionMap) as [CanvasTokenName, string][]) {
    it(`standard.${name} = "${expected}" (对齐今天硬编码)`, () => {
      expect(CANVAS_TOKENS.standard[name]).toBe(expected)
    })
  }
})

describe('CANVAS_TOKENS.dark 可读性守门', () => {
  it('pageBg 与 textInk 对比度 ≥ 4.5:1 (WCAG AA 正文)', () => {
    const bg = CANVAS_TOKENS.dark.pageBg.split(' ').map(Number)
    const fg = CANVAS_TOKENS.dark.textInk.split(' ').map(Number)
    const lBg = relativeLuminance(bg[0], bg[1], bg[2])
    const lFg = relativeLuminance(fg[0], fg[1], fg[2])
    const ratio = (Math.max(lBg, lFg) + 0.05) / (Math.min(lBg, lFg) + 0.05)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('pageBg 与 selectionBg (alpha 0.2 合成) 仍可分辨', () => {
    // 选区在深底上应仍能看到, 这里只验色差异存在
    expect(CANVAS_TOKENS.dark.selectionBg).not.toBe(CANVAS_TOKENS.dark.pageBg)
  })
})

describe('CANVAS_TOKENS.eyeCare 暖色守门', () => {
  it('pageBg 走暖色 (R > B 显著)', () => {
    const [r, , b] = CANVAS_TOKENS.eyeCare.pageBg.split(' ').map(Number)
    expect(r).toBeGreaterThan(b + 10)
  })
  it('textInk 走暖色, 不会出现冷蓝字', () => {
    const [r, , b] = CANVAS_TOKENS.eyeCare.textInk.split(' ').map(Number)
    expect(r).toBeGreaterThan(b)
  })
})

describe('CANVAS_TOKENS.print 灰阶守门', () => {
  it('pageBg 纯白, textInk 纯黑', () => {
    expect(CANVAS_TOKENS.print.pageBg).toBe('255 255 255')
    expect(CANVAS_TOKENS.print.textInk).toBe('0 0 0')
  })
  it('canvasBg 与 pageBg 同白 (打印时桌面与纸面同色)', () => {
    expect(CANVAS_TOKENS.print.canvasBg).toBe(CANVAS_TOKENS.print.pageBg)
  })
})

describe('asRgb / withAlpha 工具', () => {
  it('asRgb 把 "R G B" 拼成 "rgb(R, G, B)"', () => {
    expect(asRgb('17 24 39')).toBe('rgb(17, 24, 39)')
    expect(asRgb('255 255 255')).toBe('rgb(255, 255, 255)')
  })
  it('asRgb 缺值兜底为黑', () => {
    expect(asRgb(null)).toBe('rgb(0, 0, 0)')
    expect(asRgb(undefined)).toBe('rgb(0, 0, 0)')
    expect(asRgb('')).toBe('rgb(0, 0, 0)')
  })
  it('withAlpha 把 "R G B" + alpha 拼成 "rgb(R G B / α)" (CSS Level 4)', () => {
    expect(withAlpha('17 24 39', 0.5)).toBe('rgb(17 24 39 / 0.5)')
    expect(withAlpha('59 130 246', 0.2)).toBe('rgb(59 130 246 / 0.2)')
    expect(withAlpha('59 130 246', 1)).toBe('rgb(59 130 246 / 1)')
  })
  it('withAlpha 缺值兜底为透明黑', () => {
    expect(withAlpha(null, 0.5)).toBe('rgb(0 0 0 / 0)')
    expect(withAlpha(undefined, 0)).toBe('rgb(0 0 0 / 0)')
  })
})

// ---- 工具 ----

/** WCAG 相对亮度 (sRGB → linear → 加权) */
function relativeLuminance(r: number, g: number, b: number): number {
  const toLinear = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}