// ============================================================
// ChartParticle — 图表粒子渲染器 (R62, v6.0)
//
// 纯 Canvas 2D 柱状图/折线图/饼图
// 数据通过 item.text (JSON format) 传入
// ============================================================

import type { IParticle, RenderOptions } from './IParticle'
import type { SLIFItem } from '../../layout/SLIF'

// ---- 图表数据格式 ----

interface ChartData {
  type: 'bar' | 'line' | 'pie'
  labels: string[]
  values: number[]
  colors?: string[]
  title?: string
}

const DEFAULT_COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B',
  '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16',
]

function parseChartData(item: SLIFItem): ChartData | null {
  try {
    if (item.text) return JSON.parse(item.text) as ChartData
  } catch { /* ignore */ }
  return null
}

export function createChartParticle(): IParticle {
  return {
    type: 'chart',

    render(ctx: CanvasRenderingContext2D, item: SLIFItem, x: number, y: number, _options?: RenderOptions): void {
      const data = parseChartData(item)
      if (!data || data.values.length === 0) {
        drawPlaceholder(ctx, x, y, item.width, item.height || 200)
        return
      }

      const chartW = item.width || 400
      const chartH = item.height || 200
      const colors = data.colors || DEFAULT_COLORS

      ctx.save()

      // 标题
      if (data.title) {
        ctx.font = 'bold 12px sans-serif'
        ctx.fillStyle = '#374151'
        ctx.textAlign = 'center'
        ctx.fillText(data.title, x + chartW / 2, y + 14)
      }

      switch (data.type) {
        case 'bar': drawBarChart(ctx, data, x, y, chartW, chartH, colors); break
        case 'line': drawLineChart(ctx, data, x, y, chartW, chartH, colors); break
        case 'pie': drawPieChart(ctx, data, x, y, chartW, chartH, colors); break
      }

      ctx.restore()
    },
  }
}

// ---- 柱状图 ----

function drawBarChart(
  ctx: CanvasRenderingContext2D, data: ChartData,
  x: number, y: number, w: number, h: number, colors: string[],
): void {
  const top = y + 24
  const bottom = y + h - 24
  const barAreaH = bottom - top
  const barCount = data.values.length
  const barW = Math.max(4, (w - 20) / barCount - 8)
  const maxVal = Math.max(...data.values, 1)

  // Y 轴参考线
  ctx.strokeStyle = '#E5E7EB'
  ctx.lineWidth = 0.5
  for (let i = 0; i <= 4; i++) {
    const ly = top + (barAreaH * i) / 4
    ctx.beginPath()
    ctx.moveTo(x + 10, ly)
    ctx.lineTo(x + w - 10, ly)
    ctx.stroke()
  }

  // 柱状条
  for (let i = 0; i < barCount; i++) {
    const barX = x + 10 + i * ((w - 20) / barCount) + 4
    const barH = (data.values[i] / maxVal) * barAreaH
    const barY = bottom - barH

    ctx.fillStyle = colors[i % colors.length]
    ctx.fillRect(barX, barY, barW, barH)

    // 数值标签
    ctx.fillStyle = '#6B7280'
    ctx.font = '9px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(String(data.values[i]), barX + barW / 2, barY - 4)

    // X 轴标签
    if (data.labels[i]) {
      ctx.fillText(data.labels[i], barX + barW / 2, bottom + 14)
    }
  }
}

// ---- 折线图 ----

function drawLineChart(
  ctx: CanvasRenderingContext2D, data: ChartData,
  x: number, y: number, w: number, h: number, colors: string[],
): void {
  const top = y + 24
  const bottom = y + h - 24
  const areaH = bottom - top
  const count = data.values.length
  const maxVal = Math.max(...data.values, 1)
  const stepX = (w - 20) / Math.max(count - 1, 1)

  const points: { px: number; py: number }[] = []

  for (let i = 0; i < count; i++) {
    const px = x + 10 + i * stepX
    const py = bottom - (data.values[i] / maxVal) * areaH
    points.push({ px, py })
  }

  // 网格线
  ctx.strokeStyle = '#E5E7EB'; ctx.lineWidth = 0.5
  for (let i = 0; i <= 4; i++) {
    const ly = top + (areaH * i) / 4
    ctx.beginPath(); ctx.moveTo(x + 10, ly); ctx.lineTo(x + w - 10, ly); ctx.stroke()
  }

  // 折线 + 填色
  ctx.beginPath()
  ctx.moveTo(points[0].px, points[0].py)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].px, points[i].py)
  ctx.strokeStyle = colors[0]
  ctx.lineWidth = 2
  ctx.stroke()

  // 数据点
  for (const pt of points) {
    ctx.beginPath()
    ctx.arc(pt.px, pt.py, 3, 0, Math.PI * 2)
    ctx.fillStyle = colors[0]
    ctx.fill()
  }

  // 数值标签
  ctx.fillStyle = '#6B7280'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center'
  for (let i = 0; i < count; i++) {
    ctx.fillText(String(data.values[i]), points[i].px, points[i].py - 8)
    if (data.labels[i]) ctx.fillText(data.labels[i], points[i].px, bottom + 14)
  }
}

// ---- 饼图 ----

function drawPieChart(
  ctx: CanvasRenderingContext2D, data: ChartData,
  x: number, y: number, w: number, h: number, colors: string[],
): void {
  const cx = x + w / 2
  const cy = y + h / 2 + 8
  const radius = Math.min(w, h) / 2 - 30
  const total = data.values.reduce((a, b) => a + b, 0) || 1

  let startAngle = -Math.PI / 2

  for (let i = 0; i < data.values.length; i++) {
    const slice = (data.values[i] / total) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, radius, startAngle, startAngle + slice)
    ctx.closePath()
    ctx.fillStyle = colors[i % colors.length]
    ctx.fill()
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 1.5
    ctx.stroke()
    startAngle += slice
  }

  // 图例
  ctx.font = '10px sans-serif'
  let legendY = y + h - data.values.length * 16
  for (let i = 0; i < data.values.length; i++) {
    ctx.fillStyle = colors[i % colors.length]
    ctx.fillRect(x + 10, legendY, 10, 10)
    ctx.fillStyle = '#374151'
    ctx.textAlign = 'left'
    const label = data.labels[i] || `Series ${i + 1}`
    const pct = Math.round((data.values[i] / total) * 100)
    ctx.fillText(`${label} (${pct}%)`, x + 24, legendY + 9)
    legendY += 16
  }
}

// ---- 占位 ----

function drawPlaceholder(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.save()
  ctx.fillStyle = '#F9FAFB'
  ctx.fillRect(x, y, w, h || 200)
  ctx.strokeStyle = '#D1D5DB'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 2])
  ctx.strokeRect(x, y, w, h || 200)
  ctx.setLineDash([])
  ctx.fillStyle = '#9CA3AF'
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Chart (no data)', x + w / 2, y + (h || 200) / 2)
  ctx.restore()
}
