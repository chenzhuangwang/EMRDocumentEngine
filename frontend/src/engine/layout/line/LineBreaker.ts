// ============================================================
// 换行引擎 - CJK + 英文混排断行 (v5.0 / TASK-405)
//
// 增强: 中文避头尾规则 (kinsoku shori)
//   - 行头禁止字符: 不能出现在行首
//   - 行尾禁止字符: 不能出现在行尾
//   - 实现: 当断行点触发禁止规则时, 向前/后调整 1-2 字符
// ============================================================

import { TextMeasurer } from '../text/TextMeasurer'
import type { LineElement, FontConfig, LineBreakOptions, ILine } from './LineLayout'

// 重新导出类型 — 保持向后兼容 (外部 import { LineElement } from '../layout/line/LineBreaker' 仍然可用)
export type { LineElement, FontConfig, LineBreakOptions, ILine }

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

// 类型定义 (LineElement / FontConfig / LineBreakOptions / ILine) 已抽取至 ./LineLayout
// LineBreaker.ts 仅保留算法实现, 类型从 LineLayout.ts 导入

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
      const ascent = this.getElementAscent(el, options)
      const descent = this.getElementDescent(el, options)

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

      // ---- 折行判定: 文本元素优先按「剩余宽度」拆分, 避免节点边界整行下沉 ----
      let remainingW = options.maxWidth - currentLineWidth

      // 文本元素超出剩余空间 → 逐字拆分填充当前行 (CJK + Latin 混排)
      // 关键修复: 格式化把单节点拆成多节点后, 中段节点往往「窄于整行但宽于剩余空间」。
      // 若拆分只以「整行宽度」判定, 这类节点会被误判为放不下而整段换行,
      // 导致选区结束位置之后的文本被强制下沉、排版错位。
      if ((el.type === 'text' || el.type === 'smarttext' || el.type === 'hyperlink') &&
          elWidth > remainingW && (el.value || '').length > 0) {
        // 当前行已满 (剩余宽度 ≤ 0) → 先 flush, 再按整行宽度拆分
        if (remainingW <= 0 && currentLineElements.length > 0) {
          lines.push(this.createLine(currentLineElements, currentLineWidth, maxAscent, maxDescent))
          currentLineElements = []
          currentLineWidth = 0
          maxAscent = 0
          maxDescent = 0
          remainingW = options.maxWidth
        }

        const parts = this.splitTextElement(el, remainingW, options)

        // 第一部分: 填入当前行
        const head = parts[0]
        currentLineElements.push(head)
        currentLineWidth += this.getElementWidth(head, options)
        const hAscent = this.getElementAscent(head, options)
        const hDescent = this.getElementDescent(head, options)
        if (hAscent > maxAscent) maxAscent = hAscent
        if (hDescent > maxDescent) maxDescent = hDescent

        // 首段已填满当前行 → flush
        lines.push(this.createLine(currentLineElements, currentLineWidth, maxAscent, maxDescent))

        // 剩余部分: 除末段外每段各占一行 (末段留在行中, 供后续元素拼接)
        for (let p = 1; p < parts.length; p++) {
          const part = parts[p]
          currentLineElements = [part]
          currentLineWidth = this.getElementWidth(part, options)
          maxAscent = this.getElementAscent(part, options)
          maxDescent = this.getElementDescent(part, options)
          if (p < parts.length - 1) {
            lines.push(this.createLine(currentLineElements, currentLineWidth, maxAscent, maxDescent))
          }
        }
        continue
      }

      // 非文本元素 (image 等) 超出剩余空间 → 整行换行
      if (currentLineWidth + elWidth >= options.maxWidth && currentLineElements.length > 0) {
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
      const ascent = this.getElementAscent(el, options)
      const descent = this.getElementDescent(el, options)
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

  /** 元素 ascent (首行基线以上) — 多行控件 minRows 不影响首行 ascent */
  private getElementAscent(el: LineElement, options: LineBreakOptions): number {
    return el.size ? el.size * 0.8 : options.defaultSize * 0.8
  }

  /** 元素 descent — 多行控件 minRows>1 时向下延展 (N-1) 行, 使行高 = minRows * size (契约 §12.6.2 layer D) */
  private getElementDescent(el: LineElement, options: LineBreakOptions): number {
    const size = el.size || options.defaultSize
    const base = size * 0.2
    const minRows = el.control?.minRows
    if (typeof minRows === 'number' && minRows > 1) {
      return base + (minRows - 1) * size
    }
    return base
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

  /**
   * 将超宽文本元素按字符边界拆分, 返回适配当前行宽的部分 + 剩余部分
   *
   * 策略:
   *   1. 逐字符累加宽度, 找到不超出 remainingWidth 的最大字符数
   *   2. CJK 字符之间可任意断行; Latin 单词尽量在空格处断
   *   3. 避头尾: 断行点两侧不能是禁止字符
   *
   * @returns 拆分后的元素数组 (1个如果全放下, 2个以上如果需要多行)
   */
  private splitTextElement(
    el: LineElement,
    remainingWidth: number,
    options: LineBreakOptions,
  ): LineElement[] {
    const text = el.value || ''
    if (text.length === 0) return [el]

    const config = this.getElementFontConfig(el, options)
    const chars = [...text] // 按 Unicode 码点拆分, 正确处理 CJK

    // ---- 逐字累加宽度, 找断行点 ----
    let accWidth = 0
    let splitIdx = -1 // 断行点: 此行最后一个字符的 index (exclusive)

    for (let i = 0; i < chars.length; i++) {
      const charWidth = this.measurer.measureWidth(chars[i], config)
      if (accWidth + charWidth > remainingWidth) {
        // 当前字符会导致溢出 → 在此字符前断行
        break
      }
      accWidth += charWidth
      splitIdx = i
    }

    // 所有字符都放得下
    if (splitIdx === chars.length - 1) return [el]

    // 一个字符都放不下 → 至少放一个 (强制断行)
    if (splitIdx < 0) {
      const head: LineElement = { ...el, value: chars[0] }
      const tail: LineElement = { ...el, value: chars.slice(1).join('') }
      return [head, tail]
    }

    // ---- 优化断行点: Latin 单词在空格处断开 ----
    const rawSplitIdx = splitIdx
    // 向右扫描最近空格 (Latin 单词边界)
    const tailStart = splitIdx + 1
    for (let i = tailStart; i >= Math.max(0, tailStart - 20); i--) {
      const c = chars[i]
      if (c === ' ' && i <= rawSplitIdx + 5) {
        // 空格在附近: 空格留给上一行 (末尾空格), 下行从空格后开始
        // 但是如果空格本身会导致超出, 就不移动
        const spaceIdx = i
        let testW = 0
        for (let j = 0; j <= spaceIdx; j++) {
          testW += this.measurer.measureWidth(chars[j], config)
        }
        if (testW <= remainingWidth) {
          splitIdx = spaceIdx
        }
        break
      }
    }

    // ---- 避头尾: 行尾禁止字符 → 前移 ----
    for (let adjust = 0; adjust < 2; adjust++) {
      const lastChar = chars[splitIdx]
      const nextChar = chars[splitIdx + 1]
      if (!lastChar || !nextChar) break

      if (LINE_END_FORBIDDEN.has(lastChar) && splitIdx > 0) {
        splitIdx--
        continue
      }
      if (LINE_START_FORBIDDEN.has(nextChar) && splitIdx < chars.length - 2) {
        splitIdx++
        continue
      }
      break
    }

    // 确保至少断一个字符
    if (splitIdx < 0) splitIdx = 0
    if (splitIdx >= chars.length - 1) splitIdx = chars.length - 2

    // ---- 拆分为两部分 ----
    const headText = chars.slice(0, splitIdx + 1).join('')
    const tailText = chars.slice(splitIdx + 1).join('')

    const head: LineElement = { ...el, value: headText }
    const tail: LineElement = { ...el, value: tailText }

    // 如果剩余部分仍然超宽, 递归拆分
    const tailWidth = this.measurer.measureWidth(tailText, config)
    if (tailWidth > options.maxWidth) {
      const tailParts = this.splitTextElement(tail, options.maxWidth, options)
      return [head, ...tailParts]
    }

    return [head, tail]
  }
}
