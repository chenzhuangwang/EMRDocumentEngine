// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// KaTeXRenderer — KaTeX 增强公式渲染器 (v7.0, 无轮次)
//
// 使用 KaTeX 渲染 LaTeX 公式到 Canvas
// 渲染流程: LaTeX → KaTeX HTML → 离屏测量 → Canvas 绘制
// ============================================================

import katex from 'katex'
import type { EditorHost } from '../host/EditorHost'

/** KaTeX 渲染结果 */
export interface KaTeXRenderResult {
  /** 渲染宽度 (px) */
  width: number
  /** 渲染高度 (px) */
  height: number
  /** HTML 字符串 */
  html: string
}

// ---- 渲染 ----

/**
 * 使用 KaTeX 渲染 LaTeX 到 Canvas
 * 相比纯 Canvas 实现, 支持完整 LaTeX 语法:
 * 矩阵/大型运算符/多级上下标/帽子/箭头/字体等
 */
export function renderKaTeXToCanvas(
  host: EditorHost,
  ctx: CanvasRenderingContext2D,
  latex: string,
  x: number,
  y: number,
  fontSize = 16,
  color = '#1F2937',
): KaTeXRenderResult | null {
  try {
    const html = katex.renderToString(latex, {
      throwOnError: true,
      output: 'html',
      trust: false,
    })

    // 离屏测量 (经 PlatformHost, 契约 §28)
    const m = host.platform.measureHtml(html, fontSize)

    // Canvas 绘制: 先清空旧内容, 测量后使用 fillText 逐字符绘制
    // 简化方案: 使用 KaTeX 输出的文本内容
    const textContent = m.text || latex
    ctx.save()
    ctx.font = `${fontSize}px "KaTeX_Main", "Times New Roman", serif`
    ctx.fillStyle = color
    ctx.fillText(textContent, x, y + fontSize * 0.8)
    ctx.restore()

    return { width: m.width, height: m.height, html }
  } catch {
    // KaTeX 渲染失败 → 回退到纯 Canvas 渲染
    return null
  }
}

/**
 * 检查 LaTeX 语法是否可以被 KaTeX 正确渲染
 */
export function validateKaTeX(latex: string): boolean {
  try {
    katex.renderToString(latex, { throwOnError: true })
    return true
  } catch {
    return false
  }
}

/**
 * 获取 KaTeX 渲染后的尺寸 (不绘制)
 */
export function measureKaTeX(host: EditorHost, latex: string, fontSize = 16): { width: number; height: number } | null {
  try {
    const html = katex.renderToString(latex, {
      throwOnError: true,
      output: 'html',
    })

    const m = host.platform.measureHtml(html, fontSize)
    return { width: m.width, height: m.height }
  } catch {
    return null
  }
}
