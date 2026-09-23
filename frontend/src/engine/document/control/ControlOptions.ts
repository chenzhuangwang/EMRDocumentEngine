// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ControlOptions — checkbox/radio 内联候选项横向布局 (契约 §12.6)
//
// 单一事实源: 渲染 (ControlParticle 画候选项) 与命中检测 (MouseHandler
// 点候选项) 共用同一布局函数, 保证绘制边界与点击命中边界一致, 杜绝
// 二者各测各的漂移。值写入仍走 Editor.setControlValue →
// SetControlValueCommand (VR-3), 本模块只做纯布局计算, 不读写模型。
// ================================================================

import type { ElementEnumOption } from '../core/DocumentModel'
import { locale } from '../../i18n/index'

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

/**
 * 空候选项占位文本 (契约 §12.6.3: enums 存在但 data=[] 仍是 enum 语义, 不退化输入框)。
 *
 * 是**函数**不是常量: 文案随界面语言变。量宽 (controlOptionsPlaceholderWidth)
 * 与渲染 (ControlParticle) 必须调同一个函数 —— 各自读一次就会在切语言的瞬间
 * 量宽与绘制宽不一致 (占位文本长度不同), 表现为候选项盒宽跳动。
 *
 * 每次调用现读语言包, 不缓存 (缓存等于把语言冻在首次调用那一刻)。
 */
export function emptyOptionsPlaceholder(): string {
  return locale.t('control.emptyOptions')
}

/** 空候选项占位宽 (供布局预留 + 渲染占位) */
export function controlOptionsPlaceholderWidth(measure: (text: string) => number): number {
  return measure(emptyOptionsPlaceholder())
}
