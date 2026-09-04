// ============================================================
// ControlParticle 表现层/设计期样式消费 (契约 §2.2/§12.1, P0+P1)
//
// 验证 draw time 按 nodeId 读取:
//   表现层 (PresentationStyle, §2.2):
//     - borderStyle 'none' → 不画盒 (无背景/边框)
//     - borderStyle 'solid' → 实线 (不再画历史虚线)
//     - minWidth (number / 数字字符串) → 盒宽下限
//     - textAlign (center/right) → 盒内水平偏移
//     - 无样式 → 保持历史虚线盒 (向后兼容)
//   设计期 (TemplateDefinition, §12.1):
//     - label/prefix/suffix → 控件旁附属字面量
// ============================================================

import { describe, it, expect } from 'vitest'
import { createControlParticle, classifyControlVisual, CONTROL_COLORS } from '../render/particles/ControlParticle'
import type { SLIFItem } from '../layout/core/SLIF'
import type { PresentationStyle } from '../render/presentation/PresentationStyle'
import type { TemplateDefinition } from '../template/TemplateDefinition'
import type { ElementMeta } from '../document/core/DocumentModel'

function makeItem(): SLIFItem {
  return {
    nodeId: 'st-1', nodeType: 'smarttext', type: 'smarttext',
    text: '[患者姓名]', x: 0, y: 100,
    width: 0, height: 0, ascent: 0, descent: 0,
    font: 'SimSun', size: 12,
  }
}

interface RectCall { x: number; y: number; w: number; h: number }
interface TextCall { text: string; x: number; y: number }

function makeRecordingCtx() {
  const state = { font: '' }
  const fillRects: RectCall[] = []
  const strokeRects: RectCall[] = []
  const dashes: number[][] = []
  const texts: TextCall[] = []
  const fillStyles: string[] = []
  const strokeStyles: string[] = []
  const ctx = {
    get font() { return state.font },
    set font(v: string) { state.font = v },
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    measureText(text: string) {
      return { width: text.length * 12 * 0.55 } as TextMetrics
    },
    fillRect(x: number, y: number, w: number, h: number) {
      fillRects.push({ x, y, w, h }); fillStyles.push(ctx.fillStyle as string)
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      strokeRects.push({ x, y, w, h }); strokeStyles.push(ctx.strokeStyle as string)
    },
    setLineDash(d: number[]) { dashes.push(d) },
    fillText(text: string, x: number, y: number) { texts.push({ text, x, y }) },
    save() {}, restore() {},
  } as unknown as CanvasRenderingContext2D
  return { ctx, fillRects, strokeRects, dashes, texts, fillStyles, strokeStyles }
}

function render(style?: PresentationStyle, def?: TemplateDefinition, element?: ElementMeta) {
  const rec = makeRecordingCtx()
  const particle = createControlParticle()
  particle.render(rec.ctx, makeItem(), 0, 100, {
    presentationStyleOf: (id) => (id === 'st-1' ? style : undefined),
    templateDefinitionOf: (id) => (id === 'st-1' ? def : undefined),
    elementOf: (id) => (id === 'st-1' ? element : undefined),
  })
  return rec
}

const mainText = (rec: ReturnType<typeof render>) =>
  rec.texts.find((t) => t.text === '[患者姓名]')

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

  it('textAlign "center" → 文本在盒内居中 (x 向右偏移)', () => {
    const r = render({ minWidth: 168, textAlign: 'center' })
    const t = mainText(r)!
    // 文本宽 39.6, 内容区 168 → 居中偏移 (168-39.6)/2 = 64.2
    expect(t.x).toBeGreaterThan(0)
    expect(t.x).toBeCloseTo(64.2, 1)
  })

  it('textAlign "right" → 文本在盒内右对齐', () => {
    const r = render({ minWidth: 168, textAlign: 'right' })
    const t = mainText(r)!
    expect(t.x).toBeCloseTo(128.4, 1)
  })

  it('textAlign 缺省 → 文本保持左对齐 (x 不偏移)', () => {
    const r = render({ minWidth: 168 })
    const t = mainText(r)!
    expect(t.x).toBe(0)
  })
})

describe('ControlParticle 模板设计期属性 (契约 §12.1)', () => {
  it('label/prefix/suffix → 控件旁附属字面量, 位置正确', () => {
    const r = render(undefined, { label: '姓名：', prefix: '（', suffix: '）' })
    const label = r.texts.find((t) => t.text === '姓名：')
    const prefix = r.texts.find((t) => t.text === '（')
    const suffix = r.texts.find((t) => t.text === '）')
    const main = mainText(r)!
    expect(label).toBeDefined()
    expect(prefix).toBeDefined()
    expect(suffix).toBeDefined()
    // 视觉顺序: label < prefix < 主文本 < suffix
    expect(label!.x).toBeLessThan(prefix!.x)
    expect(prefix!.x).toBeLessThan(main.x)
    expect(suffix!.x).toBeGreaterThan(main.x)
  })

  it('无设计期属性 → 不绘制附属字面量', () => {
    const r = render(undefined, undefined)
    expect(r.texts.map((t) => t.text)).toEqual(['[患者姓名]'])
  })
})

describe('classifyControlVisual — dataType → 配色纯映射 (契约 §12.1)', () => {
  it('S2 → S2 配色 (非 S1)', () => {
    expect(classifyControlVisual('S2')).toEqual(CONTROL_COLORS.S2)
  })

  it('N → N 配色', () => {
    expect(classifyControlVisual('N')).toEqual(CONTROL_COLORS.N)
  })

  it('D → D 配色', () => {
    expect(classifyControlVisual('D')).toEqual(CONTROL_COLORS.D)
  })

  it('缺失 dataType → 中性灰 (不假设为 S1)', () => {
    const c = classifyControlVisual(undefined)
    expect(c).not.toEqual(CONTROL_COLORS.S1)
  })

  it('未知 dataType → 中性灰 (不假设为 S1)', () => {
    expect(classifyControlVisual('X9')).not.toEqual(CONTROL_COLORS.S1)
  })
})

describe('ControlParticle dataType 视觉分类 (契约 §12.1, P1)', () => {
  it('element.format.dataType=S2 → 盒背景/边框用 S2 配色 (不再是固定 S1)', () => {
    const el: ElementMeta = { code: { internal: 'CTL_X', dataElement: 'DE99.99.002' }, name: 'x', format: { dataType: 'S2' } }
    const r = render(undefined, undefined, el)
    expect(r.fillStyles[0]).toBe(CONTROL_COLORS.S2.bg)
    expect(r.strokeStyles[0]).toBe(CONTROL_COLORS.S2.border)
  })

  it('无 element (旧文档缺语义) → 中性灰盒, 不再误用 S1', () => {
    const r = render(undefined, undefined, undefined)
    expect(r.fillStyles[0]).not.toBe(CONTROL_COLORS.S1.bg)
    expect(r.strokeStyles[0]).not.toBe(CONTROL_COLORS.S1.border)
  })

  it('隐私脱敏: element.privacy.enabled → 文本替换为 maskChar, 边框红色', () => {
    const el: ElementMeta = {
      code: { internal: 'CTL_X', dataElement: 'DE99.99.001' },
      name: 'x',
      privacy: { enabled: true, maskChar: '*', maskRule: 'full' },
    }
    const r = render(undefined, undefined, el)
    expect(r.texts.map((t) => t.text)).toEqual(['******'])
    expect(r.strokeStyles[0]).toBe('#F87171')
  })
})
