// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// FontMetrics — 字体度量数据 (架构 §3.1, v20.34)
// ================================================================

export interface FontMetrics {
  ascent: number
  descent: number
  lineGap: number
  capHeight: number
  xHeight: number
  fullWidthAdvance: number
  halfWidthAdvance: number
}

// 默认 SimSun 度量 (16px, upem=1000)
// 注意: 生产环境应通过 FontMetricsParser (§3.1b) 从字体文件解析
export const DEFAULT_FONT_METRICS: FontMetrics = {
  ascent: 880,
  descent: -120,
  lineGap: 0,
  capHeight: 662,
  xHeight: 458,
  fullWidthAdvance: 1000,
  halfWidthAdvance: 500,
}

/**
 * LineHeightResolver — 行高计算唯一入口 (架构 §3.3, v20.34)
 *
 * 公式: lineHeight = (ascent + descent + lineGap) × (fontSize / 1000) × paragraphLineHeight
 *
 * 禁止启发式估算。字体未就绪禁止进入编辑态。
 */
export function resolveLineHeight(
  fontSize: number,
  lineHeight: number | undefined,
  metrics: FontMetrics = DEFAULT_FONT_METRICS,
): number {
  const base = (metrics.ascent + Math.abs(metrics.descent) + metrics.lineGap) * (fontSize / 1000)
  return base * (lineHeight ?? 1.0)
}
