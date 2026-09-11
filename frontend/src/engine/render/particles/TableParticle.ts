// ============================================================
// TableParticle — 表格粒子渲染器 (R37, v6.0)
//
// 将 SLIFItem.rows 渲染为 Canvas 表格网格
// 实现 IParticle 接口, 通过 ParticleRegistry 调度
// ============================================================

import type { IParticle, RenderOptions } from './IParticle'
import type { SLIFItem } from '../../layout/core/SLIF'
import { particleRegistry } from './ParticleRegistry'

const BORDER_COLOR = '#9CA3AF'
const HEADER_BG = '#F3F4F6'
const CELL_PADDING = 6
const MIN_CELL_WIDTH = 40
const MIN_ROW_HEIGHT = 24

export function createTableParticle(): IParticle {
  return {
    type: 'table',

    render(ctx: CanvasRenderingContext2D, item: SLIFItem, x: number, y: number, options?: RenderOptions): void {
      const rows = item.rows
      if (!rows || rows.length === 0) return

      // R65: 续表标记
      if (item.continuationLabel) {
        ctx.save()
        ctx.font = 'italic 11px "SimSun"'
        ctx.fillStyle = '#6B7280'
        ctx.fillText(item.continuationLabel, x, y + 12)
        ctx.restore()
        y += 20 // 续表标记占位
      }

      let rowY = y

      for (const row of rows) {
        const rowHeight = Math.max(row.height || MIN_ROW_HEIGHT, MIN_ROW_HEIGHT)

        for (const cell of row.cells) {
          // 使用 SLIFCell 已算好的合并宽度/高度/起始 x (含 colspan/rowspan, v21.0 Phase 2)
          const cw = cell.width || MIN_CELL_WIDTH
          const ch = cell.height || rowHeight
          const cellX = x + (cell.x || 0)
          const cellY = rowY

          // 背景
          ctx.save()
          if (cell.isHeader) {
            ctx.fillStyle = HEADER_BG
            ctx.fillRect(cellX, cellY, cw, ch)
          } else if (cell.backgroundColor) {
            ctx.fillStyle = cell.backgroundColor
            ctx.fillRect(cellX, cellY, cw, ch)
          }

          // 边框
          ctx.strokeStyle = BORDER_COLOR
          ctx.lineWidth = 0.5
          ctx.strokeRect(cellX + 0.25, cellY + 0.25, cw - 0.5, ch - 0.5)

          // 单元格内容 (渲染 cell.items 中的文本, 按行内 x / 行 y 定位)
          if (cell.items && cell.items.length > 0) {
            // 裁剪区域
            ctx.beginPath()
            ctx.rect(cellX + CELL_PADDING, cellY + 2, cw - CELL_PADDING * 2, ch - 4)
            ctx.clip()

            for (const ci2 of cell.items) {
              // 表格 cell 内 smarttext → 委托 ControlParticle (契约 §4)
              // 否则此处直接 fillText 会丢失控制盒 + 表现层/设计期样式 (§2.2/§12.1)
              if (ci2.nodeType === 'smarttext') {
                const cp = particleRegistry.get('smarttext')
                if (cp) {
                  // ControlParticle 现把 y 当「行顶」(line-top), 自行加 ascent 求基线 —
                  // 与正文/页眉页脚一致 (契约 §4)。旧版在此预加 ascent 会双加, 造成偏移。
                  cp.render(ctx, ci2, cellX + CELL_PADDING + (ci2.x || 0), cellY + (ci2.y || 0), options)
                  continue
                }
              }
              if (!ci2.text) continue
              const font = ci2.font || 'SimSun'
              const size = ci2.size || 16
              ctx.font = `${ci2.bold ? 'bold ' : ''}${size}px "${font}"`
              ctx.fillStyle = ci2.color || '#1F2937'
              ctx.textBaseline = 'alphabetic'
              // ci2.y 为行顶 (cell 局部坐标), ascent 为基线相对行顶的偏移
              const baselineY = cellY + (ci2.y || 0) + (ci2.ascent ?? size * 0.8)
              ctx.fillText(ci2.text, cellX + CELL_PADDING + (ci2.x || 0), baselineY)
            }
          }

          ctx.restore()
        }

        rowY += rowHeight + 1  // 1px row gap
      }
    },
  }
}
