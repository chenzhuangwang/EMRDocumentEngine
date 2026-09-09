// ================================================================
// ControlBox — 运行时控件视觉盒几何 + 单一视觉分类配方 (契约 §12.6)
//
// 单一几何源: 盒几何 (computeControlBox) + affordance 常量 + 视觉配方
// (controlVisualRecipe)。本模块属 document/control 域, 不依赖 render/
// template 特征层 —— recipe 吃 string (非 ControlType) 避免 document→feature
// 倒挂 (契约 §19); 纯函数, 无 pool / host / Canvas 依赖。
//
// Render (ControlParticle / Draw) 与 HitTest (findRuntimeControlHitAt) 都
// 直接调用 computeControlBox, 不另设 wrapper 或第二套几何 (不变量 1/9)。
// ================================================================

/** 控件盒水平内边距 — 盒宽 = max(width, minWidth) + 2*CONTROL_BOX_PADDING */
export const CONTROL_BOX_PADDING = 3

/** affordance (▼/日历) 的实际绘制盒尺寸 (px) — 布局预留 = 实际绘制, 不外扩 (不变量 7) */
export const AFFORDANCE_WIDTH = 12
/** affordance 与框内文本的间距 (px) */
export const AFFORDANCE_GAP = 6

export type ControlFrame = 'brackets' | 'box'
export type ControlAlign = 'left' | 'right'
export type ControlAffordance = 'dropdown' | 'calendar' | null

/** 单一视觉分类配方 —— 决定视觉拓扑 (field/options) + frame/align/affordance */
export interface ControlVisualRecipe {
  kind: 'field' | 'options'
  frame: ControlFrame | null
  align: ControlAlign
  affordance: ControlAffordance
}

/**
 * controlType → 视觉配方 (契约 §12.1/§12.6)。唯一分类决策点 (不变量 6)。
 * controlType 用 string, 缺省 = 遗留文档中性占位框 (brackets/left/null)。
 *
 *   input    → field  brackets  left   null
 *   number   → field  brackets  right  null
 *   date     → field  brackets  left   calendar
 *   select   → field  brackets  left   dropdown
 *   textarea → field  box       left   null
 *   radio    → options none      left   null   // 内联选择组, 永不进 field/box 路径
 *   checkbox → options none      left   null
 */
export function controlVisualRecipe(controlType?: string): ControlVisualRecipe {
  switch (controlType) {
    case 'input':    return { kind: 'field',   frame: 'brackets', align: 'left',  affordance: null }
    case 'number':   return { kind: 'field',   frame: 'brackets', align: 'right', affordance: null }
    case 'date':     return { kind: 'field',   frame: 'brackets', align: 'left',  affordance: 'calendar' }
    case 'select':   return { kind: 'field',   frame: 'brackets', align: 'left',  affordance: 'dropdown' }
    case 'textarea': return { kind: 'field',   frame: 'box',      align: 'left',  affordance: null }
    case 'radio':    return { kind: 'options', frame: null,       align: 'left',  affordance: null }
    case 'checkbox': return { kind: 'options', frame: null,       align: 'left',  affordance: null }
    default:         return { kind: 'field',   frame: 'brackets', align: 'left',  affordance: null }
  }
}

export interface ControlBoxGeometry {
  x: number
  y: number
  w: number
  h: number
  /** 文本基线 Y (lineTop + ascent), 与 TextParticle / caret 同源 */
  baselineY: number
  /** 内容区宽 (盒宽 - 2*padding) */
  contentW: number
  leftEdge: number
  rightEdge: number
}

/**
 * 控件视觉盒几何 (单一事实源, 契约 §12.3) —— Render 与 HitTest 共用。
 *
 * width = 布局最终分配的完整可见控件宽 (含 affordance), 非「文本宽」(不变量 1)。
 * minWidth 内部 parseFloat 数值化 (保留 '168px' 兼容)。盒顶 = lineTop (行顶,
 * 非基线), 盒高 = ascent + descent (不加垂直 padding, 避免换行后相邻行重叠)。
 */
export function computeControlBox(
  lineLeft: number,
  lineTop: number,
  width: number,
  ascent: number,
  descent: number,
  minWidth?: number | string,
): ControlBoxGeometry {
  const padding = CONTROL_BOX_PADDING
  const minW = typeof minWidth === 'number' ? minWidth : (minWidth != null ? parseFloat(String(minWidth)) : 0)
  const minBoxWidth = Number.isFinite(minW) && minW > 0 ? minW : 0
  const boxW = Math.max(width, minBoxWidth) + padding * 2
  const leftEdge = lineLeft - padding
  return {
    x: leftEdge,
    y: lineTop,
    w: boxW,
    h: ascent + descent,
    baselineY: lineTop + ascent,
    contentW: boxW - padding * 2,
    leftEdge,
    rightEdge: leftEdge + boxW,
  }
}

/**
 * 剥离占位符的方括号外框 (工厂 `[name]` → `name`)。非 `[...]` 形态原样返回。
 *
 * 仅供「空态占位符」使用 —— 填充态的值可能合法地含 `[ ]`, 绝不可用本函数
 * 剥离值 (调用方以 isControlValueEmpty 守卫, 只对空态占位符调用)。
 */
export function stripPlaceholderBrackets(text: string): string {
  if (text.length >= 2 && text.charAt(0) === '[' && text.charAt(text.length - 1) === ']') {
    return text.slice(1, -1)
  }
  return text
}
