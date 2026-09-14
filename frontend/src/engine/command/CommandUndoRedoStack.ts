// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// CommandUndoRedoStack — 命令驱动的撤销栈 (架构 §6.4, v20.34)
//
// 500ms 自动合并窗口 (InsertText/DeleteRange 同类操作)
// MacroCommand 事务支持
// 先 forward 成功后入栈 (避免异常污染栈)
// ================================================================

import type { ICommand, MergeableCommand, StatePatch, CommandContext } from './ICommand'

export class CommandUndoRedoStack {
  private undoStack: ICommand[] = []
  private redoStack: ICommand[] = []
  readonly maxDepth: number
  private readonly MERGE_WINDOW_MS = 500

  constructor(maxDepth = 100) {
    this.maxDepth = maxDepth
  }

  /** 执行命令 (v20.17: 先 forward 成功后入栈) */
  execute(command: ICommand, ctx: CommandContext): StatePatch | null {
    const patch = command.forward(ctx)
    if (!patch) return null

    const last = this.undoStack[this.undoStack.length - 1]
    if (last && this.canMerge(last, command)) {
      const merged = (last as MergeableCommand).mergeWith(command)
      this.undoStack[this.undoStack.length - 1] = merged
    } else {
      this.undoStack.push(command)
    }
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift()
    this.redoStack = []
    return patch
  }

  /** 撤销 — 从头走到尾, 对每个命令执行 invert */
  undo(ctx: CommandContext): StatePatch | null {
    const cmd = this.undoStack.pop()
    if (!cmd) return null
    if (!cmd.invert) return null
    const inverse = cmd.invert(ctx)
    if (!inverse) return null
    const patch = inverse.forward(ctx)
    this.redoStack.push(cmd)
    return patch
  }

  /** 重做 */
  redo(ctx: CommandContext): StatePatch | null {
    const cmd = this.redoStack.pop()
    if (!cmd) return null
    const patch = cmd.forward(ctx)
    if (!patch) return null
    this.undoStack.push(cmd)
    return patch
  }

  /**
   * 直接入栈, 不做 forward/merge (供事务提交: 子命令已各自 forward,
   * 此处仅将 MacroCommand 作为单个 undo 单元登记, 见 RULE 11)。
   */
  push(command: ICommand): void {
    this.undoStack.push(command)
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift()
    this.redoStack = []
  }

  canUndo(): boolean { return this.undoStack.length > 0 }
  canRedo(): boolean { return this.redoStack.length > 0 }
  getUndoDepth(): number { return this.undoStack.length }
  getRedoDepth(): number { return this.redoStack.length }

  private canMerge(last: ICommand, next: ICommand): boolean {
    if (last.type !== next.type) return false
    if (last.author !== next.author) return false
    if (next.timestamp - last.timestamp > this.MERGE_WINDOW_MS) return false
    if (!('canMergeWith' in last)) return false
    return (last as MergeableCommand).canMergeWith(next)
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }
}
