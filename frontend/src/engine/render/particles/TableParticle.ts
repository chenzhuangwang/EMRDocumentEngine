// ============================================================
// TableParticle — 表格粒子渲染器 (R37, v6.0)
//
// 将 SLIFItem.rows 渲染为 Canvas 表格网格
// 实现 IParticle 接口, 通过 ParticleRegistry 调度
// ============================================================

import type { IParticle, RenderOptions } from './IParticle'
import type { SLIFItem, SLIFRow } from '../../layout/SLIF'

const BORDER_COLOR = '#9CA3AF'
const HEADER_BG = '#F3F4F6'
const CELL_PADDING = 6
const MIN_CELL_WIDTH = 40
const MIN_ROW_HEIGHT = 24

export function createTableParticle(): IParticle {
  return {
    type: 'table',

    render(ctx: CanvasRenderingContext2D, item: SLIFItem, x: number, y: number, _options?: RenderOptions): void {
      const rows = item.rows
      if (!rows || rows.length === 0) return

      // 计算列宽: 平均分配
      const maxCols = Math.max(...rows.map(r => r.cells.length))
      const colWidths = calculateColumnWidths(item.width, maxCols, rows)

      let rowY = y

      for (const row of rows) {
        const rowHeight = Math.max(row.height || MIN_ROW_HEIGHT, MIN_ROW_HEIGHT)
        let cellX = x

        for (let ci = 0; ci < row.cells.length; ci++) {
          const cell = row.cells[ci]
          const cw = colWidths[ci] || MIN_CELL_WIDTH

          // 背景
          ctx.save()
          if (cell.isHeader) {
            ctx.fillStyle = HEADER_BG
            ctx.fillRect(cellX, rowY, cw, rowHeight)
          } else if (cell.backgroundColor) {
            ctx.fillStyle = cell.backgroundColor
            ctx.fillRect(cellX, rowY, cw, rowHeight)
          }

          // 边框
          ctx.strokeStyle = BORDER_COLOR
          ctx.lineWidth = 0.5
          ctx.strokeRect(cellX + 0.25, rowY + 0.25, cw - 0.5, rowHeight - 0.5)

          // 单元格内容 (渲染 cell.items 中的文本)
          if (cell.items && cell.items.length > 0) {
            // 裁剪区域
            ctx.beginPath()
            ctx.rect(cellX + CELL_PADDING, rowY + 2, cw - CELL_PADDING * 2, rowHeight - 4)
            ctx.clip()

            for (const ci2 of cell.items) {
              if (ci2.text) {
                const font = ci2.font || 'SimSun'
                const size = ci2.size || 12
                ctx.font = `${ci2.bold ? 'bold ' : ''}${size}px "${font}"`
                ctx.fillStyle = ci2.color || '#1F2937'
                ctx.textBaseline = 'middle'
                ctx.fillText(ci2.text, cellX + CELL_PADDING, rowY + rowHeight / 2)
              }
            }
          }

          ctx.restore()
          cellX += cw
        }

        rowY += rowHeight + 1  // 1px row gap
      }
    },
  }
}

/** 计算列宽: 平均分配内容宽度 */
function calculateColumnWidths(
  totalWidth: number,
  numCols: number,
  _rows: SLIFRow[],
): number[] {
  if (numCols === 0) return []

  // 简单均分
  const width = Math.max(Math.floor(totalWidth / numCols), MIN_CELL_WIDTH)
  return Array.from({ length: numCols }, () => width)
}
