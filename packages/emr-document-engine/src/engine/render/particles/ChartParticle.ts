// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ChartParticle — 图表粒子渲染器 (R62, v6.0)
//
// 纯 Canvas 2D 柱状图/折线图/饼图
// 数据通过 item.text (JSON format) 传入
// ============================================================

import type { IParticle, RenderOptions } from './IParticle'
import type { SLIFItem } from '../../layout/core/SLIF'

// ---- 图表数据格式 ----

interface ChartData {
  type: 'bar' | 'line' | 'pie' | 'radar' | 'scatter' | 'area'
  labels: string[]
  values: number[]
  /** 散点图专用: [x,y][] 数据 */
  points?: [number, number][]
  /** 雷达图: 多系列 values 为二维数组 */
  series?: { name: string; values: number[] }[]
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
        case 'radar': drawRadarChart(ctx, data, x, y, chartW, chartH, colors); break
        case 'scatter': drawScatterChart(ctx, data, x, y, chartW, chartH, colors); break
        case 'area': drawAreaChart(ctx, data, x, y, chartW, chartH, colors); break
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

// ---- 雷达图 ----

function drawRadarChart(
  ctx: CanvasRenderingContext2D, data: ChartData,
  x: number, y: number, w: number, h: number, colors: string[],
): void {
  const cx = x + w / 2; const cy = y + h / 2 + 8
  const radius = Math.min(w, h) / 2 - 30
  const axes = data.labels.length
  if (axes < 3) return
  const maxVal = Math.max(...data.values, 1)

  // 背景网格 (同心多边形)
  for (let level = 1; level <= 4; level++) {
    const r = (radius * level) / 4
    ctx.beginPath()
    for (let i = 0; i < axes; i++) {
      const angle = (Math.PI * 2 * i) / axes - Math.PI / 2
      const px = cx + Math.cos(angle) * r; const py = cy + Math.sin(angle) * r
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.strokeStyle = '#E5E7EB'; ctx.lineWidth = 0.5; ctx.stroke()
  }

  // 轴线
  for (let i = 0; i < axes; i++) {
    const angle = (Math.PI * 2 * i) / axes - Math.PI / 2
    ctx.beginPath(); ctx.moveTo(cx, cy)
    ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius)
    ctx.strokeStyle = '#D1D5DB'; ctx.lineWidth = 0.5; ctx.stroke()
    // 标签
    const lx = cx + Math.cos(angle) * (radius + 16); const ly = cy + Math.sin(angle) * (radius + 16)
    ctx.fillStyle = '#6B7280'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(data.labels[i], lx, ly + 4)
  }

  // 数据多边形
  ctx.beginPath()
  for (let i = 0; i < axes; i++) {
    const angle = (Math.PI * 2 * i) / axes - Math.PI / 2
    const r = (data.values[i] / maxVal) * radius
    const px = cx + Math.cos(angle) * r; const py = cy + Math.sin(angle) * r
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fillStyle = colors[0] + '33'; ctx.fill()
  ctx.strokeStyle = colors[0]; ctx.lineWidth = 2; ctx.stroke()

  // 数据点
  for (let i = 0; i < axes; i++) {
    const angle = (Math.PI * 2 * i) / axes - Math.PI / 2
    const r = (data.values[i] / maxVal) * radius
    ctx.beginPath(); ctx.arc(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, 3, 0, Math.PI * 2)
    ctx.fillStyle = colors[0]; ctx.fill()
  }
}

// ---- 散点图 ----

function drawScatterChart(
  ctx: CanvasRenderingContext2D, data: ChartData,
  x: number, y: number, w: number, h: number, colors: string[],
): void {
  const top = y + 24; const bottom = y + h - 24
  const areaH = bottom - top
  const pts = data.points || data.values.map((v, i) => [i, v] as [number, number])
  if (pts.length === 0) return
  const maxX = Math.max(...pts.map(p => p[0]), 1)
  const maxY = Math.max(...pts.map(p => p[1]), 1)

  // 网格
  ctx.strokeStyle = '#E5E7EB'; ctx.lineWidth = 0.5
  for (let i = 0; i <= 4; i++) {
    const gy = top + (areaH * i) / 4
    ctx.beginPath(); ctx.moveTo(x + 10, gy); ctx.lineTo(x + w - 10, gy); ctx.stroke()
  }

  // 数据点
  for (const [px, py] of pts) {
    const sx = x + 10 + (px / maxX) * (w - 20)
    const sy = bottom - (py / maxY) * areaH
    ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2)
    ctx.fillStyle = colors[0] + 'CC'; ctx.fill()
    ctx.strokeStyle = colors[0]; ctx.lineWidth = 1; ctx.stroke()
  }

  // 轴标签
  ctx.fillStyle = '#6B7280'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center'
  ctx.fillText(`0`, x + 10, bottom + 14)
  ctx.fillText(`${maxX}`, x + w - 10, bottom + 14)
}

// ---- 面积图 ----

function drawAreaChart(
  ctx: CanvasRenderingContext2D, data: ChartData,
  x: number, y: number, w: number, h: number, colors: string[],
): void {
  const top = y + 24; const bottom = y + h - 24
  const areaH = bottom - top
  const count = data.values.length
  const maxVal = Math.max(...data.values, 1)
  const stepX = (w - 20) / Math.max(count - 1, 1)

  const pts: { px: number; py: number }[] = []
  for (let i = 0; i < count; i++) {
    pts.push({ px: x + 10 + i * stepX, py: bottom - (data.values[i] / maxVal) * areaH })
  }

  // 填充区域
  ctx.beginPath()
  ctx.moveTo(pts[0].px, bottom)
  for (const pt of pts) ctx.lineTo(pt.px, pt.py)
  ctx.lineTo(pts[pts.length - 1].px, bottom)
  ctx.closePath()
  ctx.fillStyle = colors[0] + '22'; ctx.fill()

  // 折线
  ctx.beginPath(); ctx.moveTo(pts[0].px, pts[0].py)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].px, pts[i].py)
  ctx.strokeStyle = colors[0]; ctx.lineWidth = 2; ctx.stroke()

  // 数据点
  for (const pt of pts) {
    ctx.beginPath(); ctx.arc(pt.px, pt.py, 3, 0, Math.PI * 2)
    ctx.fillStyle = colors[0]; ctx.fill()
  }

  // 标签
  ctx.fillStyle = '#6B7280'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center'
  for (let i = 0; i < count; i++) {
    if (data.labels[i]) ctx.fillText(data.labels[i], pts[i].px, bottom + 14)
    ctx.fillText(String(data.values[i]), pts[i].px, pts[i].py - 8)
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
