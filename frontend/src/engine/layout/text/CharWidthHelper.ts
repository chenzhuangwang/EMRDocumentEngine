// ============================================================
// CharWidthHelper — 逐字符累积宽度, 用于光标/选区精确定位
//
// 替代各处的 uniform charW = bodyW / textLen,
// 正确区分半角字符 (ASCII/数字) 与全角字符 (CJK) 的不同像素宽度。
// ============================================================

import type { TextMeasurer } from './TextMeasurer'

export interface CharWidthConfig {
  font: string
  size: number
  bold?: boolean
  italic?: boolean
}

/**
 * 计算文本逐字符累积宽度数组。
 * result[i] = 字符 0..i (含) 的累积像素宽度 (即字符 i 的右边缘位置)。
 * 返回长度与 text 字符数相同; 空文本返回空数组。
 */
export function cumulativeCharWidths(text: string, config: CharWidthConfig, measurer: TextMeasurer): number[] {
  if (!text) return []
  const result: number[] = []
  let cum = 0
  for (const char of text) {
    cum += measurer.measure(char, config).width
    result.push(cum)
  }
  return result
}

/**
 * 给定像素偏移 relativeX (相对于 item.x), 找到对应的字符索引。
 * 返回 character index (0..text.length)。
 * relativeX <= 0 → 返回 0
 * relativeX >= 总宽度 → 返回 text.length
 */
export function findCharIndexAtX(relativeX: number, cumWidths: number[], textLen: number): number {
  if (relativeX <= 0) return 0
  for (let i = 0; i < cumWidths.length; i++) {
    if (relativeX <= cumWidths[i]) {
      // 判断更靠近 i 左边缘还是 i+1 左边缘
      const leftEdge = i > 0 ? cumWidths[i - 1] : 0
      const mid = (leftEdge + cumWidths[i]) / 2
      return relativeX <= mid ? i : i + 1
    }
  }
  return textLen
}

/**
 * 计算 text[0..offset) 的累积像素宽度。
 */
export function cumulativeWidthUpTo(text: string, offset: number, config: CharWidthConfig, measurer: TextMeasurer): number {
  if (offset <= 0 || !text) return 0
  const cum = cumulativeCharWidths(text, config, measurer)
  if (offset >= cum.length) return cum.length > 0 ? cum[cum.length - 1] : 0
  return offset > 0 ? cum[offset - 1] : 0
}

/** 命中检测所需的最小子集 — 与 SLIFItem 结构兼容 (结构性子类型) */
export interface OffsetHitItem {
  text?: string
  x: number
  y: number
  width: number
  ascent: number
  descent: number
  markerWidth?: number
  font?: string
  size?: number
  bold?: boolean
  italic?: boolean
}

/**
 * 在一组已按文档顺序排列的行内 text item 中, 由点击坐标 (docX, docY)
 * 反查字符偏移。items 必须已过滤为同一段落且保持 layout 顺序。
 *
 * 逐 item 累积文本长度: 同一行内可能包含多个 text item (局部选区格式化
 * 会拆分 TextNode), 故点击落在某 item 右边界之外时必须继续检查后续 item,
 * 而非提前返回, 否则行尾点击会被错误截断到首个 item 末尾 (无法把光标
 * 定位到文字最后)。
 */
export function computeOffsetInItems(
  items: readonly OffsetHitItem[],
  docX: number,
  docY: number,
  measurer: TextMeasurer,
): number {
  let accumulated = 0
  for (const item of items) {
    const itemText = item.text || ''
    const bodyW = item.markerWidth != null ? item.width - item.markerWidth : item.width
    const yHit = docY >= item.y && docY <= item.y + item.ascent + item.descent
    if (yHit) {
      if (docX < item.x) return accumulated
      if (docX <= item.x + bodyW) {
        const relativeX = docX - item.x
        const cumWidths = cumulativeCharWidths(itemText, {
          font: item.font || 'SimSun', size: item.size || 16,
          bold: item.bold, italic: item.italic,
        }, measurer)
        const charIdx = findCharIndexAtX(relativeX, cumWidths, itemText.length)
        return Math.max(0, accumulated + charIdx)
      }
      // 点击落在当前 item 右边界之外 — 继续检查下一 item
    }
    accumulated += itemText.length
  }
  return Math.max(0, accumulated)
}

