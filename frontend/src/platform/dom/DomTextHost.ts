// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// DomTextHost — 浏览器文本测量 / 字体宿主实现 (契约 §27)
//
// 在 platform/dom 内访问 document / canvas / document.fonts,
// 通过 TextHost / FontHost 接口供 engine 使用。
//
// 依赖方向: platform/dom → engine/host (单向, 契约 §27)
// ============================================================

import type { TextHost, TextMeasurement, FontHost } from '../../engine/host/EditorHost'
import type { FontMetrics } from '../../engine/layout/text/FontMetrics'
import type { FontDescriptor } from '../../engine/layout/text/FontManager'

export class DomTextHost implements TextHost, FontHost {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null

  /** 惰性创建离屏测量 canvas — 避免实例化即触碰 DOM */
  private getCtx(): CanvasRenderingContext2D {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas')
      this.ctx = this.canvas.getContext('2d')!
    }
    return this.ctx!
  }

  measure(text: string, font: string): TextMeasurement {
    const ctx = this.getCtx()
    ctx.font = font
    const tm = ctx.measureText(text) as TextMetrics & {
      fontBoundingBoxAscent?: number
      fontBoundingBoxDescent?: number
      actualBoundingBoxAscent?: number
      actualBoundingBoxDescent?: number
    }
    return {
      width: tm.width,
      fontBoundingBoxAscent: tm.fontBoundingBoxAscent,
      fontBoundingBoxDescent: tm.fontBoundingBoxDescent,
      actualBoundingBoxAscent: tm.actualBoundingBoxAscent,
      actualBoundingBoxDescent: tm.actualBoundingBoxDescent,
    }
  }

  getFontMetrics(family: string, weight: number, style: string): FontMetrics {
    const ctx = this.getCtx()
    const fontSize = 100 // 使用 100px 减少浮点误差
    const fontStr = `${style} ${weight} ${fontSize}px "${family}", serif`

    ctx.font = fontStr

    const fullWidth = (ctx.measureText('中').width / fontSize) * 1000
    const halfWidth = (ctx.measureText('a').width / fontSize) * 1000

    const tm = this.measure('M', fontStr)

    // 优先 fontBoundingBox (Chrome 99+), 降级 actualBoundingBox
    let ascent = tm.fontBoundingBoxAscent ?? tm.actualBoundingBoxAscent ?? fontSize * 0.8
    let descent = tm.fontBoundingBoxDescent ?? tm.actualBoundingBoxDescent ?? fontSize * 0.2

    ascent = (ascent / fontSize) * 1000
    descent = (descent / fontSize) * 1000

    // fontBoundingBox 已包含 line gap
    const lineGap = tm.fontBoundingBoxAscent !== undefined ? 0 : 200

    return {
      ascent: Math.round(ascent),
      descent: Math.round(-descent), // 负值, 与 CSS 约定一致
      lineGap,
      capHeight: Math.round(fullWidth * 0.662),
      xHeight: Math.round(fullWidth * 0.458),
      fullWidthAdvance: Math.round(fullWidth),
      halfWidthAdvance: Math.round(halfWidth),
    }
  }

  isGlyphAvailable(family: string, char: string): boolean {
    // 空白字符总是"存在"
    if (char.trim() === '' || char === '​') return true
    // 无 FontFaceSet 环境: 无法检测, 视为全部存在
    if (!document.fonts || typeof document.fonts.check !== 'function') return true
    return document.fonts.check(`12px "${family}"`, char)
  }

  isFontAvailable(family: string, weight: number, style: string): boolean {
    if (!document.fonts || typeof document.fonts.check !== 'function') return true
    return document.fonts.check(`${style} ${weight} 16px "${family}"`)
  }

  onReady(): Promise<void> {
    if (document.fonts && document.fonts.ready) {
      return document.fonts.ready.then(() => undefined)
    }
    return Promise.resolve()
  }

  async loadFont(descriptor: FontDescriptor): Promise<void> {
    // 仅嵌入式字体需要 FontFace 加载; system 字体无需处理
    if (descriptor.source === 'url' && descriptor.url) {
      const fontFace = new FontFace(descriptor.family, `url(${descriptor.url})`, {
        weight: String(descriptor.weight),
        style: descriptor.style,
      })
      await fontFace.load()
      if (document.fonts) document.fonts.add(fontFace)
    }
  }

  async querySystemFonts(): Promise<string[]> {
    // Chrome 103+ 支持 queryLocalFonts API
    if (typeof window !== 'undefined' && 'queryLocalFonts' in window) {
      try {
        const fonts = (window as unknown as Record<string, unknown>).queryLocalFonts as
          (() => Promise<Array<{ family: string }>>) | undefined
        if (fonts) {
          const result = await fonts()
          return [...new Set(result.map(f => f.family))]
        }
      } catch {
        // 权限拒绝, 使用降级列表
      }
    }
    // 降级: 常见中文字体列表
    return [
      'SimSun', 'SimHei', 'Microsoft YaHei', 'FangSong', 'KaiTi',
      'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC',
      'Arial', 'Times New Roman', 'Courier New',
    ]
  }
}

export function createDomTextHost(): DomTextHost {
  return new DomTextHost()
}
