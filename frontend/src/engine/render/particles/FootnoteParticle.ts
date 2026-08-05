// ============================================================
// FootnoteParticle — 脚注引用渲染器 (R31, v6.0)
//
// 在正文中渲染脚注引用编号 (上标样式: ¹²³...)
// 实现 IParticle 接口, 通过 ParticleRegistry 调度
// ============================================================

import type { IParticle, RenderOptions } from './IParticle'
import type { SLIFItem } from '../../layout/SLIF'

export function createFootnoteParticle(): IParticle {
  return {
    type: 'footnote',

    render(ctx: CanvasRenderingContext2D, item: SLIFItem, x: number, y: number, options?: RenderOptions): void {
      const fontSize = (item.size || options?.defaultSize || 12) * 0.75  // 上标字号缩小
      const fontFamily = item.font || options?.defaultFont || 'SimSun'
      const color = item.color || options?.defaultColor || '#2563EB'  // 蓝色引用

      ctx.save()
      ctx.font = `${fontSize}px "${fontFamily}"`
      ctx.fillStyle = color
      // 上标: 基线向上偏移
      const textY = y + fontSize * 0.3
      ctx.fillText(item.text || '?', x, textY)
      ctx.restore()
    },
  }
}
