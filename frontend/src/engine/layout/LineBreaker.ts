// ============================================================
// 换行引擎 - CJK + 英文混排断行 (v5.0 / TASK-405)
//
// 增强: 中文避头尾规则 (kinsoku shori)
//   - 行头禁止字符: 不能出现在行首
//   - 行尾禁止字符: 不能出现在行尾
//   - 实现: 当断行点触发禁止规则时, 向前/后调整 1-2 字符
// ============================================================

import { TextMeasurer } from './TextMeasurer'

// ---- 中文避头尾字符集 ----

/** 行头禁止字符 — 不能出现在行首 */
const LINE_START_FORBIDDEN = new Set([
  // CJK 标点
  '）', '》', '〉', '」', '』', '】', '〗', '】', '〉', '》', '）',
  '。', '，', '、', '；', '：', '？', '！', '…', '—',
  // 全角标点
  '．', '，', '：', '；', '？', '！',
  // 半角标点 (后置)
  ')', ']', '}', '>',
  '.', ',', ';', ':', '?', '!',
  '%', '‰',
  // 全角右引号
  '’', // '
  '”', // "
  '、', // 、
  '。', // 。
  '）', // ）
  '，', // ，
  '．', // ．
  '：', // ：
  '；', // ；
  '？', // ？
  '！', // ！
  // CJK 兼容
  '〉', // 〉
  '》', // 》
  '」', // 」
  '』', // 』
  '】', // 】
  '〕', // 〕
  '〗', // 〗
])

/** 行尾禁止字符 — 不能出现在行尾 */
const LINE_END_FORBIDDEN = new Set([
  // CJK 标点
  '（', '《', '〈', '「', '『', '【', '〖',
  // 半角标点 (前置)
  '(', '[', '{', '<',
  // 全角左引号
  '‘', // '
  '“', // "
  '〈', // 〈
  '《', // 《
  '「', // 「
  '『', // 『
  '【', // 【
  '〔', // 〔
  '〖', // 〖
  '（', // （
])

// ---- 类型定义 ----
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
  strikeout?: boolean
  superscript?: boolean
  subscript?: boolean
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
  /** 列表标记文本 (首行), 由 Draw.ts 通过 ListParticle 渲染 */
  listMarker?: string
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

    // ---- 避头尾调整: 行头/行尾禁止字符处理 ----
    return this.applyKinsokuRules(lines, options)
  }

  /**
   * 应用中文避头尾规则 (kinsoku shori)
   *
   * 规则:
   *   1. 行头禁止: 若第 N+1 行首字符在 LINE_START_FORBIDDEN 中,
   *      从第 N 行末尾拉 1-2 个字符到第 N+1 行
   *   2. 行尾禁止: 若第 N 行末字符在 LINE_END_FORBIDDEN 中,
   *      将第 N 行末 1-2 个字符推到第 N+1 行行首
   *   3. 不可分割字符: 若断行点在 INSEPARABLE 字符前后,
   *      调整断行点
   *
   * 实现: 逐行后处理, 最多调整 2 个字符
   */
  private applyKinsokuRules(lines: ILine[], options: LineBreakOptions): ILine[] {
    if (lines.length <= 1) return lines

    for (let i = 0; i < lines.length - 1; i++) {
      const thisLine = lines[i]
      const nextLine = lines[i + 1]
      if (!thisLine || !nextLine) continue

      // 获取当前行最后一个和下一行第一个文本元素
      const lastEl = this.getLastTextElement(thisLine)
      const firstEl = this.getFirstTextElement(nextLine)

      if (!lastEl || !firstEl) continue

      const lastText = lastEl.value || ''
      const firstText = firstEl.value || ''

      // ---- 规则 1: 行头禁止 —— 下一行首字符不能出现在行首 ----
      if (firstText.length > 0 && LINE_START_FORBIDDEN.has(firstText[0])) {
        // 从当前行末尾拉 1 个字符到下一行行首
        const chars = [...firstText]
        const pullCount = this.computePullCount(chars, firstText, LINE_START_FORBIDDEN)

        if (pullCount > 0 && lastText.length > 0) {
          const pulled = lastText.slice(-pullCount)
          lastEl.value = lastText.slice(0, -pullCount)
          firstEl.value = pulled + firstText
          this.recalcLineMetrics(thisLine, options)
          this.recalcLineMetrics(nextLine, options)
        }
      }

      // ---- 规则 2: 行尾禁止 —— 当前行末字符不能出现在行尾 ----
      const updatedLastText = lastEl.value || ''
      if (updatedLastText.length > 0) {
        const lastChar = [...updatedLastText].pop()!
        if (LINE_END_FORBIDDEN.has(lastChar)) {
          // 将当前行末 1 个字符推到下一行行首
          const chars = [...updatedLastText]
          let pushCount = 1
          // 若倒数第二个也在行尾禁止集中, 也推过去
          if (chars.length >= 2 && LINE_END_FORBIDDEN.has(chars[chars.length - 2])) {
            pushCount = 2
          }
          const pushed = updatedLastText.slice(-pushCount)
          lastEl.value = updatedLastText.slice(0, -pushCount)
          firstEl.value = pushed + (firstEl.value || '')
          this.recalcLineMetrics(thisLine, options)
          this.recalcLineMetrics(nextLine, options)
        }
      }
    }

    // 清理行首字符全部被推走后的空行
    return lines.filter(line => {
      const elements = line.elements.filter(el => {
        if (el.type === 'text' || el.type === 'smarttext') {
          return (el.value || '').length > 0 || el.value === '​'
        }
        return true
      })
      if (elements.length === 0) return false
      line.elements = elements
      return true
    })
  }

  /** 获取行中第一个有文本内容的元素 */
  private getFirstTextElement(line: ILine): LineElement | null {
    return line.elements.find(el =>
      (el.type === 'text' || el.type === 'smarttext') && (el.value || '').length > 0
    ) ?? null
  }

  /** 获取行中最后一个有文本内容的元素 */
  private getLastTextElement(line: ILine): LineElement | null {
    for (let i = line.elements.length - 1; i >= 0; i--) {
      const el = line.elements[i]
      if ((el?.type === 'text' || el?.type === 'smarttext') && (el.value || '').length > 0) {
        return el
      }
    }
    return null
  }

  /** 计算需要从上一行拉到当前行的字符数 */
  private computePullCount(chars: string[], _text: string, forbiddenSet: Set<string>): number {
    let count = 0
    for (let i = 0; i < Math.min(2, chars.length); i++) {
      if (forbiddenSet.has(chars[i])) count++
      else break
    }
    return Math.min(count, 2)
  }

  /** 重新计算行的宽度和高度 */
  private recalcLineMetrics(line: ILine, options: LineBreakOptions): void {
    let width = 0
    let maxAscent = 0
    let maxDescent = 0

    for (const el of line.elements) {
      if (el.type === 'page_break' || el.value === '​') continue
      const elWidth = this.getElementWidth(el, options)
      width += elWidth
      const ascent = el.size ? el.size * 0.8 : options.defaultSize * 0.8
      const descent = el.size ? el.size * 0.2 : options.defaultSize * 0.2
      if (ascent > maxAscent) maxAscent = ascent
      if (descent > maxDescent) maxDescent = descent
    }

    line.width = width
    line.maxAscent = maxAscent
    line.maxDescent = maxDescent
    line.height = maxAscent + maxDescent
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
