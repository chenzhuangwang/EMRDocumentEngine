// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// StateCommands — 光标/选区变更 (架构 §6.7, v20.34)
//
// 无文档副作用, 仅更新 EditorRuntimeState
// 唯一路径: Handler → SetCursorCommand → CommandManager.execute
// ================================================================

import type { CursorState, SelectionState } from '../../state/EditorRuntimeState'
import { ICommand, CommandContext, StatePatch, SerializedCommand } from '../ICommand'

export class SetCursorCommand implements ICommand {
  readonly type = 'set-cursor'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  readonly cursor: Partial<CursorState>

  constructor(id: string, timestamp: number, author: string, cursor: Partial<CursorState>) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.cursor = cursor
  }

  forward(_ctx: CommandContext): StatePatch | null {
    return { cursor: this.cursor }
  }

  invert(): ICommand | null { return null }

  serialize(): SerializedCommand {
    return {
      type: 'set-cursor', id: this.id, timestamp: this.timestamp,
      author: this.author, cursor: this.cursor as unknown as Record<string, unknown>,
    }
  }
}

export class SetSelectionCommand implements ICommand {
  readonly type = 'set-selection'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  readonly selection: Partial<SelectionState>

  constructor(id: string, timestamp: number, author: string, selection: Partial<SelectionState>) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.selection = selection
  }

  forward(_ctx: CommandContext): StatePatch | null {
    return { selection: this.selection }
  }

  invert(): ICommand | null { return null }

  serialize(): SerializedCommand {
    return {
      type: 'set-selection', id: this.id, timestamp: this.timestamp,
      author: this.author, selection: this.selection as unknown as Record<string, unknown>,
    }
  }
}
