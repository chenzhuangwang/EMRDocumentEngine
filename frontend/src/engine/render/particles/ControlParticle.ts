// ============================================================
// ControlParticle — 表单控件/SmartText 粒子渲染器 (R2)
//
// 为 SmartTextNode 渲染带边框/背景的视觉区分
// 通过 ParticleRegistry 注册, Draw.ts 调度
// ============================================================

import type { IParticle, RenderOptions } from './IParticle'
import type { SLIFItem } from '../../layout/core/SLIF'
import type { PresentationStyle } from '../presentation/PresentationStyle'

export const CONTROL_COLORS: Record<string, { bg: string; border: string }> = {
  S1: { bg: '#F0F9FF', border: '#7DD3FC' },   // 单行文本 — 浅蓝
  S2: { bg: '#F0FDF4', border: '#86EFAC' },   // 多行文本 — 浅绿
  S3: { bg: '#FEFCE8', border: '#FDE047' },   // 长文本 — 浅黄
  N:  { bg: '#FFF7ED', border: '#FDBA74' },   // 数字 — 浅橙
  D:  { bg: '#FDF2F8', border: '#F9A8D4' },   // 日期 — 浅粉
}

/** 缺省配色 (dataType 缺失/未知时) — 中性灰 */
const DEFAULT_CONTROL_COLORS = { bg: '#F9FAFB', border: '#D1D5DB' }

/**
 * 纯映射: dataType → 控件视觉配色。缺省/未知 dataType 回退中性灰,
 * 绝不假设为 S1 (契约 §12.1: dataType/showType/controlType 正交)。
 */
export function classifyControlVisual(dataType: string | undefined): { bg: string; border: string } {
  if (!dataType) return DEFAULT_CONTROL_COLORS
  return CONTROL_COLORS[dataType] ?? DEFAULT_CONTROL_COLORS
}

/** 控件视觉盒几何 (单一事实源, 契约 §12.3) — ControlParticle 渲染与 Draw.renderDesignSelection 共用。
 *
 * 约定: lineTop 是「行顶」(line-top), 与 TextParticle / caret 同源 — 不是基线。
 *   - 盒顶   = lineTop - padding
 *   - 基线   = lineTop + ascent
 *   - 盒高   = (ascent + descent) + 2*padding  (与行高 + 上下 padding 对齐)
 *
 * 历史 bug: ControlParticle 曾把 lineTop (item.y) 当基线, 盒顶 = lineTop - size*0.8 - padding,
 * 导致控件盒/文本整体上移约 ascent, 与选中框 (renderDesignSelection) 和光标错位。
 * 现统一由本函数产出几何, 杜绝两处各算各的漂移。
 */
export function computeControlBox(
  lineLeft: number,
  lineTop: number,
  textWidth: number,
  ascent: number,
  descent: number,
  style?: PresentationStyle,
): { x: number; y: number; w: number; h: number; baselineY: number; contentW: number; leftEdge: number; rightEdge: number } {
  const padding = 3
  const rawMinW = style?.minWidth
  const minW = typeof rawMinW === 'number' ? rawMinW : (rawMinW != null ? parseFloat(String(rawMinW)) : 0)
  const minBoxWidth = Number.isFinite(minW) && minW > 0 ? minW : 0
  const boxW = Math.max(textWidth, minBoxWidth) + padding * 2
  const leftEdge = lineLeft - padding
  return {
    x: leftEdge,
    y: lineTop - padding,
    w: boxW,
    h: (ascent + descent) + padding * 2,
    baselineY: lineTop + ascent,
    contentW: boxW - padding * 2,
    leftEdge,
    rightEdge: leftEdge + boxW,
  }
}

export function createControlParticle(): IParticle {
  return {
    type: 'smarttext',

    render(ctx: CanvasRenderingContext2D, item: SLIFItem, x: number, y: number, options?: RenderOptions): void {
      const value = item.text || ''
      const fontSize = item.size || 16
      const fontFamily = item.font || 'SimSun'

      // 行级 ascent/descent (item.ascent/descent) 与 TextParticle/caret 同源;
      // 0 时回退 fontSize 估算。y 是「行顶」(line-top), 不是基线 — 见 computeControlBox。
      const ascent = item.ascent > 0 ? item.ascent : fontSize * 0.8
      const descent = item.descent > 0 ? item.descent : fontSize * 0.2

      // 表现层样式 (契约 §2.2) — draw time 按 nodeId 查询, 不写入 DocumentModel
      const style = options?.presentationStyleOf?.(item.nodeId)
      // borderStyle 'none' → 不画盒; 其余 (含缺省) → 保持画盒
      const drawBox = style?.borderStyle !== 'none'
      // 显式 'solid' 才实线, 否则保持历史虚线
      const solidBorder = style?.borderStyle === 'solid'
      // textAlign 盒内水平对齐 (契约 §2.2) — 仅当盒宽 > 文本宽时生效
      const align = style?.textAlign

      // 模板设计期属性 (契约 §12.1) — draw time 按 nodeId 查询, 附属字面量
      const def = options?.templateDefinitionOf?.(item.nodeId)
      const label = typeof def?.label === 'string' ? def.label : ''
      const prefix = typeof def?.prefix === 'string' ? def.prefix : ''
      const suffix = typeof def?.suffix === 'string' ? def.suffix : ''

      // 语义元数据 (契约 §2.1) — draw time 按 nodeId 查询 dataType 与隐私标记
      const element = options?.elementOf?.(item.nodeId)
      const dataType = element?.format?.dataType
      const showType = element?.format?.showType
      const colors = classifyControlVisual(dataType)

      // 检查隐私脱敏
      const privacy = element?.privacy
      const isMasked = privacy?.enabled === true
      const displayText = isMasked ? (privacy!.maskChar || '*').repeat(value.length) : value

      ctx.save()
      ctx.font = `${fontSize}px "${fontFamily}"`
      ctx.textBaseline = 'alphabetic'

      const textW = ctx.measureText(displayText).width
      const box = computeControlBox(x, y, textW, ascent, descent, style)

      if (drawBox) {
        // 背景
        ctx.fillStyle = colors.bg
        ctx.fillRect(box.x, box.y, box.w, box.h)

        // 边框
        ctx.strokeStyle = isMasked ? '#F87171' : colors.border
        ctx.lineWidth = 1
        if (!solidBorder) ctx.setLineDash([2, 1])
        ctx.strokeRect(box.x, box.y, box.w, box.h)
        ctx.setLineDash([])
      }

      // 盒内文本 — textAlign 只偏移盒内 glyph, 不改布局 (契约 §2.2)
      // 显式 textAlign 覆盖 showType 缺省; showType 'N' 仅提供数值右对齐的默认形态 (契约 §12.6.2 layer D)
      let textX = x
      if (align === 'center') textX = x + (box.contentW - textW) / 2
      else if (align === 'right' || (align === undefined && showType === 'N')) textX = x + (box.contentW - textW)

      ctx.fillStyle = isMasked ? '#9CA3AF' : (item.color || '#374151')
      ctx.fillText(displayText, textX, box.baselineY)

      // 附属字面量 label/prefix/suffix (契约 §12.1) — draw-time overlay, 不参与布局重排
      ctx.fillStyle = isMasked ? '#9CA3AF' : (item.color || '#374151')
      const prefixW = prefix ? ctx.measureText(prefix).width : 0
      const labelW = label ? ctx.measureText(label).width : 0
      if (label) ctx.fillText(label, box.leftEdge - prefixW - labelW, box.baselineY)
      if (prefix) ctx.fillText(prefix, box.leftEdge - prefixW, box.baselineY)
      if (suffix) ctx.fillText(suffix, box.rightEdge, box.baselineY)

      ctx.restore()
    },
  }
}
