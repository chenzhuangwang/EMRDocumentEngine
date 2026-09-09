// ============================================================
// ControlParticle 视觉与交互效果边界 (契约 §12.6, 重新校准)
//
// 验证 draw time 按 nodeId 读取, 且「控件自有交互 affordance」区分形态:
//   - field (input/number/date/select): 方括号 `[ ]` 框 (textarea: 四边框)
//   - options (radio/checkbox): 内联 `○/☐ + name` 选项组, 无框/无整体盒
//   分类唯一决策点 = document/control/ControlBox.controlVisualRecipe
//   (不变量 6); 颜色只表 state, 不再按 dataType 上色 (VR-15)。
//
//   表现层 (PresentationStyle, §2.2):
//     - borderStyle 'none' → 不画框 (brackets 分支不画 `[ ]`)
//     - minWidth → 盒宽下限 (经 computeControlBox)
//     - textAlign (center/right) → 盒内水平偏移, 覆盖 recipe.align (不变量 8)
//   设计期 (TemplateDefinition, §12.1): controlType / label / prefix / suffix
// ============================================================

import { describe, it, expect } from 'vitest'
import { createControlParticle } from '../render/particles/ControlParticle'
import { controlVisualRecipe, computeControlBox } from '../document/control/ControlBox'
import type { SLIFItem } from '../layout/core/SLIF'
import type { PresentationStyle } from '../render/presentation/PresentationStyle'
import type { TemplateDefinition } from '../template/TemplateDefinition'
import type { ElementMeta, ControlValue } from '../document/core/DocumentModel'

function makeItem(overrides: Partial<SLIFItem> = {}): SLIFItem {
  return {
    nodeId: 'st-1', nodeType: 'smarttext', type: 'smarttext',
    text: '[患者姓名]', x: 0, y: 100,
    width: 0, height: 0, ascent: 0, descent: 0,
    font: 'SimSun', size: 12,
    ...overrides,
  }
}

interface RectCall { x: number; y: number; w: number; h: number }
interface TextCall { text: string; x: number; y: number; fillStyle: string }

function makeRecordingCtx() {
  const state = { font: '' }
  const fillRects: RectCall[] = []
  const strokeRects: RectCall[] = []
  const dashes: number[][] = []
  const texts: TextCall[] = []
  const pathFills: string[] = []
  const pathStrokes: string[] = []
  const ctx = {
    get font() { return state.font },
    set font(v: string) { state.font = v },
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    measureText(text: string) {
      return { width: text.length * 12 * 0.55 } as TextMetrics
    },
    fillRect(x: number, y: number, w: number, h: number) {
      fillRects.push({ x, y, w, h })
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      strokeRects.push({ x, y, w, h })
    },
    setLineDash(d: number[]) { dashes.push(d) },
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, fillStyle: ctx.fillStyle as string })
    },
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    fill() { pathFills.push(ctx.fillStyle as string) },
    stroke() { pathStrokes.push(ctx.strokeStyle as string) },
    save() {}, restore() {},
  } as unknown as CanvasRenderingContext2D
  return { ctx, fillRects, strokeRects, dashes, texts, pathFills, pathStrokes }
}

interface RenderInput {
  style?: PresentationStyle
  def?: TemplateDefinition
  element?: ElementMeta
  value?: ControlValue
  text?: string
  width?: number
}

function render(input: RenderInput = {}) {
  const rec = makeRecordingCtx()
  const particle = createControlParticle()
  particle.render(rec.ctx, makeItem({ text: input.text ?? '[患者姓名]', width: input.width ?? 0 }), 0, 100, {
    presentationStyleOf: (id) => (id === 'st-1' ? input.style : undefined),
    templateDefinitionOf: (id) => (id === 'st-1' ? input.def : undefined),
    elementOf: (id) => (id === 'st-1' ? input.element : undefined),
    controlValueOf: (id) => (id === 'st-1' ? input.value : undefined),
  })
  return rec
}

/** 框内文本 (空态占位符剥离外框后的 inner, 或填充态值原样) */
const innerText = (rec: ReturnType<typeof render>, t: string) =>
  rec.texts.find((x) => x.text === t)

// ---- computeControlBox (盒几何单一源) ----
describe('computeControlBox — 盒几何不含垂直 padding (换行不垂直重叠)', () => {
  it('盒顶 = lineTop, 盒高 = ascent + descent (不超出行高)', () => {
    const box = computeControlBox(10, 100, 50, 12.8, 3.2)
    expect(box.y).toBe(100)
    expect(box.h).toBeCloseTo(16)
  })

  it('盒宽 = max(width, minWidth) + 2*padding; leftEdge 左扩 padding', () => {
    const box = computeControlBox(10, 100, 50, 12.8, 3.2)
    expect(box.w).toBeCloseTo(50 + 6)
    expect(box.leftEdge).toBe(10 - 3)
  })

  it('minWidth (number) 作为盒宽下限', () => {
    const box = computeControlBox(10, 100, 10, 12.8, 3.2, 168)
    expect(box.w).toBeGreaterThanOrEqual(168 + 6)
  })

  it('minWidth (数字字符串) 解析为数值', () => {
    const box = computeControlBox(10, 100, 10, 12.8, 3.2, '168')
    expect(box.w).toBeGreaterThanOrEqual(168 + 6)
  })
})

// ---- controlVisualRecipe (唯一视觉分类决策点, 不变量 6) ----
describe('controlVisualRecipe — controlType → 视觉配方 (唯一分类决策点)', () => {
  it('input → field / brackets / left / null', () => {
    expect(controlVisualRecipe('input')).toEqual({ kind: 'field', frame: 'brackets', align: 'left', affordance: null })
  })
  it('number → field / brackets / right / null', () => {
    expect(controlVisualRecipe('number')).toEqual({ kind: 'field', frame: 'brackets', align: 'right', affordance: null })
  })
  it('date → field / brackets / left / calendar', () => {
    expect(controlVisualRecipe('date')).toEqual({ kind: 'field', frame: 'brackets', align: 'left', affordance: 'calendar' })
  })
  it('select → field / brackets / left / dropdown', () => {
    expect(controlVisualRecipe('select')).toEqual({ kind: 'field', frame: 'brackets', align: 'left', affordance: 'dropdown' })
  })
  it('textarea → field / box / left / null', () => {
    expect(controlVisualRecipe('textarea')).toEqual({ kind: 'field', frame: 'box', align: 'left', affordance: null })
  })
  it('radio / checkbox → options / none / left / null (无框无括号)', () => {
    expect(controlVisualRecipe('radio')).toEqual({ kind: 'options', frame: null, align: 'left', affordance: null })
    expect(controlVisualRecipe('checkbox')).toEqual({ kind: 'options', frame: null, align: 'left', affordance: null })
  })
  it('缺失 controlType (遗留文档) → 中性占位框 field/brackets/left/null', () => {
    expect(controlVisualRecipe(undefined)).toEqual({ kind: 'field', frame: 'brackets', align: 'left', affordance: null })
  })
})

// ---- 表现层样式 (契约 §2.2) ----
describe('ControlParticle 表现层样式 (契约 §2.2)', () => {
  it('borderStyle "none" → 不画方括号框 (无 `[ ]`)', () => {
    const r = render({ style: { borderStyle: 'none' } })
    expect(r.texts.some((t) => t.text === '[')).toBe(false)
    expect(r.texts.some((t) => t.text === ']')).toBe(false)
    expect(r.fillRects).toHaveLength(0)
    expect(r.strokeRects).toHaveLength(0)
  })

  it('缺省 (brackets) → 画 `[` `]` 框, 不画 fillRect/strokeRect', () => {
    const r = render()
    expect(r.texts.some((t) => t.text === '[')).toBe(true)
    expect(r.texts.some((t) => t.text === ']')).toBe(true)
    expect(r.fillRects).toHaveLength(0)
    expect(r.strokeRects).toHaveLength(0)
  })

  it('textarea + 无 borderStyle → 虚线四边框 (向后兼容)', () => {
    const r = render({ def: { controlType: 'textarea' } })
    expect(r.strokeRects).toHaveLength(1)
    expect(r.dashes).toContainEqual([2, 1])
  })

  it('textarea + borderStyle "solid" → 实线四边框 (不画虚线)', () => {
    const r = render({ style: { borderStyle: 'solid' }, def: { controlType: 'textarea' } })
    expect(r.strokeRects).toHaveLength(1)
    expect(r.dashes).not.toContainEqual([2, 1])
  })

  it('textAlign "center" → 框内文本居中 (向右偏移)', () => {
    const r = render({ style: { minWidth: 168, textAlign: 'center' } })
    const t = innerText(r, '患者姓名')!
    expect(t.x).toBeGreaterThan(6.6) // 大于左对齐的 bracket 偏移
    expect(t.x).toBeCloseTo(67.8, 1)
  })

  it('textAlign "right" → 框内文本右对齐', () => {
    const r = render({ style: { minWidth: 168, textAlign: 'right' } })
    const t = innerText(r, '患者姓名')!
    expect(t.x).toBeCloseTo(135.0, 1)
  })

  it('textAlign 缺省 → 左对齐 (仅 bracket 偏移)', () => {
    const r = render({ style: { minWidth: 168 } })
    const t = innerText(r, '患者姓名')!
    expect(t.x).toBeCloseTo(6.6, 1)
  })
})

// ---- 状态色 (颜色只表 state, 非分类) ----
describe('ControlParticle 状态色 — 占位灰 vs 值深 (非 dataType 分类)', () => {
  it('空态占位符 → 灰 (#9CA3AF)', () => {
    const r = render()
    expect(innerText(r, '患者姓名')!.fillStyle).toBe('#9CA3AF')
  })

  it('填充态值 → 深 (#374151)', () => {
    const r = render({ text: '张三', value: '张三' })
    expect(innerText(r, '张三')!.fillStyle).toBe('#374151')
  })

  it('number 0 是填充值 (非空), 显示 "0" 而非占位符', () => {
    const r = render({ text: '0', value: 0 })
    expect(innerText(r, '0')!.fillStyle).toBe('#374151')
    expect(r.texts.some((t) => t.text === '[患者姓名]' || t.text === '患者姓名')).toBe(false)
  })
})

// ---- 脱敏 (不变量 4: 掩码长度按 display 表示) ----
describe('ControlParticle 隐私脱敏 (不变量 4)', () => {
  const maskedEl: ElementMeta = {
    code: { internal: 'CTL_X', dataElement: 'DE99.99.001' },
    name: 'x',
    privacy: { enabled: true, maskChar: '*', maskRule: 'full' },
  }

  it('脱敏 → 文本替换为掩码, 方括号框红色 (#F87171)', () => {
    const r = render({ text: '[患者姓名]', value: '张三', element: maskedEl })
    expect(innerText(r, '**')!.fillStyle).toBe('#9CA3AF') // masked 文本灰
    const bracket = r.texts.find((t) => t.text === '[')!
    expect(bracket.fillStyle).toBe('#F87171')
  })

  it('masked number 掩码长度 = String(n).length (非 union .length)', () => {
    // value 12345 → String(12345).length === 5 个掩码字符
    const r = render({ text: '12345', value: 12345, element: maskedEl })
    expect(innerText(r, '*****')).toBeDefined()
    expect(r.texts.some((t) => t.text === '******')).toBe(false)
  })
})

// ---- options 拓扑 (不变量 2/3) ----
describe('ControlParticle radio/checkbox 内联选项组 (不变量 2/3)', () => {
  const enumsEl: ElementMeta = {
    code: { internal: 'CTL_X', dataElement: 'DE99.99.002' },
    name: 'x',
    format: { dataType: 'S1', enums: { data: [{ name: '高血压', value: 'H' }, { name: '糖尿病', value: 'D' }] } },
  }

  it('checkbox → 无框/无 fillRect/strokeRect, 画 glyph + 选项名', () => {
    const r = render({ def: { controlType: 'checkbox' }, element: enumsEl, value: ['H'] })
    expect(r.fillRects).toHaveLength(0)
    expect(r.strokeRects).toHaveLength(0)
    expect(r.texts.some((t) => t.text === '[')).toBe(false)
    expect(r.texts.some((t) => t.text === '高血压')).toBe(true)
    expect(r.texts.some((t) => t.text === '糖尿病')).toBe(true)
    // 选中项 glyph ☑ (蓝), 未选项 glyph ☐ (灰)
    expect(r.texts.some((t) => t.text === '☑')).toBe(true)
    expect(r.texts.some((t) => t.text === '☐')).toBe(true)
  })

  it('enums 存在但 data=[] → 「无候选项」占位, 不退化输入框', () => {
    const emptyEl: ElementMeta = {
      code: { internal: 'CTL_X', dataElement: 'DE99.99.003' },
      name: 'x',
      format: { dataType: 'S1', enums: { data: [] } },
    }
    const r = render({ def: { controlType: 'checkbox' }, element: emptyEl })
    expect(innerText(r, '无候选项')!.fillStyle).toBe('#9CA3AF')
    expect(r.texts.some((t) => t.text === '[')).toBe(false)
  })
})

// ---- affordance (select ▼ / date 日历, 不变量 7) ----
describe('ControlParticle affordance — select ▼ / date 日历 (≤12px 盒)', () => {
  it('select → 下拉三角 (path fill, 无 strokeRect 盒)', () => {
    const r = render({ def: { controlType: 'select' } })
    expect(r.pathFills).toHaveLength(1)
    expect(r.strokeRects).toHaveLength(0)
  })

  it('date → 日历 (strokeRect + 顶部小耳 path stroke)', () => {
    const r = render({ def: { controlType: 'date' } })
    expect(r.strokeRects).toHaveLength(1)
    expect(r.pathStrokes).toHaveLength(1)
  })
})

// ---- align 优先级 (不变量 8: 显式 textAlign 覆盖 recipe.align) ----
describe('ControlParticle number 右对齐 (不变量 8)', () => {
  it('number 缺省 → recipe.align right (右对齐)', () => {
    const r = render({ text: '123', value: 123, def: { controlType: 'number' }, style: { minWidth: 168 } })
    const t = innerText(r, '123')!
    expect(t.x).toBeCloseTo(141.6, 1)
  })

  it('number + 显式 textAlign "left" → 覆盖默认右对齐', () => {
    const r = render({ text: '123', value: 123, def: { controlType: 'number' }, style: { minWidth: 168, textAlign: 'left' } })
    const t = innerText(r, '123')!
    expect(t.x).toBeCloseTo(6.6, 1)
  })
})

// ---- 附属字面量 (不变量 10: label/prefix/suffix 不侵入 box) ----
describe('ControlParticle 模板设计期属性 label/prefix/suffix (不变量 10)', () => {
  it('label/prefix/suffix → 位置在框外, 顺序 label < prefix < 主文本 < suffix', () => {
    const r = render({ def: { label: '姓名：', prefix: '（', suffix: '）' }, width: 100 })
    const label = r.texts.find((t) => t.text === '姓名：')
    const prefix = r.texts.find((t) => t.text === '（')
    const suffix = r.texts.find((t) => t.text === '）')
    const main = innerText(r, '患者姓名')!
    expect(label).toBeDefined()
    expect(prefix).toBeDefined()
    expect(suffix).toBeDefined()
    expect(label!.x).toBeLessThan(prefix!.x)
    expect(prefix!.x).toBeLessThan(main.x)
    expect(suffix!.x).toBeGreaterThan(main.x)
  })

  it('无设计期属性 → 只画 `[` `]` + 主文本', () => {
    const r = render()
    const texts = r.texts.map((t) => t.text)
    expect(texts).toContain('[')
    expect(texts).toContain(']')
    expect(texts).toContain('患者姓名')
    expect(texts).toHaveLength(3)
  })
})
