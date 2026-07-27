// ============================================================
// 键盘事件处理器
// ============================================================

import type { IElement } from '../document/DocumentModel'
import { ElementType, generateElementId } from '../document/DocumentModel'
import type { RangeManager } from '../state/RangeManager'

export interface KeyboardContext {
  elements: IElement[]
  cursorIndex: number
  onElementsChange: (elements: IElement[], cursorIndex: number, addHistory: boolean) => void
  rangeManager: RangeManager
  /** Get the character index on the previous/next line nearest to the given index's x. */
  getNeighborIndex: (currentIndex: number, lineDelta: number) => number
}

export class KeyboardHandler {
  private context: KeyboardContext
  private compositionActive: boolean = false

  constructor(context: KeyboardContext) {
    this.context = context
  }

  handleKeyDown(e: KeyboardEvent): boolean {
    // 输入法组合中，让 composition 事件处理
    if (this.compositionActive) {
      return e.key === 'Escape' || e.key === 'Enter'
    }

    const ctrl = e.ctrlKey || e.metaKey

    switch (e.key) {
      // ---- 导航 ----
      case 'ArrowLeft':
        this.moveCursor(-1, e.shiftKey)
        return true
      case 'ArrowRight':
        this.moveCursor(1, e.shiftKey)
        return true
      case 'ArrowUp':
        this.moveCursorLine(-1)
        return true
      case 'ArrowDown':
        this.moveCursorLine(1)
        return true
      case 'Home':
        this.moveCursorToLineStart()
        return true
      case 'End':
        this.moveCursorToLineEnd()
        return true

      // ---- 删除 ----
      case 'Backspace':
        this.deleteBeforeCursor()
        return true
      case 'Delete':
        this.deleteAfterCursor()
        return true

      // ---- 回车 ----
      case 'Enter':
        this.insertText('\n')
        return true

      // ---- Tab ----
      case 'Tab':
        this.insertText('\t')
        return true

      // ---- 快捷键 ----
      case 'z':
        if (ctrl) return false // undo → 外部处理
        break
      case 'y':
        if (ctrl) return false // redo → 外部处理
        break
      case 'b':
        if (ctrl) { this.toggleFormat('bold'); return true }
        break
      case 'i':
        if (ctrl) { this.toggleFormat('italic'); return true }
        break
      case 'u':
        if (ctrl) { this.toggleFormat('underline'); return true }
        break
      case 's':
        if (ctrl) return false // save → 外部处理
        break
      case 'a':
        if (ctrl) { this.selectAll(); return true }
        break
    }

    // Fallback: printable single characters (letters, digits, symbols)
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.insertText(e.key)
      return true
    }

    return false
  }

  handleTextInput(char: string): void {
    if (char && char.length >= 1) {
      this.insertText(char)
    }
  }

  // ---- 输入法 ----

  handleCompositionStart(): void {
    this.compositionActive = true
  }

  handleCompositionUpdate(_text: string): void {
    // composition text preview can be rendered here
  }

  handleCompositionEnd(text: string): void {
    this.compositionActive = false
    if (text) {
      this.insertText(text)
    }
  }

  isComposing(): boolean {
    return this.compositionActive
  }

  // ---- 光标移动 ----

  private moveCursor(delta: number, extendSelection: boolean = false): void {
    const newIndex = Math.max(0, Math.min(
      this.context.elements.length,
      this.context.cursorIndex + delta
    ))

    if (extendSelection) {
      if (!this.context.rangeManager.hasRange) {
        this.context.rangeManager.startDrag(this.context.cursorIndex)
      }
      this.context.rangeManager.extendTo(newIndex)
    } else {
      this.context.rangeManager.clear()
    }

    this.context.onElementsChange(this.context.elements, newIndex, false)
  }

  private moveCursorLine(delta: number): void {
    const newIndex = this.context.getNeighborIndex(this.context.cursorIndex, delta)
    this.context.rangeManager.clear()
    this.context.onElementsChange(this.context.elements, newIndex, false)
  }

  private moveCursorToLineStart(): void {
    // 简化实现：移动到最近的换行符后
    for (let i = this.context.cursorIndex - 1; i >= 0; i--) {
      const el = this.context.elements[i]
      if (el?.value === '\n') {
        this.context.onElementsChange(this.context.elements, i + 1, false)
        return
      }
    }
    this.context.onElementsChange(this.context.elements, 0, false)
  }

  private moveCursorToLineEnd(): void {
    for (let i = this.context.cursorIndex; i < this.context.elements.length; i++) {
      const el = this.context.elements[i]
      if (el?.value === '\n') {
        this.context.onElementsChange(this.context.elements, i, false)
        return
      }
    }
    this.context.onElementsChange(this.context.elements, this.context.elements.length, false)
  }

  // ---- 文本操作 ----

  private insertText(text: string): void {
    const elements = [...this.context.elements]
    let insertIndex = this.context.cursorIndex

    // 有选区 → 先删除选区内容，再在选区起点插入
    if (this.context.rangeManager.hasRange) {
      const start = this.context.rangeManager.start
      const end = this.context.rangeManager.end
      const before = elements.slice(0, start)
      const after = elements.slice(end)
      elements.length = 0
      elements.push(...before, ...after)
      insertIndex = start
    }

    this.context.rangeManager.clear()

    // 在光标位置插入
    const newElements: IElement[] = []
    const chars = [...text]

    for (const char of chars) {
      // 获取当前光标位置元素的样式
      const styleElement = insertIndex < elements.length && insertIndex > 0
        ? elements[insertIndex - 1]
        : elements[0]

      newElements.push({
        id: generateElementId(),
        type: ElementType.TEXT,
        value: char,
        font: styleElement?.font,
        size: styleElement?.size,
        bold: styleElement?.bold,
        italic: styleElement?.italic,
        underline: styleElement?.underline,
        color: styleElement?.color,
      })
    }

    const before = elements.slice(0, insertIndex)
    const after = elements.slice(insertIndex)
    const updated = [...before, ...newElements, ...after]

    this.context.onElementsChange(updated, insertIndex + chars.length, true)
  }

  private deleteBeforeCursor(): void {
    const elements = this.context.elements
    if (elements.length === 0) return

    // 有选区 → 删除选区内容
    if (this.context.rangeManager.hasRange) {
      this.deleteSelectedRange()
      return
    }

    this.context.rangeManager.clear()
    const idx = this.context.cursorIndex
    if (idx <= 0) return

    const before = elements.slice(0, idx - 1)
    const after = elements.slice(idx)
    this.context.onElementsChange([...before, ...after], idx - 1, true)
  }

  private deleteAfterCursor(): void {
    const elements = this.context.elements
    if (elements.length === 0) return

    // 有选区 → 删除选区内容
    if (this.context.rangeManager.hasRange) {
      this.deleteSelectedRange()
      return
    }

    this.context.rangeManager.clear()
    const idx = this.context.cursorIndex
    if (idx >= elements.length) return

    const before = elements.slice(0, idx)
    const after = elements.slice(idx + 1)
    this.context.onElementsChange([...before, ...after], idx, true)
  }

  /** 删除当前选中的内容 */
  private deleteSelectedRange(): void {
    const elements = this.context.elements
    const start = this.context.rangeManager.start
    const end = this.context.rangeManager.end

    // 先清除选区再触发渲染，否则渲染时会画出已删除内容的蓝色高亮
    this.context.rangeManager.clear()

    const before = elements.slice(0, start)
    const after = elements.slice(end)
    this.context.onElementsChange([...before, ...after], start, true)
  }

  // ---- 格式化 ----

  private toggleFormat(property: 'bold' | 'italic' | 'underline'): void {
    const elements = this.context.elements
    const idx = this.context.cursorIndex

    if (idx <= 0 || idx > elements.length) return

    const el = elements[idx - 1]
    const newEl = { ...el, [property]: !el[property] }

    const before = elements.slice(0, idx - 1)
    const after = elements.slice(idx)
    this.context.onElementsChange([...before, newEl, ...after], idx, true)
  }

  private selectAll(): void {
    const elements = this.context.elements
    if (elements.length === 0) return
    this.context.rangeManager.startDrag(0)
    this.context.rangeManager.extendTo(elements.length)
    this.context.rangeManager.endDrag()
    this.context.onElementsChange(elements, elements.length, false)
  }
}
