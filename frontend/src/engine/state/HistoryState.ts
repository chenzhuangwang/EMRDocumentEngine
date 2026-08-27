// ================================================================
// HistoryState — 撤销/重做深度状态 (架构 §4.1, v20.34)
//
// 仅维护栈深度与可用性, 不持有命令本身 (命令栈归 CommandUndoRedoStack 维护)。
// 由 Editor 在 document:changed / undo:performed / redo:performed 后同步更新。
// ================================================================

export interface HistoryState {
  canUndo: boolean
  canRedo: boolean
  undoDepth: number
  redoDepth: number
}