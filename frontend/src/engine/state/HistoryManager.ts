// ============================================================
// 历史管理器 - 管理 Undo/Redo 操作栈
// ============================================================

import type { IElement } from '../document/DocumentModel'

interface HistorySnapshot {
  elements: IElement[]
  timestamp: number
}

export class HistoryManager {
  private undoStack: HistorySnapshot[] = []
  private redoStack: HistorySnapshot[] = []
  private maxRecords: number
  private currentElements: IElement[] = []

  constructor(maxRecords: number = 100) {
    this.maxRecords = maxRecords
  }

  /**
   * 在执行操作前保存当前状态
   */
  saveState(elements: IElement[]): void {
    this.undoStack.push({
      elements: JSON.parse(JSON.stringify(elements)),
      timestamp: Date.now(),
    })

    // 限制栈大小
    if (this.undoStack.length > this.maxRecords) {
      this.undoStack.shift()
    }

    // 清空 redo 栈（新操作使之前的 redo 无效）
    this.redoStack = []
    this.currentElements = JSON.parse(JSON.stringify(elements))
  }

  /**
   * 撤销：回到上一个状态
   */
  undo(): IElement[] | null {
    if (this.undoStack.length === 0) return null

    // 保存当前状态到 redo 栈
    this.redoStack.push({
      elements: JSON.parse(JSON.stringify(this.currentElements)),
      timestamp: Date.now(),
    })

    const snapshot = this.undoStack.pop()!
    this.currentElements = snapshot.elements
    return snapshot.elements
  }

  /**
   * 重做：恢复到撤销前的状态
   */
  redo(): IElement[] | null {
    if (this.redoStack.length === 0) return null

    // 保存当前状态到 undo 栈
    this.undoStack.push({
      elements: JSON.parse(JSON.stringify(this.currentElements)),
      timestamp: Date.now(),
    })

    const snapshot = this.redoStack.pop()!
    this.currentElements = snapshot.elements
    return snapshot.elements
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  getUndoCount(): number {
    return this.undoStack.length
  }

  getRedoCount(): number {
    return this.redoStack.length
  }

  clearHistory(): void {
    this.undoStack = []
    this.redoStack = []
  }

  setCurrentElements(elements: IElement[]): void {
    this.currentElements = elements
  }
}
