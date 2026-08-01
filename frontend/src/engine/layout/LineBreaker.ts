// ============================================================
// 换行引擎 - CJK + 英文混排断行
// ============================================================

import { TextMeasurer } from './TextMeasurer'

/** 换行器输入元素的简化接口 */
export interface LineElement {
  id: string
  type: string
  value: string
  font?: string
  size?: number
  bold?: boolean
  italic?: boolean
  color?: string
  underline?: boolean
  imageData?: { width?: number; height?: number; wrapType?: string }
  control?: { width?: number }
}

export interface FontConfig {
  font: string
  size: number
  bold?: boolean
  italic?: boolean
  letterSpacing?: number
}

export interface LineBreakOptions {
  maxWidth: number
  wordBreak: 'break-all' | 'break-word' | 'keep-all'
  defaultFont: string
  defaultSize: number
}

export interface ILine {
  elements: LineElement[]
  width: number
  height: number
  maxAscent: number
  maxDescent: number
  alignment?: 'left' | 'center' | 'right' | 'justify'
  indent?: number
}

export class LineBreaker {
  private measurer: TextMeasurer

  constructor(measurer: TextMeasurer) {
    this.measurer = measurer
  }

  /**
   * 将展开后的元素列表断行为多行
   */
  breakLines(elements: LineElement[], options: LineBreakOptions): ILine[] {
    const lines: ILine[] = []
    let currentLineElements: LineElement[] = []
    let currentLineWidth = 0
    let maxAscent = 0
    let maxDescent = 0

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i]
      if (!el) continue

      // 强制分页符 / 换行符
      if (el.type === 'page_break') {
        if (currentLineElements.length > 0) {
          lines.push(this.createLine(currentLineElements, currentLineWidth, maxAscent, maxDescent))
          currentLineElements = []
          currentLineWidth = 0
          maxAscent = 0
          maxDescent = 0
        }
        // 分页符作为独立空行
        lines.push(this.createLine([el], 0, options.defaultSize * 0.8, options.defaultSize * 0.2))
        continue
      }

      if (el.type === 'separator') {
        if (currentLineElements.length > 0) {
          lines.push(this.createLine(currentLineElements, currentLineWidth, maxAscent, maxDescent))
          currentLineElements = []
          currentLineWidth = 0
          maxAscent = 0
          maxDescent = 0
        }
        // 分隔线占据一行
        const lineHeight = el.size || options.defaultSize
        lines.push(this.createLine([el], options.maxWidth, lineHeight * 0.4, lineHeight * 0.1))
        continue
      }

      // Image: block-level by default (wrapType !== 'inline' → own line)
      if (el.type === 'image' && el.imageData?.wrapType !== 'inline') {
        if (currentLineElements.length > 0) {
          lines.push(this.createLine(currentLineElements, currentLineWidth, maxAscent, maxDescent))
          currentLineElements = []
          currentLineWidth = 0
          maxAscent = 0
          maxDescent = 0
        }
        const imgW = el.imageData?.width || 100
        const imgH = el.imageData?.height || 100
        lines.push(this.createLine([el], imgW, imgH * 0.8, imgH * 0.2))
        continue
      }

      const elWidth = this.getElementWidth(el, options)
      const ascent = el.size ? el.size * 0.8 : options.defaultSize * 0.8
      const descent = el.size ? el.size * 0.2 : options.defaultSize * 0.2

      // Newline character forces a line break (keep it in line for position tracking)
      if (el.type === 'text' && el.value === '\n') {
        currentLineElements.push(el)
        // Use default line metrics when current line has no visible content (consecutive \n)
        const lineAscent = maxAscent > 0 ? maxAscent : options.defaultSize * 0.8
        const lineDescent = maxDescent > 0 ? maxDescent : options.defaultSize * 0.2
        lines.push(this.createLine(currentLineElements, currentLineWidth, lineAscent, lineDescent))
        currentLineElements = []
        currentLineWidth = 0
        maxAscent = 0
        maxDescent = 0
        continue
      }

      if (currentLineWidth + elWidth > options.maxWidth && currentLineElements.length > 0) {
        lines.push(this.createLine(currentLineElements, currentLineWidth, maxAscent, maxDescent))
        currentLineElements = []
        currentLineWidth = 0
        maxAscent = 0
        maxDescent = 0
      }

      // 零宽字符（占位用）— 保留在行中用于光标位置跟踪，但不占宽度
      if (el.value === '​') {
        currentLineElements.push(el)
        continue
      }

      currentLineElements.push(el)
      currentLineWidth += elWidth
      if (ascent > maxAscent) maxAscent = ascent
      if (descent > maxDescent) maxDescent = descent
    }

    // 处理最后一行
    if (currentLineElements.length > 0) {
      lines.push(this.createLine(currentLineElements, currentLineWidth, maxAscent, maxDescent))
    }

    return lines
  }

  /**
   * 计算元素渲染宽度
   */
  private getElementWidth(el: LineElement, options: LineBreakOptions): number {
    switch (el.type) {
      case 'text':
      case 'hyperlink': {
        const config = this.getElementFontConfig(el, options)
        return this.measurer.measureWidth(el.value || '', config)
      }

      case 'control': {
        return el.control?.width || 120
      }
      case 'image': {
        return el.imageData?.width || 100
      }
      case 'table': {
        return options.maxWidth
      }
      case 'latex': {
        return 200 // LaTeX 公式默认宽度
      }

      default:
        return 0
    }
  }

  private getElementFontConfig(el: LineElement, options: LineBreakOptions): FontConfig {
    return {
      font: el.font || options.defaultFont,
      size: el.size || options.defaultSize,
      bold: el.bold,
      italic: el.italic,
    }
  }

  private createLine(
    elements: LineElement[],
    width: number,
    maxAscent: number,
    maxDescent: number
  ): ILine {
    return {
      elements,
      width,
      height: maxAscent + maxDescent,
      maxAscent,
      maxDescent,
    }
  }
}
