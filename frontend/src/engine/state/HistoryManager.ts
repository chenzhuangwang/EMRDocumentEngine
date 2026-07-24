// ============================================================
// 历史管理器 - 管理 Undo/Redo 操作栈
// ============================================================

import type { IElement } from '../document/DocumentModel'
import { ZoneType } from '../document/DocumentModel'

export interface ZoneSnapshot {
  header: IElement[]
  main: IElement[]
  footer: IElement[]
  /** Zone-relative cursor index at the time of snapshot */
  cursorIndex: number
  /** Active zone at the time of snapshot */
  activeZone: ZoneType
}

interface HistorySnapshot {
  zones: ZoneSnapshot
  timestamp: number
}

export class HistoryManager {
  private undoStack: HistorySnapshot[] = []
  private redoStack: HistorySnapshot[] = []
  private maxRecords: number

  constructor(maxRecords: number = 100) {
    this.maxRecords = maxRecords
  }

  /** Deep-clone a zone snapshot (JSON-safe fields only). */
  private clone(zones: ZoneSnapshot): ZoneSnapshot {
    return {
      header: JSON.parse(JSON.stringify(zones.header)),
      main: JSON.parse(JSON.stringify(zones.main)),
      footer: JSON.parse(JSON.stringify(zones.footer)),
      cursorIndex: zones.cursorIndex,
      activeZone: zones.activeZone,
    }
  }

  /**
   * Save all three zones before an operation.
   */
  saveState(zones: ZoneSnapshot): void {
    this.undoStack.push({
      zones: this.clone(zones),
      timestamp: Date.now(),
    })

    if (this.undoStack.length > this.maxRecords) {
      this.undoStack.shift()
    }

    // New action invalidates the redo stack
    this.redoStack = []
  }

  /**
   * Undo: push the actual current state (post-mutation) to redo stack,
   * then return the previous snapshot from undo stack.
   */
  undo(actualState: ZoneSnapshot): ZoneSnapshot | null {
    if (this.undoStack.length === 0) return null

    // Push the ACTUAL post-mutation state so redo can restore it correctly
    this.redoStack.push({
      zones: this.clone(actualState),
      timestamp: Date.now(),
    })

    const snapshot = this.undoStack.pop()!
    return this.clone(snapshot.zones)
  }

  /**
   * Redo: push the actual current state (before redo) to undo stack,
   * then return the next snapshot from redo stack.
   */
  redo(actualState: ZoneSnapshot): ZoneSnapshot | null {
    if (this.redoStack.length === 0) return null

    // Push the ACTUAL current state so undo can return to it
    this.undoStack.push({
      zones: this.clone(actualState),
      timestamp: Date.now(),
    })

    const snapshot = this.redoStack.pop()!
    return this.clone(snapshot.zones)
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
}
