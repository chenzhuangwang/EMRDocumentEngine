// ================================================================
// ControlFieldGeometry — 控件「编辑文本区」几何单源 (契约 §12.6/§12.7)
//
// 输入与 ControlParticle / LayoutEngine / getControlEditTarget 相同的
// 「盒 + 内容」事实, 输出 overlay 无缝编辑所需的文本平面几何:
//   文本区左缘 textX / 右缘 textRightX / 可用宽 contentW。
//
// 与 ControlParticle field 分支绘制公式逐项一致 (同一常量 CONTROL_BOX_PADDING
// 等)。此模块只算几何, 不含绘制; 由:
//   - Draw.getControlEditTarget(编辑目标) 换算 CSS px 给 overlay
//   - 单测与 ControlParticle 现状数值对拍, 防两套 inset 规则漂移
//
// measure 由调用方注入: 渲染 ctx.measureText; 几何/命中 TextMeasurer。
// 纯函数, 无 pool/host/Canvas 依赖, 可脱离 DOM 单测。
// ================================================================

import { controlVisualRecipe, computeControlBox, CONTROL_BOX_PADDING } from './ControlBox'
import type { ControlBoxGeometry } from './ControlBox'

export interface FieldRegionInput {
  /** 控件视觉形态 (只用于 recipe 分类, 唯一分类点仍 controlVisualRecipe) */
  controlType?: string
  /** 布局行起始 x (item.x, 已含列表标记) 与行顶 y (item.y) */
  lineLeft: number
  lineTop: number
  /** 布局最终完整可见控件宽 (layoutW = item.width - markerWidth) */
  layoutWidth: number
  ascent: number
  descent: number
  /** 表现层 minWidth ('168px' 兼容) */
  minWidth?: number | string
  /** 显示边框样式 ('none' → 隐藏框/括号) */
  borderStyle?: 'none' | 'solid' | string
  /** 显式 textAlign 覆盖 (缺省用 recipe.align) */
  textAlignOverride?: 'left' | 'center' | 'right'
  /** 文本测宽 (bracketW 需按当前字体) */
  measure: (text: string) => number
}

export interface FieldRegion {
  frame: 'brackets' | 'box'
  align: 'left' | 'center' | 'right'
  /** 是否绘制方括号 (brackets 且 borderStyle!=='none') */
  bracketOn: boolean
  /** '[' 宽度 (仅 frame==='brackets'); box/隐藏为 0 */
  bracketW: number
  affordance: 'dropdown' | 'calendar' | null
  box: ControlBoxGeometry
  /** 文本区左缘 (左对齐时 glyph 起点) — 文档坐标 px */
  textX: number
  /** 文本区右缘 (右对齐时 glyph 右界, 不含 ']') — 文档坐标 px */
  textRightX: number
  /** 文本可用宽 = textRightX - textX */
  contentW: number
}

/**
 * 计算控件「编辑文本区」几何 (与 ControlParticle field 分支同源)。
 *
 * 约定 (对照 ControlParticle.ts):
 *   - brackets: 框内文本左缘 = leftEdge+PADDING + bracketW('['); 右缘(供
 *     ']' 落位前) = rightEdge-PADDING-bracketW; 可用宽 = contentW-2*bracketW。
 *   - borderStyle 'none'(frameHidden): 无括号 → 文本区 = 整个 contentW。
 *   - box(textarea): 文本区 = contentW(box.leftEdge+PADDING .. rightEdge-PADDING)。
 */
export function computeFieldRegion(input: FieldRegionInput): FieldRegion {
  const recipe = controlVisualRecipe(input.controlType)
  // 本函数只服务 field 拓扑 (brackets/box); options 由调用方排除, recipe.frame
  // 理论不会为 null, 这里按「非 brackets 即 box」收窄以避免 null 落盘。
  const frame: FieldRegion['frame'] = recipe.frame === 'brackets' ? 'brackets' : 'box'
  const box = computeControlBox(
    input.lineLeft, input.lineTop, input.layoutWidth,
    input.ascent, input.descent, input.minWidth,
  )
  const align = input.textAlignOverride ?? recipe.align
  // select(▼)/date(日历) 视为无括号: 不画 [ ], 只画内容 + affordance
  const frameHidden = input.borderStyle === 'none' || recipe.affordance != null
  const bracketOn = frame === 'brackets' && !frameHidden
  const bracketW = frame === 'brackets' && !frameHidden ? input.measure('[') : 0

  let textX: number
  let textRightX: number
  if (frame === 'brackets') {
    // 文本区 = 左右括号之间的区域
    textX = box.leftEdge + CONTROL_BOX_PADDING + bracketW
    textRightX = box.rightEdge - CONTROL_BOX_PADDING - bracketW
  } else {
    // textarea 四边框: 文本区 = 内容区 (无括号)
    textX = box.leftEdge + CONTROL_BOX_PADDING
    textRightX = box.rightEdge - CONTROL_BOX_PADDING
  }

  return {
    frame,
    align,
    bracketOn,
    bracketW,
    affordance: recipe.affordance,
    box,
    textX,
    textRightX,
    contentW: Math.max(0, textRightX - textX),
  }
}
