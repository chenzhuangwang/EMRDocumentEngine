// ================================================================
// ControlEditGeometry — computeFieldRegion / wrapControlText / 多行·激活绘制
// ================================================================

import { describe, it, expect } from 'vitest'
import { computeFieldRegion } from '../document/control/ControlFieldGeometry'
import { wrapControlText } from '../layout/text/TextWrap'
import { computeControlBox, CONTROL_BOX_PADDING } from '../document/control/ControlBox'
import { createControlParticle } from '../render/particles/ControlParticle'
import type { SLIFItem } from '../layout/core/SLIF'
import type { TemplateDefinition } from '../template/TemplateDefinition'
import type { ElementMeta } from '../document/core/DocumentModel'

const measure = (t: string) => t.length * 6 // 定宽 mock: 每字符 6px

function regionOf(controlType: string | undefined, opts?: { lineLeft?: number; layoutWidth?: number; borderStyle?: string; textAlignOverride?: 'left' | 'center' | 'right'; minWidth?: number }) {
  return computeFieldRegion({
    controlType,
    lineLeft: opts?.lineLeft ?? 10,
    lineTop: 100,
    layoutWidth: opts?.layoutWidth ?? 50,
    ascent: 12.8,
    descent: 3.2,
    minWidth: opts?.minWidth,
    borderStyle: opts?.borderStyle,
    textAlignOverride: opts?.textAlignOverride,
    measure,
  })
}

describe('computeFieldRegion (编辑文本区几何, 与 ControlParticle 同源)', () => {
  it('input/brackets: 文本区 = 括号内 (左缘 leftEdge+PADDING+bracketW)', () => {
    const r = regionOf('input', { lineLeft: 10 })
    const box = computeControlBox(10, 100, 50, 12.8, 3.2)
    // mock measure: '[' 6px
    expect(r.bracketOn).toBe(true)
    expect(r.bracketW).toBe(6)
    expect(r.textX).toBeCloseTo(box.leftEdge + CONTROL_BOX_PADDING + 6)
    expect(r.contentW).toBeCloseTo(50 + 6 - CONTROL_BOX_PADDING * 2 - 6 * 2)
  })

  it("borderStyle 'none' → 无括号, 文本区 = 内容区", () => {
    const r = regionOf('input', { lineLeft: 10, borderStyle: 'none' })
    expect(r.bracketOn).toBe(false)
    expect(r.bracketW).toBe(0)
    const box = computeControlBox(10, 100, 50, 12.8, 3.2)
    expect(r.textX).toBeCloseTo(box.leftEdge + CONTROL_BOX_PADDING)
    expect(r.contentW).toBeCloseTo(box.contentW)
  })

  it('number 右对齐 (缺省 align right)', () => {
    const r = regionOf('number', { lineLeft: 10 })
    expect(r.align).toBe('right')
  })

  it('textarea/box: 文本区 = 内容区 (无括号)', () => {
    const r = regionOf('textarea', { lineLeft: 10 })
    expect(r.frame).toBe('box')
    expect(r.bracketOn).toBe(false)
    const box = computeControlBox(10, 100, 50, 12.8, 3.2)
    expect(r.textX).toBeCloseTo(box.leftEdge + CONTROL_BOX_PADDING)
    expect(r.textRightX).toBeCloseTo(box.rightEdge - CONTROL_BOX_PADDING)
  })
})

describe('wrapControlText', () => {
  const W = (t: string) => t.length * 6
  it('空串 → [""] 一个空物理行', () => {
    expect(wrapControlText('', 100, W)).toEqual([''])
  })
  it('wrapAt null → 不折 (保留 \\n 逻辑行)', () => {
    expect(wrapControlText('ab\ncd', null, W)).toEqual(['ab', 'cd'])
  })
  it('行宽不超 wrapAt → 原样', () => {
    expect(wrapControlText('ab', 100, W)).toEqual(['ab'])
  })
  it('超宽逻辑行 → 逐字符软折 (CJK 逐字)', () => {
    // 'abcdefgh' 宽 48 > wrapAt 24 → 每 4 字一行
    expect(wrapControlText('abcdefgh', 24, W)).toEqual(['abcd', 'efgh'])
  })
  it('硬换行 + 软折混用', () => {
    expect(wrapControlText('abc\ndefghij', 18, W)).toEqual(['abc', 'def', 'ghi', 'j'])
  })
})

describe('ControlParticle 多行绘制 + 激活隐藏', () => {
  function render(item: Partial<SLIFItem>, opts?: { activeId?: string | null }) {
    const texts: Array<{ text: string; x: number; y: number; fillStyle?: string }> = []
    const strokeRects: Array<{ x: number; y: number; w: number; h: number }> = []
    let dashed = false
    const ctx: unknown = {
      measureText: (t: string) => ({ width: t.length * 6 }),
      fillText: (text: string, x: number, y: number) => texts.push({ text, x, y }),
      strokeRect: (x: number, y: number, w: number, h: number) => strokeRects.push({ x, y, w, h }),
      setLineDash: (arr: number[]) => { dashed = arr.length > 0 },
      beginPath: () => {}, closePath: () => {}, moveTo: () => {}, lineTo: () => {}, fill: () => {}, stroke: () => {},
      save: () => {}, restore: () => {},
      set fillStyle(_v: string) {}, get fillStyle(): string { return '' },
      set strokeStyle(_v: string) {}, get strokeStyle(): string { return '' },
      set lineWidth(_v: number) {}, get lineWidth(): number { return 1 },
      set textBaseline(_v: string) {}, get textBaseline(): string { return 'alphabetic' },
      set font(_v: string) {}, get font(): string { return '' },
    }
    const full: SLIFItem = {
      nodeId: 'c1', nodeType: 'smarttext', type: 'smarttext',
      text: '值', x: 10, y: 100, width: 62, height: 16, ascent: 12.8, descent: 3.2,
      font: 'SimSun', size: 16, ...item,
    }
    const def: TemplateDefinition = { controlType: 'textarea' }
    const element: ElementMeta = { code: { internal: 'C', dataElement: 'D' }, name: 'x', format: { dataType: 'S2' } }
    createControlParticle().render(ctx as CanvasRenderingContext2D, full, full.x, full.y, {
      templateDefinitionOf: () => def,
      elementOf: () => element,
      controlValueOf: () => 'abc',
      presentationStyleOf: () => undefined,
      activeControlId: opts?.activeId ?? null,
    })
    return { texts, strokeRects, dashed }
  }

  it('textarea 多行: 每行逐行 fillText (行距=size), 画四边框一次', () => {
    const { texts, strokeRects } = render({ controlLines: ['行一', '行二'] })
    expect(strokeRects).toHaveLength(1)
    expect(texts.map((t) => t.text)).toEqual(['行一', '行二'])
    // 首行基线 box.y+ascent; 第二行 +size
    expect(texts[1].y - texts[0].y).toBeCloseTo(16)
  })

  it('激活该控件 (activeControlId=nodeId) → 不画框/值 (四边框被隐藏)', () => {
    const { strokeRects, texts } = render({ controlLines: ['行一'] }, { activeId: 'c1' })
    expect(strokeRects).toHaveLength(0)
    expect(texts).toHaveLength(0)
  })
})
