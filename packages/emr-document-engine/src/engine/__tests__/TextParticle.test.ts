// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// TextParticle 基线对齐测试
//
// 回归守护: 加粗/非加粗片段应共享同一行级 ascent 作为基线,
// 而非逐字形 actualBoundingBoxAscent (该值随样式/字符变化,
// 导致字母/数字加粗后产生垂直位移)。
// ============================================================

import { describe, it, expect } from 'vitest'
import { TextParticle } from '../render/particles/TextParticle'

interface FillCall { text: string; x: number; y: number }

/**
 * 最小 Canvas mock: measureText 依据 ctx.font 是否含 bold 返回不同的
 * actualBoundingBoxAscent (模拟加粗后字形包围盒上移), 并记录 fillText 调用。
 */
function makeRecordingCtx() {
  const state = { font: '' }
  const fills: FillCall[] = []
  const ctx = {
    get font() { return state.font },
    set font(v: string) { state.font = v },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textBaseline: 'alphabetic' as CanvasTextBaseline,

    measureText(text: string): TextMetrics {
      const m = /(\d+)px/.exec(state.font)
      const size = m ? parseInt(m[1], 10) : 16
      const bold = state.font.includes('bold')
      return {
        width: text.length * size * 0.55,
        actualBoundingBoxAscent: bold ? size * 0.95 : size * 0.8,
        actualBoundingBoxDescent: size * 0.2,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: text.length * size * 0.55,
        fontBoundingBoxAscent: size * 0.8,
        fontBoundingBoxDescent: size * 0.2,
      } as TextMetrics
    },

    fillText(text: string, x: number, y: number) { fills.push({ text, x, y }) },
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() {}, fillRect() {},
  } as unknown as CanvasRenderingContext2D

  return { ctx, fills }
}

const el = (bold: boolean) => ({
  id: 't1', type: 'text', value: 'A', size: 16, font: 'SimSun', bold,
})

describe('TextParticle 加粗基线对齐', () => {
  it('加粗/非加粗片段用同一行级 ascent 定位基线 (不产生垂直位移)', () => {
    // 传入相同 ascent/descent, 基线应为 y + ascent, 与 bold 无关
    const a = makeRecordingCtx()
    TextParticle.render(a.ctx, el(false), 10, 100, { ascent: 20, descent: 5 })
    const b = makeRecordingCtx()
    TextParticle.render(b.ctx, el(true), 10, 100, { ascent: 20, descent: 5 })

    expect(a.fills).toHaveLength(1)
    expect(b.fills).toHaveLength(1)
    expect(a.fills[0].y).toBe(120) // 100 + 20
    expect(b.fills[0].y).toBe(120) // 加粗后仍 100 + 20, 不随 bbox 上移
    expect(a.fills[0].y).toBe(b.fills[0].y)
  })

  it('未提供 ascent 时回退到字形包围盒 (保持兼容旧调用)', () => {
    const c = makeRecordingCtx()
    TextParticle.render(c.ctx, el(false), 10, 100, {})
    // 非加粗: actualBoundingBoxAscent = 16 * 0.8 = 12.8
    expect(c.fills[0].y).toBeCloseTo(112.8, 5)
  })
})
