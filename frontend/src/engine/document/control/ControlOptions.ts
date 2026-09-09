// ================================================================
// ControlOptions — checkbox/radio 内联候选项横向布局 (契约 §12.6)
//
// 单一事实源: 渲染 (ControlParticle 画候选项) 与命中检测 (MouseHandler
// 点候选项) 共用同一布局函数, 保证绘制边界与点击命中边界一致, 杜绝
// 二者各测各的漂移。值写入仍走 Editor.setControlValue →
// SetControlValueCommand (VR-3), 本模块只做纯布局计算, 不读写模型。
// ================================================================

import type { ElementEnumOption } from '../core/DocumentModel'

/** 单个内联候选项的横向布局 (x 相对内容区左边缘, px) */
export interface ControlOptionLayout {
  value: string
  name: string
  /** 相对内容区左边缘的 X 偏移 */
  x: number
  /** 占宽 (glyph + 间距 + 文本) */
  width: number
}

/** 候选项间隙 (px) */
const OPTION_GAP = 8
/** glyph 与文本的间距 (px) — 导出供渲染 (ControlParticle) 复用, 保证绘制间距同源 */
export const GLYPH_PAD = 4

/**
 * 计算 checkbox/radio 内联候选项的横向布局。
 *
 * @param measure 文本测宽函数 (渲染传 ctx.measureText, 命中传 TextMeasurer.measureWidth)
 * @returns 按声明顺序排列的候选项布局; 总宽 = 最后一项 x + width
 */
export function layoutControlOptions(
  options: readonly ElementEnumOption[],
  controlType: 'checkbox' | 'radio',
  measure: (text: string) => number,
): ControlOptionLayout[] {
  const glyphW = measure(controlType === 'checkbox' ? '☐' : '○')
  const list: ControlOptionLayout[] = []
  let x = 0
  for (let i = 0; i < options.length; i++) {
    if (i > 0) x += OPTION_GAP
    const width = glyphW + GLYPH_PAD + measure(options[i].name)
    list.push({ value: options[i].value, name: options[i].name, x, width })
    x += width
  }
  return list
}

/** 候选项布局总宽 (供布局预留宽 + 命中边界) */
export function controlOptionsWidth(layout: ControlOptionLayout[]): number {
  if (layout.length === 0) return 0
  const last = layout[layout.length - 1]
  return last.x + last.width
}

/** 空候选项占位文本 (契约 §12.6.3: enums 存在但 data=[] 仍是 enum 语义, 不退化输入框) */
export const EMPTY_OPTIONS_PLACEHOLDER = '无候选项'

/** 空候选项占位宽 (供布局预留 + 渲染占位) */
export function controlOptionsPlaceholderWidth(measure: (text: string) => number): number {
  return measure(EMPTY_OPTIONS_PLACEHOLDER)
}
