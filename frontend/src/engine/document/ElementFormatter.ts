// ============================================================
// 词法分析器 - 将 IElement[] 展开为可排版的原子单位
// ============================================================

import { ElementType } from '../document/DocumentModel'
import type { IElement } from '../document/DocumentModel'
import { generateElementId } from '../document/DocumentModel'

/**
 * 格式化元素列表：
 * 1. 为没有 ID 的元素生成 ID
 * 2. 注入零宽字符用于光标锚定
 * 3. 确保文档至少有一个元素
 */
export function formatElementList(elements: IElement[]): IElement[] {
  if (elements.length === 0) {
    return [{ id: generateElementId(), type: ElementType.TEXT, value: '' }]
  }
  return elements.map(el => ({
    ...el,
    id: el.id || generateElementId(),
  }))
}

/**
 * 将元素列表展开（拆分多字符为单字符）
 */
export function unzipElementList(elements: IElement[]): IElement[] {
  const result: IElement[] = []

  for (const el of elements) {
    switch (el.type) {
      case ElementType.TEXT:
      case ElementType.HYPERLINK: {
        const chars = [...el.value]
        if (chars.length === 0) {
          // 空文本元素保留一个零宽字符
          result.push({ ...el, id: el.id || generateElementId(), value: '​' })
        } else {
          chars.forEach((char, idx) => {
            result.push({
              ...el,
              id: idx === 0 ? (el.id || generateElementId()) : generateElementId(),
              value: char,
            })
          })
        }
        break
      }
      case ElementType.PAGE_BREAK:
      case ElementType.SEPARATOR:
      case ElementType.TABLE:
      case ElementType.IMAGE:
      case ElementType.CONTROL:
      case ElementType.LATEX:
        result.push({ ...el, id: el.id || generateElementId() })
        break
      default:
        result.push({ ...el, id: el.id || generateElementId() })
    }
  }

  return result
}

/**
 * 将展开的元素列表压缩回原始结构（合并相邻同样式元素）
 */
export function zipElementList(elements: IElement[]): IElement[] {
  if (elements.length === 0) return []

  const result: IElement[] = []
  let current = { ...elements[0] }

  for (let i = 1; i < elements.length; i++) {
    const el = elements[i]

    if (canMerge(current, el)) {
      current.value += el.value
    } else {
      result.push(current)
      current = { ...el }
    }
  }

  result.push(current)
  return result
}

/**
 * 判断两个元素是否可以合并
 */
function canMerge(a: IElement, b: IElement): boolean {
  return (
    a.type === b.type &&
    a.type === ElementType.TEXT &&
    a.font === b.font &&
    a.size === b.size &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.underlineStyle === b.underlineStyle &&
    a.strikeout === b.strikeout &&
    a.color === b.color &&
    a.highlight === b.highlight &&
    a.superscript === b.superscript &&
    a.subscript === b.subscript &&
    a.rowFlex === b.rowFlex &&
    a.rowMargin === b.rowMargin &&
    a.lineHeight === b.lineHeight &&
    a.indent === b.indent
  )
}
