// ============================================================
// ControlParticle — 表单控件/SmartText 粒子渲染器 (R2)
//
// 为 SmartTextNode 渲染带边框/背景的视觉区分
// 通过 ParticleRegistry 注册, Draw.ts 调度
// ============================================================

import type { IParticle, RenderOptions } from './IParticle'
import type { SLIFItem } from '../../layout/core/SLIF'

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

export function createControlParticle(): IParticle {
  return {
    type: 'smarttext',

    render(ctx: CanvasRenderingContext2D, item: SLIFItem, x: number, y: number, options?: RenderOptions): void {
      const value = item.text || ''
      const fontSize = item.size || 16
      const fontFamily = item.font || 'SimSun'
      const padding = 3
      const h = fontSize * 1.2

      // 表现层样式 (契约 §2.2) — draw time 按 nodeId 查询, 不写入 DocumentModel
      const style = options?.presentationStyleOf?.(item.nodeId)
      // borderStyle 'none' → 不画盒; 其余 (含缺省) → 保持画盒
      const drawBox = style?.borderStyle !== 'none'
      // 显式 'solid' 才实线, 否则保持历史虚线
      const solidBorder = style?.borderStyle === 'solid'
      // minWidth 为 number 或数字字符串 (外部模板混合)
      const rawMinW = style?.minWidth
      const minW = typeof rawMinW === 'number' ? rawMinW : (rawMinW != null ? parseFloat(String(rawMinW)) : 0)
      const minBoxWidth = Number.isFinite(minW) && minW > 0 ? minW : 0
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
      const colors = classifyControlVisual(dataType)

      // 检查隐私脱敏
      const privacy = element?.privacy
      const isMasked = privacy?.enabled === true
      const displayText = isMasked ? (privacy!.maskChar || '*').repeat(value.length) : value

      ctx.save()
      ctx.font = `${fontSize}px "${fontFamily}"`
      ctx.textBaseline = 'alphabetic'

      const textW = ctx.measureText(displayText).width
      const boxW = Math.max(textW, minBoxWidth) + padding * 2

      if (drawBox) {
        // 背景
        ctx.fillStyle = colors.bg
        ctx.fillRect(x - padding, y - fontSize * 0.8 - padding, boxW, h + padding * 2)

        // 边框
        ctx.strokeStyle = isMasked ? '#F87171' : colors.border
        ctx.lineWidth = 1
        if (!solidBorder) ctx.setLineDash([2, 1])
        ctx.strokeRect(x - padding, y - fontSize * 0.8 - padding, boxW, h + padding * 2)
        ctx.setLineDash([])
      }

      // 盒内文本 — textAlign 只偏移盒内 glyph, 不改布局 (契约 §2.2)
      const contentW = boxW - padding * 2
      let textX = x
      if (align === 'center') textX = x + (contentW - textW) / 2
      else if (align === 'right') textX = x + (contentW - textW)

      ctx.fillStyle = isMasked ? '#9CA3AF' : (item.color || '#374151')
      ctx.fillText(displayText, textX, y)

      // 附属字面量 label/prefix/suffix (契约 §12.1) — draw-time overlay, 不参与布局重排
      ctx.fillStyle = isMasked ? '#9CA3AF' : (item.color || '#374151')
      const leftEdge = x - padding
      const prefixW = prefix ? ctx.measureText(prefix).width : 0
      const labelW = label ? ctx.measureText(label).width : 0
      if (label) ctx.fillText(label, leftEdge - prefixW - labelW, y)
      if (prefix) ctx.fillText(prefix, leftEdge - prefixW, y)
      if (suffix) ctx.fillText(suffix, leftEdge + boxW, y)

      ctx.restore()
    },
  }
}
