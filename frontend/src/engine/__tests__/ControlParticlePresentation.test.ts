// ============================================================
// ControlParticle 表现层样式消费 (契约 §2.2, P0)
//
// 验证 draw time 按 nodeId 读取 PresentationStyle:
//   - borderStyle 'none' → 不画盒 (无背景/边框)
//   - borderStyle 'solid' → 实线 (不再画历史虚线)
//   - minWidth (number / 数字字符串) → 盒宽下限
//   - 无样式 → 保持历史虚线盒 (向后兼容)
// ============================================================

import { describe, it, expect } from 'vitest'
import { createControlParticle } from '../render/particles/ControlParticle'
import type { SLIFItem } from '../layout/core/SLIF'
import type { PresentationStyle } from '../render/presentation/PresentationStyle'

function makeItem(): SLIFItem {
  return {
    nodeId: 'st-1', nodeType: 'smarttext', type: 'smarttext',
    text: '[患者姓名]', x: 0, y: 100,
    width: 0, height: 0, ascent: 0, descent: 0,
    font: 'SimSun', size: 12,
  }
}

interface RectCall { x: number; y: number; w: number; h: number }

function makeRecordingCtx() {
  const state = { font: '' }
  const fillRects: RectCall[] = []
  const strokeRects: RectCall[] = []
  const dashes: number[][] = []
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
    setLineDash(d: number[]) { dashes.push(d) },
    fillText() {}, save() {}, restore() {},
  } as unknown as CanvasRenderingContext2D
  return { ctx, fillRects, strokeRects, dashes }
}

function render(style: PresentationStyle | undefined) {
  const rec = makeRecordingCtx()
  const particle = createControlParticle()
  particle.render(rec.ctx, makeItem(), 0, 100, {
    presentationStyleOf: (id) => (id === 'st-1' ? style : undefined),
  })
  return rec
}

describe('ControlParticle 表现层样式 (契约 §2.2)', () => {
  it('borderStyle "none" → 不画盒 (无背景/边框)', () => {
    const r = render({ borderStyle: 'none' })
    expect(r.fillRects).toHaveLength(0)
    expect(r.strokeRects).toHaveLength(0)
  })

  it('无样式 → 保持历史虚线盒 (向后兼容)', () => {
    const r = render(undefined)
    expect(r.fillRects).toHaveLength(1)
    expect(r.strokeRects).toHaveLength(1)
    expect(r.dashes).toContainEqual([2, 1])
  })

  it('borderStyle "solid" → 实线盒 (不再画虚线)', () => {
    const r = render({ borderStyle: 'solid' })
    expect(r.strokeRects).toHaveLength(1)
    expect(r.dashes).not.toContainEqual([2, 1])
  })

  it('minWidth (number) → 盒宽下限', () => {
    const r = render({ minWidth: 168 })
    expect(r.fillRects).toHaveLength(1)
    expect(r.fillRects[0].w).toBeGreaterThanOrEqual(168)
  })

  it('minWidth (数字字符串) → 解析为数值', () => {
    const r = render({ minWidth: '168' })
    expect(r.fillRects).toHaveLength(1)
    expect(r.fillRects[0].w).toBeGreaterThanOrEqual(168)
  })
})
