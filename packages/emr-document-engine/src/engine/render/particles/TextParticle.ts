// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// TextParticle — 文本粒子渲染器 (v5.0 / TASK-475)
//
// 新增: showInvisible 模式 — 空格→中点 / 换行→↵ / 制表符→→
//
// 主题化 (v6.1): REVISION / INVISIBLE / 文本默认色 — 优先 el.color / el.revision.type,
// 否则读 options.tokenSet (Draw render() 入口拍快照); tokenSet 缺则回退硬编码 hex
// (回归保险, 不应触发)。
// ============================================================

import type { CanvasTokenSet } from '../../state/canvasTokens'
import { asRgb } from '../../state/canvasTokens'

const REVISION_FALLBACK: Record<string, string> = {
  insert: '#16A34A', delete: '#DC2626', modify: '#2563EB',
}

/** 不可见字符映射 */
const INVISIBLE_MAP: Record<string, string> = {
  ' ':  '·',   // · (middle dot)
  '\n': '↵',   // ↵ (carriage return arrow)
  '\t': '→',   // → (right arrow)
}

/** 不可见字符的颜色 (淡蓝灰) —— 仅在 tokenSet 缺失时兜底 */
const INVISIBLE_COLOR_FALLBACK = '#93C5FD'

/** tokenSet → 修订色 hex, 缺则回退硬编码 */
function revisionColor(t: CanvasTokenSet | undefined, type: string): string {
  if (t) {
    const k = type === 'insert' ? 'revisionInsert' : type === 'delete' ? 'revisionDelete' : 'revisionModify'
    const v = t[k]
    if (v) return asRgb(v)
  }
  return REVISION_FALLBACK[type] || '#000000'
}

/** tokenSet → 不可见字符色, 缺则回退 */
function invisibleColor(t: CanvasTokenSet | undefined): string {
  if (t?.invisibleChar) return asRgb(t.invisibleChar)
  return INVISIBLE_COLOR_FALLBACK
}

export class TextParticle {
  static render(
    ctx: CanvasRenderingContext2D,
    el: {
      id: string; type: string; value: string
      font?: string; size?: number; bold?: boolean; italic?: boolean
      color?: string; underline?: boolean; underlineStyle?: string
      strikeout?: boolean; superscript?: boolean; subscript?: boolean
      highlight?: string; revision?: { type: string }
    },
    x: number,
    y: number,
    options: {
      defaultColor?: string; defaultFont?: string; defaultSize?: number
      showInvisible?: boolean; ascent?: number; descent?: number
      tokenSet?: CanvasTokenSet
    } = {},
  ): void {
    const fontSize = el.size || options.defaultSize || 16
    const fontFamily = el.font || options.defaultFont || 'SimSun'

    // ---- 1. 字体构建 ----
    const fontParts: string[] = []
    if (el.bold) fontParts.push('bold')
    if (el.italic) fontParts.push('italic')
    fontParts.push(`${fontSize}px`)
    fontParts.push(`"${fontFamily}"`)
    ctx.font = fontParts.join(' ')

    // ---- 2. Canvas TextMetrics: 原生度量, 消除固定倍率偏差 ----
    const measureText = el.value || ' '
    const metrics = ctx.measureText(measureText)
    const tw = metrics.width
    const m = metrics as unknown as {
      actualBoundingBoxAscent?: number; actualBoundingBoxDescent?: number
      fontBoundingBoxAscent?: number; fontBoundingBoxDescent?: number
    }
    let textAscent = options.ascent ?? m.actualBoundingBoxAscent ?? m.fontBoundingBoxAscent ?? fontSize * 0.8
    let textDescent = options.descent ?? m.actualBoundingBoxDescent ?? m.fontBoundingBoxDescent ?? fontSize * 0.2
    if (textAscent < 1) textAscent = fontSize * 0.8
    if (textDescent < 1) textDescent = fontSize * 0.2

    // ---- 3. 颜色（修订色优先 → 文档 run color → tokenSet.textInk → 硬编码） ----
    const t = options.tokenSet
    const textInkFallback = t ? asRgb(t.textInk) : undefined
    let baseColor: string
    if (el.revision) {
      baseColor = revisionColor(t, el.revision.type)
    } else if (el.color) {
      baseColor = el.color
    } else {
      baseColor = textInkFallback || options.defaultColor || '#000000'
    }
    ctx.fillStyle = baseColor

    // ---- 4. 高亮背景（在文字之前绘制） ----
    if (el.highlight) {
      ctx.fillStyle = el.highlight
      ctx.fillRect(x, y, tw, textAscent + textDescent)
      ctx.fillStyle = baseColor
    }

    // ---- 5. 文字基线 = 行顶 + Canvas 度量的实际 ascent ----
    let textY = y + textAscent
    if (el.superscript) textY = y + textAscent * 0.6
    else if (el.subscript) textY = y + textAscent * 1.4

    // ---- 6. 文字绘制 ----
    const invisibleCol = invisibleColor(t)
    if (el.value && el.value !== '' && el.value !== '\n') {
      if (options.showInvisible) {
        this.renderInvisible(ctx, el.value, x, textY, baseColor, fontSize, invisibleCol)
      } else {
        ctx.fillText(el.value, x, textY)
      }
    } else if (el.value === '\n' && options.showInvisible) {
      ctx.save()
      ctx.fillStyle = invisibleCol
      ctx.font = `${fontSize * 0.7}px "${fontFamily}"`
      ctx.fillText(INVISIBLE_MAP['\n'], x, textY)
      ctx.restore()
    }

    // ---- 7. 下划线 ----
    if (el.underline) {
      ctx.strokeStyle = baseColor
      ctx.lineWidth = 1
      const uy = textY + textDescent * 0.3
      const style = el.underlineStyle || 'single'

      if (style === 'wave') {
        ctx.beginPath()
        const amplitude = 2
        const period = 6
        for (let wx = x; wx <= x + tw; wx += 1) {
          const wy = uy + Math.sin((wx - x) / period * Math.PI * 2) * amplitude
          if (wx === x) ctx.moveTo(wx, wy)
          else ctx.lineTo(wx, wy)
        }
        ctx.stroke()
      } else if (style === 'double') {
        ctx.beginPath()
        ctx.moveTo(x, uy - 2)
        ctx.lineTo(x + tw, uy - 2)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(x, uy + 2)
        ctx.lineTo(x + tw, uy + 2)
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.moveTo(x, uy)
        ctx.lineTo(x + tw, uy)
        ctx.stroke()
      }
    }

    // ---- 8. 删除线 ----
    if (el.strikeout) {
      ctx.strokeStyle = baseColor
      ctx.lineWidth = 1
      const sy = textY - textAscent * 0.5
      ctx.beginPath()
      ctx.moveTo(x, sy)
      ctx.lineTo(x + tw, sy)
      ctx.stroke()
    }
  }

  /** 不可见字符模式: 逐字符绘制, 空格/制表符用特殊符号代替 */
  private static renderInvisible(
    ctx: CanvasRenderingContext2D,
    value: string,
    x: number,
    y: number,
    normalColor: string,
    _fontSize: number,
    invisibleColor: string,
  ): void {
    const spaceWidth = ctx.measureText(' ').width

    let cx = x
    for (const ch of [...value]) {
      const invisible = INVISIBLE_MAP[ch]
      if (invisible) {
        ctx.save()
        ctx.fillStyle = invisibleColor
        ctx.fillText(invisible, cx, y)
        ctx.restore()
        cx += ch === ' ' ? spaceWidth : ch === '\t' ? spaceWidth * 4 : ctx.measureText(invisible).width
      } else {
        ctx.fillStyle = normalColor
        ctx.fillText(ch, cx, y)
        cx += ctx.measureText(ch).width
      }
    }
  }
}