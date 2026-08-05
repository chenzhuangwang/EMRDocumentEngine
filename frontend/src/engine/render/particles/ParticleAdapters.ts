// ============================================================
// ParticleAdapters — 现有静态 Particle 的 IParticle 适配器 (R30, v6.0)
//
// 将 TextParticle / SeparatorParticle / ListParticle 的静态方法
// 包装为 IParticle 实例, 供 ParticleRegistry 调度使用
// ============================================================

import type { IParticle, RenderOptions } from './IParticle'
import type { SLIFItem } from '../../layout/SLIF'
import { TextParticle } from './TextParticle'
import { SeparatorParticle } from './SeparatorParticle'

/** 文本粒子适配器 — 将 TextParticle.render 桥接到 IParticle */
export const textParticle: IParticle = {
  type: 'text',
  render(ctx: CanvasRenderingContext2D, item: SLIFItem, x: number, y: number, options?: RenderOptions): void {
    TextParticle.render(ctx, {
      id: item.nodeId,
      type: item.type,
      value: item.text || '',
      font: item.font,
      size: item.size,
      bold: item.bold,
      italic: item.italic,
      color: item.color,
      underline: item.underline,
      strikeout: item.strikeout,
      superscript: item.superscript,
      subscript: item.subscript,
      highlight: item.highlight,
    }, x, y, {
      defaultColor: options?.defaultColor,
      defaultFont: options?.defaultFont,
      defaultSize: options?.defaultSize,
      showInvisible: options?.showInvisible,
    })
  },
}

/** 分隔线粒子适配器 */
export const separatorParticle: IParticle = {
  type: 'separator',
  render(ctx: CanvasRenderingContext2D, item: SLIFItem, x: number, y: number, options?: RenderOptions): void {
    SeparatorParticle.render(ctx, {
      id: item.nodeId,
      type: item.type as 'separator',
      lineStyle: undefined, // SLIFItem doesn't carry lineStyle yet; use defaults
      color: item.color,
      widthMode: 'full',
    }, x, y, options?.contentWidth ?? 614, {  // 614 = default A4 content width
      defaultColor: options?.defaultColor,
    })
  },
}

/** 域代码粒子 — 复用 TextParticle */
export const fieldParticle: IParticle = {
  type: 'field',
  render(ctx: CanvasRenderingContext2D, item: SLIFItem, x: number, y: number, options?: RenderOptions): void {
    TextParticle.render(ctx, {
      id: item.nodeId,
      type: item.type,
      value: item.text || '',
      font: item.font,
      size: item.size,
      bold: item.bold,
      italic: item.italic,
      color: item.color,
      underline: item.underline,
      strikeout: item.strikeout,
      superscript: item.superscript,
      subscript: item.subscript,
      highlight: item.highlight,
    }, x, y, {
      defaultColor: options?.defaultColor,
      defaultFont: options?.defaultFont,
      defaultSize: options?.defaultSize,
      showInvisible: options?.showInvisible,
    })
  },
}
