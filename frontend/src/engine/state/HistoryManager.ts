// ============================================================
// 历史管理器 - 管理 Undo/Redo 操作栈
// ============================================================

import type { IElement } from '../document/DocumentModel'

export interface ZoneSnapshot {
  header: IElement[]
  main: IElement[]
  footer: IElement[]
}

interface HistorySnapshot {
  zones: ZoneSnapshot
  timestamp: number
}

export class HistoryManager {
  private undoStack: HistorySnapshot[] = []
  private redoStack: HistorySnapshot[] = []
  private maxRecords: number
  private currentZones: ZoneSnapshot

  constructor(maxRecords: number = 100) {
    this.maxRecords = maxRecords
    this.currentZones = { header: [], main: [], footer: [] }
  }

  /** Deep-clone a zone snapshot. */
  private clone(zones: ZoneSnapshot): ZoneSnapshot {
    return {
      header: JSON.parse(JSON.stringify(zones.header)),
      main: JSON.parse(JSON.stringify(zones.main)),
      footer: JSON.parse(JSON.stringify(zones.footer)),
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
    this.currentZones = this.clone(zones)
  }

  /**
   * Undo: return the previous snapshot of all three zones.
   */
  undo(): ZoneSnapshot | null {
    if (this.undoStack.length === 0) return null

    this.redoStack.push({
      zones: this.clone(this.currentZones),
      timestamp: Date.now(),
    })

    const snapshot = this.undoStack.pop()!
    this.currentZones = snapshot.zones
    return snapshot.zones
  }

  /**
   * Redo: restore the next snapshot of all three zones.
   */
  redo(): ZoneSnapshot | null {
    if (this.redoStack.length === 0) return null

    this.undoStack.push({
      zones: this.clone(this.currentZones),
      timestamp: Date.now(),
    })

    const snapshot = this.redoStack.pop()!
    this.currentZones = snapshot.zones
    return snapshot.zones
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
