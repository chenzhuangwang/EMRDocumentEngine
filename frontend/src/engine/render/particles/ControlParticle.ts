// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ControlParticle — 表单控件/SmartText 粒子渲染器 (R2)
//
// 为 SmartTextNode 渲染「控件自有交互 affordance」视觉形态 (契约 §12.6):
//   - field (input/number/date/select): 方括号 `[ ]` 框 (textarea: 四边框)
//   - options (radio/checkbox): 内联 `○/☐ + name` 选项组, 无框/无括号/无整体盒
//
// 本文件是「单一视觉配方」消费方 —— 唯一分类决策点在
// document/control/ControlBox.controlVisualRecipe (不变量 6); 本文件只按
// recipe.kind 分支绘制, 不再持有 dataType→配色 / affordance 映射等第二套规则。
// ============================================================

import type { IParticle, RenderOptions } from './IParticle'
import type { SLIFItem } from '../../layout/core/SLIF'
import {
  controlVisualRecipe, controlVisualType, computeControlBox,
  CONTROL_BOX_PADDING, AFFORDANCE_WIDTH, stripPlaceholderBrackets,
} from '../../document/control/ControlBox'
import { isControlValueEmpty, controlDisplayLength } from '../../document/control/ControlValue'
import { layoutControlOptions, GLYPH_PAD, EMPTY_OPTIONS_PLACEHOLDER } from '../../document/control/ControlOptions'

/** 空/占位灰 (状态色, 非分类色) */
const PLACEHOLDER_COLOR = '#9CA3AF'
/** 填充态框色 */
const FRAME_FILLED = '#6B7280'
/** 只读态框色 */
const FRAME_READONLY = '#D1D5DB'
/** 脱敏红框 */
const FRAME_MASKED = '#F87171'
/** 选中 glyph 蓝 (颜色只表 state, 非 widget identity) */
const GLYPH_SELECTED = '#2563EB'
/** 未选 glyph 灰 */
const GLYPH_UNSELECTED = '#9CA3AF'

/** 下拉三角 (≤12px): 约 7×5 实心三角 */
function drawDropdown(ctx: CanvasRenderingContext2D, left: number, top: number, height: number): void {
  const w = 7
  const h = 5
  const cx = left + (AFFORDANCE_WIDTH - w) / 2
  const cy = top + height / 2
  ctx.fillStyle = GLYPH_UNSELECTED
  ctx.beginPath()
  ctx.moveTo(cx, cy - h / 2)
  ctx.lineTo(cx + w, cy - h / 2)
  ctx.lineTo(cx + w / 2, cy + h / 2)
  ctx.closePath()
  ctx.fill()
}

/** 日历 (≤12px): 1px 描边 9×10 矩形 + 顶部小耳 */
function drawCalendar(ctx: CanvasRenderingContext2D, left: number, top: number, height: number): void {
  const w = 9
  const h = 10
  const cx = left + (AFFORDANCE_WIDTH - w) / 2
  const cy = top + height / 2 - h / 2
  ctx.strokeStyle = GLYPH_UNSELECTED
  ctx.lineWidth = 1
  ctx.strokeRect(cx, cy, w, h)
  ctx.beginPath()
  ctx.moveTo(cx + 1, cy + 2)
  ctx.lineTo(cx + 1, cy)
  ctx.lineTo(cx + 4, cy)
  ctx.moveTo(cx + 5, cy)
  ctx.lineTo(cx + 8, cy)
  ctx.lineTo(cx + 8, cy + 2)
  ctx.stroke()
}

export function createControlParticle(): IParticle {
  return {
    type: 'smarttext',

    render(ctx: CanvasRenderingContext2D, item: SLIFItem, x: number, y: number, options?: RenderOptions): void {
      const rawText = item.text || ''
      const fontSize = item.size || 16
      const fontFamily = item.font || 'SimSun'

      // 行级 ascent/descent 与 TextParticle/caret 同源; 0 时回退 fontSize 估算。
      const ascent = item.ascent > 0 ? item.ascent : fontSize * 0.8
      const descent = item.descent > 0 ? item.descent : fontSize * 0.2

      // 表现层样式 (契约 §2.2) — draw time 按 nodeId 查询, 不写入 DocumentModel
      const style = options?.presentationStyleOf?.(item.nodeId)

      // 模板设计期属性 (契约 §12.1) — 附属字面量
      const def = options?.templateDefinitionOf?.(item.nodeId)
      const label = typeof def?.label === 'string' ? def.label : ''
      const prefix = typeof def?.prefix === 'string' ? def.prefix : ''
      const suffix = typeof def?.suffix === 'string' ? def.suffix : ''

      // 语义元数据 (契约 §2.1) — 元素元数据 + 运行时值
      const element = options?.elementOf?.(item.nodeId)
      const controlValue = options?.controlValueOf?.(item.nodeId)
      const isEmpty = isControlValueEmpty(controlValue)

      // 隐私脱敏 (不变量 4): 掩码长度按 display 表示计算 (number 用 String(n).length)
      const privacy = element?.privacy
      const isMasked = privacy?.enabled === true
      const maskChar = privacy?.maskChar || '*'
      const maskLen = controlValue !== undefined ? controlDisplayLength(controlValue) : rawText.length
      const displayText = isMasked ? maskChar.repeat(maskLen) : rawText

      // 只读 (契约 §12.6.3 layer B) — canvas 已完整表达; 交互在 MouseHandler 拦截
      const isReadonly = def?.editable === false || element?.readonly === true

      // 视觉配方 (不变量 6: 唯一分类决策点)。def.controlType 缺失但 element 带
      // enums 时, 仅表现回退为 radio/checkbox 选项组 (VR-15: 仅呈现, 绝不写回)。
      const hasEnums = element?.format?.enums !== undefined
      const enumsMultiple = element?.format?.enums?.multiple === true
      const controlType = def?.controlType ?? controlVisualType(def?.controlType, hasEnums, enumsMultiple)
      const recipe = controlVisualRecipe(controlType)

      ctx.save()
      const fontParts: string[] = []
      if (item.bold) fontParts.push('bold')
      if (item.italic) fontParts.push('italic')
      fontParts.push(`${fontSize}px`)
      fontParts.push(`"${fontFamily}"`)
      ctx.font = fontParts.join(' ')
      ctx.textBaseline = 'alphabetic'

      // 盒几何单一源 (不变量 1): 布局 advance 扣列表标记宽 = 完整可见控件宽。
      // 附属字面量 label/prefix/suffix 占位: 布局已把 lead+trail 计入 item.width,
      // 此处按 lead 右移盒, 使 label/prefix 画在预留左区、suffix 画在预留右区。
      const labelW2 = label ? ctx.measureText(label).width : 0
      const prefixW2 = prefix ? ctx.measureText(prefix).width : 0
      const suffixW2 = suffix ? ctx.measureText(suffix).width : 0
      const leadW = labelW2 + prefixW2
      const trailW = suffixW2
      const layoutW = (item.width || 0) - (item.markerWidth || 0)
      const boxW = Math.max(0, layoutW - leadW - trailW)
      const box = computeControlBox(x + leadW, y, boxW, ascent, descent, style?.minWidth)

      // 状态色 (非分类)
      const frameColor = isMasked ? FRAME_MASKED : (isEmpty ? PLACEHOLDER_COLOR : FRAME_FILLED)
      const textColor = isMasked ? PLACEHOLDER_COLOR : (isEmpty ? PLACEHOLDER_COLOR : (item.color || '#374151'))
      // align 优先级 (不变量 8): 显式 textAlign 覆盖 recipe.align (number 缺省 right)
      const finalAlign = style?.textAlign ?? recipe.align

      if (recipe.kind === 'field') {
        // 激活编辑 (P5 无缝内联): 该控件正在被 overlay 编辑 → 隐藏静态框/
        // 值/▼, 由 overlay 作为唯一文本面; label/prefix/suffix 仍画 (box 外)。
        const activeEditing = options?.activeControlId === item.nodeId && !isReadonly && !isMasked

        // 框内文本: 空态剥离占位符外框 (工厂 `[name]`), 填充态用值原样 (值可能合法含 `[ ]`)
        const inner = isMasked ? displayText : (isEmpty ? stripPlaceholderBrackets(displayText) : displayText)

        if (!activeEditing && recipe.frame === 'brackets') {
          // select(▼)/date(日历) 不画方括号, 只画内容 + affordance
          const frameHidden = style?.borderStyle === 'none' || recipe.affordance != null
          const bracketW = ctx.measureText('[').width
          // 超宽折行 (契约 §12.8): 布局把过宽的值折成多物理行并锁盒宽 → 逐行绘制,
          // `[` 落在首行行首、`]` 落在末行行尾, 行距 = size (与 box 配方同 pitch)。
          const lines = (!isMasked && item.controlLines && item.controlLines.length > 0)
            ? item.controlLines
            : (inner.includes('\n') ? inner.split('\n') : [inner])
          const lineWidths = lines.map((l) => ctx.measureText(l).width)
          const innerW = lineWidths.length > 0 ? Math.max(...lineWidths) : 0
          const frameW = frameHidden ? innerW : (bracketW * 2 + innerW)
          let frameLeft = box.leftEdge + CONTROL_BOX_PADDING
          if (finalAlign === 'center') frameLeft = box.leftEdge + (box.contentW - frameW) / 2
          else if (finalAlign === 'right') frameLeft = box.rightEdge - CONTROL_BOX_PADDING - frameW

          const textLeft = frameLeft + (frameHidden ? 0 : bracketW)
          if (!frameHidden) {
            ctx.fillStyle = isReadonly ? FRAME_READONLY : frameColor
            ctx.fillText('[', frameLeft, box.baselineY)
            ctx.fillText(']', textLeft + lineWidths[lineWidths.length - 1], box.baselineY + (lines.length - 1) * fontSize)
          }
          ctx.fillStyle = textColor
          for (let k = 0; k < lines.length; k++) {
            ctx.fillText(lines[k], textLeft, box.baselineY + k * fontSize)
          }
        } else if (!activeEditing && recipe.frame === 'box') {
          // 四边框多行文本域 (textarea): 按 item.controlLines 折行逐行绘制,
          // 行距 = size (与 LayoutEngine 预留行高同 pitch, 契约 §12.6 多行)。
          const solidBorder = style?.borderStyle === 'solid'
          if (style?.borderStyle !== 'none') {
            ctx.strokeStyle = isReadonly ? FRAME_READONLY : frameColor
            ctx.lineWidth = 1
            if (!solidBorder) ctx.setLineDash([2, 1])
            ctx.strokeRect(box.x, box.y, box.w, box.h)
            ctx.setLineDash([])
          }
          const lines = isMasked
            ? [inner]
            : (item.controlLines && item.controlLines.length > 0
                ? item.controlLines
                : (inner.includes('\n') ? inner.split('\n') : [inner]))
          ctx.fillStyle = textColor
          for (let k = 0; k < lines.length; k++) {
            const lineText = lines[k]
            const lw = ctx.measureText(lineText).width
            let lx = box.leftEdge + CONTROL_BOX_PADDING
            if (finalAlign === 'center') lx = box.leftEdge + (box.contentW - lw) / 2
            else if (finalAlign === 'right') lx = box.rightEdge - CONTROL_BOX_PADDING - lw
            ctx.fillText(lineText, lx, box.y + ascent + k * fontSize)
          }
        }

        // affordance (select/date) — 严格落在 AFFORDANCE_WIDTH 盒内 (不变量 7)。
        // 激活编辑中隐藏, 由原生浮层承担。
        if (recipe.affordance && !activeEditing) {
          const affordLeft = box.rightEdge - CONTROL_BOX_PADDING - AFFORDANCE_WIDTH
          if (recipe.affordance === 'dropdown') drawDropdown(ctx, affordLeft, box.y, box.h)
          else if (recipe.affordance === 'calendar') drawCalendar(ctx, affordLeft, box.y, box.h)
        }
      } else {
        // options 拓扑 (不变量 2): 内联选项组, 无框/无括号/无整体盒。
        // 只要 controlType 是 radio/checkbox 就进 options 拓扑 (不以 enums.data.length 为条件)。
        const opts = element?.format?.enums?.data ?? []
        if (opts.length === 0) {
          // 空候选项占位, 不退化输入框 (不变量 3)
          ctx.fillStyle = PLACEHOLDER_COLOR
          ctx.fillText(EMPTY_OPTIONS_PLACEHOLDER, x + leadW, box.baselineY)
        } else {
          const layout = layoutControlOptions(opts, controlType as 'checkbox' | 'radio', (t) => ctx.measureText(t).width)
          const glyphChar = controlType === 'checkbox' ? '☐' : '○'
          const selGlyphChar = controlType === 'checkbox' ? '☑' : '◉'
          const glyphW = ctx.measureText(glyphChar).width
          // masked → 不暴露选中态 (glyph 全灰)
          const selected = isMasked ? [] : (Array.isArray(controlValue) ? controlValue : typeof controlValue === 'string' ? [controlValue] : [])
          for (const opt of layout) {
            const isSel = selected.includes(opt.value)
            ctx.fillStyle = isSel ? GLYPH_SELECTED : GLYPH_UNSELECTED
            ctx.fillText(isSel ? selGlyphChar : glyphChar, x + leadW + opt.x, box.baselineY)
            ctx.fillStyle = item.color || '#374151'
            ctx.fillText(opt.name, x + leadW + opt.x + glyphW + GLYPH_PAD, box.baselineY)
          }
        }
      }

      // 附属字面量 label/prefix/suffix (不变量 10): 画在控件预留的左/右区 (lead/trail),
      // 不侵入 box / 不改 hit box。
      ctx.fillStyle = isMasked ? PLACEHOLDER_COLOR : (item.color || '#374151')
      if (label) ctx.fillText(label, x, box.baselineY)
      if (prefix) ctx.fillText(prefix, x + labelW2, box.baselineY)
      if (suffix) ctx.fillText(suffix, box.rightEdge, box.baselineY)

      ctx.restore()
    },
  }
}
