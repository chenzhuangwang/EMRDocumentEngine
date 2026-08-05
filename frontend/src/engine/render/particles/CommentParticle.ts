// ============================================================
// CommentParticle — 批注标记渲染器 (R32, v6.0)
//
// 在文档正文中渲染批注标记 (淡黄高亮背景 + 边距批注图标)
// 实现 IParticle 接口
// ============================================================

import type { IParticle, RenderOptions } from './IParticle'
import type { SLIFItem } from '../../layout/SLIF'

/** 批注高亮颜色 */
const COMMENT_HIGHLIGHT = 'rgba(255, 230, 100, 0.45)'
/** 批注图标颜色 */
const COMMENT_ICON_COLOR = '#D97706'

export function createCommentParticle(): IParticle {
  return {
    type: 'comment',

    render(ctx: CanvasRenderingContext2D, item: SLIFItem, x: number, y: number, _options?: RenderOptions): void {
      // 绘制淡黄高亮背景 (在文本下方)
      ctx.save()
      ctx.fillStyle = COMMENT_HIGHLIGHT
      ctx.fillRect(x - 1, y - item.ascent - 1, item.width + 2, item.ascent + item.descent + 2)

      // 左侧边距绘制小批注图标标记
      ctx.fillStyle = COMMENT_ICON_COLOR
      ctx.beginPath()
      // 绘制小气泡形状
      const iconX = x - 14
      const iconY = y - item.ascent * 0.6
      const iconR = 4
      // 圆角矩形气泡
      ctx.moveTo(iconX + iconR, iconY)
      ctx.lineTo(iconX + 10 - iconR, iconY)
      ctx.arcTo(iconX + 10, iconY, iconX + 10, iconY + iconR, iconR)
      ctx.lineTo(iconX + 10, iconY + 8 - iconR)
      ctx.arcTo(iconX + 10, iconY + 8, iconX + 10 - iconR, iconY + 8, iconR)
      ctx.lineTo(iconX + 7, iconY + 8)
      // 尖角
      ctx.lineTo(iconX + 5, iconY + 11)
      ctx.lineTo(iconX + 3, iconY + 8)
      ctx.lineTo(iconX + iconR, iconY + 8)
      ctx.arcTo(iconX, iconY + 8, iconX, iconY + 8 - iconR, iconR)
      ctx.lineTo(iconX, iconY + iconR)
      ctx.arcTo(iconX, iconY, iconX + iconR, iconY, iconR)
      ctx.fill()

      ctx.restore()
    },
  }
}
