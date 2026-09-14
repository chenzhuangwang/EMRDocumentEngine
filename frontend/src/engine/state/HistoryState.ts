// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

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