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

      // 检查隐私脱敏
      const meta = (item as { elementMeta?: { privacy?: { enabled: boolean; maskChar: string } } }).elementMeta
      const isMasked = meta?.privacy?.enabled
      const displayText = isMasked ? (meta!.privacy!.maskChar || '*').repeat(value.length) : value
      const textW = ctx.measureText(displayText).width
      const boxW = Math.max(textW, minBoxWidth) + padding * 2

      ctx.save()

      if (drawBox) {
        // 背景
        ctx.fillStyle = CONTROL_COLORS.S1.bg
        ctx.fillRect(x - padding, y - fontSize * 0.8 - padding, boxW, h + padding * 2)

        // 边框
        ctx.strokeStyle = isMasked ? '#F87171' : CONTROL_COLORS.S1.border
        ctx.lineWidth = 1
        if (!solidBorder) ctx.setLineDash([2, 1])
        ctx.strokeRect(x - padding, y - fontSize * 0.8 - padding, boxW, h + padding * 2)
        ctx.setLineDash([])
      }

      // 文本
      ctx.font = `${fontSize}px "${fontFamily}"`
      ctx.fillStyle = isMasked ? '#9CA3AF' : (item.color || '#374151')
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(displayText, x, y)

      ctx.restore()
    },
  }
}
