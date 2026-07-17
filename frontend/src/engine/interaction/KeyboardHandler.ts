// ============================================================
// 键盘事件处理器
// ============================================================

import type { IElement } from '../document/DocumentModel'
import { ElementType, generateElementId } from '../document/DocumentModel'

export interface KeyboardContext {
  elements: IElement[]
  cursorIndex: number
  onElementsChange: (elements: IElement[], cursorIndex: number, addHistory: boolean) => void
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
        if (ctrl && !e.shiftKey) return false // undo → 外部处理
        if (ctrl && e.shiftKey) return false   // redo → 外部处理
        return false
      case 'y':
        if (ctrl) return false
        return false
      case 'b':
        if (ctrl) { this.toggleFormat('bold'); return true }
        return false
      case 'i':
        if (ctrl) { this.toggleFormat('italic'); return true }
        return false
      case 'u':
        if (ctrl) { this.toggleFormat('underline'); return true }
        return false
      case 's':
        if (ctrl) return false // save → 外部处理
        return false
      case 'a':
        if (ctrl) { this.selectAll(); return true }
        return false
    }

    return false
  }

  handleTextInput(char: string): void {
    if (char && char.length === 1 && !char.match(/[\x00-\x1F]/)) {
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

  // ---- 光标移动 ----

  private moveCursor(delta: number, extendSelection: boolean = false): void {
    const newIndex = Math.max(0, Math.min(
      this.context.elements.length,
      this.context.cursorIndex + delta
    ))

    if (extendSelection) {
      // 扩展选区模式
      this.context.onElementsChange(this.context.elements, newIndex, false)
    } else {
      this.context.onElementsChange(this.context.elements, newIndex, false)
    }
  }

  private moveCursorLine(delta: number): void {
    // 简化为移动固定数量的元素
    const charsPerLine = 40
    this.moveCursor(delta * charsPerLine)
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
    const insertIndex = this.context.cursorIndex

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
    const idx = this.context.cursorIndex

    if (idx <= 0 || elements.length === 0) return

    const before = elements.slice(0, idx - 1)
    const after = elements.slice(idx)
    this.context.onElementsChange([...before, ...after], idx - 1, true)
  }

  private deleteAfterCursor(): void {
    const elements = this.context.elements
    const idx = this.context.cursorIndex

    if (idx >= elements.length || elements.length === 0) return

    const before = elements.slice(0, idx)
    const after = elements.slice(idx + 1)
    this.context.onElementsChange([...before, ...after], idx, true)
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
    this.context.onElementsChange([...before, newEl, ...after], idx, false)
  }

  private selectAll(): void {
    // 选区支持需要 RangeManager，此处为简化实现
  }
}
