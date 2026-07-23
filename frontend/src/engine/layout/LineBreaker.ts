// ============================================================
// 换行引擎 - CJK + 英文混排断行
// ============================================================

import type { IElement, ILine, IFontConfig } from '../document/DocumentModel'
import { ElementType } from '../document/DocumentModel'
import { TextMeasurer } from './TextMeasurer'

export interface LineBreakOptions {
  maxWidth: number
  wordBreak: 'break-all' | 'break-word' | 'keep-all'
  defaultFont: string
  defaultSize: number
}

export class LineBreaker {
  private measurer: TextMeasurer

  constructor(measurer: TextMeasurer) {
    this.measurer = measurer
  }

  /**
   * 将展开后的元素列表断行为多行
   */
  breakLines(elements: IElement[], options: LineBreakOptions): ILine[] {
    const lines: ILine[] = []
    let currentLineElements: IElement[] = []
    let currentLineWidth = 0
    let maxAscent = 0
    let maxDescent = 0

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i]
      if (!el) continue

      // 强制分页符 / 换行符
      if (el.type === ElementType.PAGE_BREAK) {
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

      if (el.type === ElementType.SEPARATOR) {
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

      const elWidth = this.getElementWidth(el, options)
      const ascent = el.size ? el.size * 0.8 : options.defaultSize * 0.8
      const descent = el.size ? el.size * 0.2 : options.defaultSize * 0.2

      // Newline character forces a line break (keep it in line for position tracking)
      if (el.type === ElementType.TEXT && el.value === '\n') {
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
  private getElementWidth(el: IElement, options: LineBreakOptions): number {
    switch (el.type) {
      case ElementType.TEXT:
      case ElementType.HYPERLINK: {
        const config = this.getElementFontConfig(el, options)
        return this.measurer.measureWidth(el.value || '', config)
      }

      case ElementType.CONTROL: {
        // 控件宽度：优先用配置宽度，否则默认 120px
        return el.control?.width || 120
      }

      case ElementType.IMAGE: {
        return el.imageData?.width || 100
      }

      case ElementType.TABLE: {
        // 表格占满行宽
        return options.maxWidth
      }

      case ElementType.LATEX: {
        return 200 // LaTeX 公式默认宽度
      }

      default:
        return 0
    }
  }

  private getElementFontConfig(el: IElement, options: LineBreakOptions): IFontConfig {
    return {
      font: el.font || options.defaultFont,
      size: el.size || options.defaultSize,
      bold: el.bold,
      italic: el.italic,
    }
  }

  private createLine(
    elements: IElement[],
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
