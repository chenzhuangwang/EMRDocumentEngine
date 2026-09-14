// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// SeparatorParticle — 分隔线粒子渲染器 (TASK-463, v5.0)
//
// 支持四种线型: solid / dashed / dotted / double
// 渲染为水平线, 由 LayoutEngine 分配整行宽度
// ============================================================

export class SeparatorParticle {
  static render(
    ctx: CanvasRenderingContext2D,
    el: {
      id: string
      type: string
      lineStyle?: 'solid' | 'dashed' | 'dotted' | 'double'
      color?: string
      widthMode?: 'full' | 'fixed'
      fixedWidth?: number
      alignment?: 'left' | 'center' | 'right'
    },
    x: number,
    y: number,
    contentWidth: number,
    options: { defaultColor?: string } = {},
  ): void {
    const lineStyle = el.lineStyle || 'solid'
    const lineColor = el.color || options.defaultColor || '#6B7280' // gray-500
    const lineY = y + 4 // 行内居中偏上

    // 计算线宽和对齐
    let lineWidth: number
    let lineX: number

    if (el.widthMode === 'fixed' && el.fixedWidth) {
      lineWidth = Math.min(el.fixedWidth, contentWidth)
      if (el.alignment === 'center') {
        lineX = x + (contentWidth - lineWidth) / 2
      } else if (el.alignment === 'right') {
        lineX = x + contentWidth - lineWidth
      } else {
        lineX = x
      }
    } else {
      lineWidth = contentWidth
      lineX = x
    }

    ctx.save()
    ctx.strokeStyle = lineColor
    ctx.lineWidth = 1

    switch (lineStyle) {
      case 'solid':
        this.drawSolidLine(ctx, lineX, lineY, lineWidth)
        break
      case 'dashed':
        this.drawDashedLine(ctx, lineX, lineY, lineWidth)
        break
      case 'dotted':
        this.drawDottedLine(ctx, lineX, lineY, lineWidth)
        break
      case 'double':
        this.drawDoubleLine(ctx, lineX, lineY, lineWidth)
        break
    }

    ctx.restore()
  }

  private static drawSolidLine(ctx: CanvasRenderingContext2D, x: number, y: number, width: number): void {
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + width, y)
    ctx.stroke()
  }

  private static drawDashedLine(ctx: CanvasRenderingContext2D, x: number, y: number, width: number): void {
    ctx.setLineDash([8, 4])
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + width, y)
    ctx.stroke()
  }

  private static drawDottedLine(ctx: CanvasRenderingContext2D, x: number, y: number, width: number): void {
    ctx.setLineDash([2, 4])
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + width, y)
    ctx.stroke()
  }

  private static drawDoubleLine(ctx: CanvasRenderingContext2D, x: number, y: number, width: number): void {
    ctx.setLineDash([])
    ctx.lineWidth = 0.5
    // 上细线
    ctx.beginPath()
    ctx.moveTo(x, y - 2)
    ctx.lineTo(x + width, y - 2)
    ctx.stroke()
    // 下粗线
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + width, y)
    ctx.stroke()
    ctx.lineWidth = 1
  }
}
