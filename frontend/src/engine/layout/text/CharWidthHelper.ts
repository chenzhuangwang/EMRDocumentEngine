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
