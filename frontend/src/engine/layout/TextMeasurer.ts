// ============================================================
// 文本测量器 - 使用 Canvas measureText API
// ============================================================

import type { IFontConfig } from '../document/DocumentModel'

export class TextMeasurer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private cache: Map<string, TextMetrics>

  constructor() {
    this.canvas = document.createElement('canvas')
    this.ctx = this.canvas.getContext('2d')!
    this.cache = new Map()
  }

  private buildFontString(config: IFontConfig): string {
    const parts: string[] = []
    if (config.bold) parts.push('bold')
    if (config.italic) parts.push('italic')
    parts.push(`${config.size}px`)
    parts.push(`"${config.font}"`)
    return parts.join(' ')
  }

  private getCacheKey(text: string, config: IFontConfig): string {
    return `${text}|${config.font}|${config.size}|${config.bold}|${config.italic}`
  }

  measure(text: string, config: IFontConfig): TextMetrics {
    const key = this.getCacheKey(text, config)
    if (this.cache.has(key)) {
      return this.cache.get(key)!
    }

    this.ctx.font = this.buildFontString(config)
    const metrics = this.ctx.measureText(text)
    this.cache.set(key, metrics)
    return metrics
  }

  measureWidth(text: string, config: IFontConfig): number {
    return this.measure(text, config).width
  }

  /**
   * 将文本按指定宽度分割为多行
   * 支持 CJK 字符在任意位置断行，英文按单词断行
   */
  splitTextToWidth(text: string, maxWidth: number, config: IFontConfig): string[] {
    if (!text) return ['']
    if (maxWidth <= 0) return [text]

    const lines: string[] = []
    const chars = [...text] // 正确处理 Unicode 字符（包括 CJK）
    let currentLine = ''
    let currentWidth = 0

    for (let i = 0; i < chars.length; i++) {
      const char = chars[i]
      const charWidth = this.measureWidth(char, config)
      const nextWidth = currentWidth + charWidth

      if (nextWidth > maxWidth && currentLine.length > 0) {
        lines.push(currentLine)
        currentLine = char
        currentWidth = charWidth
      } else {
        currentLine += char
        currentWidth = nextWidth
      }
    }

    if (currentLine) {
      lines.push(currentLine)
    }

    return lines.length > 0 ? lines : ['']
  }

  /**
   * 测量多字符元素的完整宽度
   */
  measureElementWidth(element: { value: string; size?: number; font?: string; bold?: boolean; italic?: boolean; letterSpacing?: number }): number {
    const config: IFontConfig = {
      font: element.font || 'SimSun',
      size: element.size || 16,
      bold: element.bold,
      italic: element.italic,
      letterSpacing: element.letterSpacing,
    }

    const text = element.value || ''
    const baseWidth = this.measureWidth(text, config)
    const spacing = config.letterSpacing || 0
    return baseWidth + spacing * Math.max(0, text.length - 1)
  }

  /**
   * 获取字体行高（近似值）
   */
  getLineHeight(config: IFontConfig): number {
    return config.size * 1.5
  }

  /**
   * 获取字体 ascent（基线以上高度，近似值）
   */
  getAscent(config: IFontConfig): number {
    return config.size * 0.8
  }

  /**
   * 获取字体 descent（基线以下高度，近似值）
   */
  getDescent(config: IFontConfig): number {
    return config.size * 0.2
  }

  clearCache(): void {
    this.cache.clear()
  }

  destroy(): void {
    this.clearCache()
  }
}

// 单例
export const textMeasurer = new TextMeasurer()
