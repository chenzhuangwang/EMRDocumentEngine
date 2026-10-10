// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// MacroCommand — 复合命令 (架构 RULE 11, §6.4)
//
// 将多条子命令合并为单个可撤销单元:
//   forward → 按序应用全部子命令, 聚合为一次 patch (invalidation: 'full')
//   invert  → 逆序反转全部子命令, 返回逆 MacroCommand
//
// 用途: 原子复合操作 (如 cut = 删除多条 DeleteRange/Merge 命令合并为
// 一个 undo 单元), 使单次用户操作对应单步 undo/redo。
//
// 子命令在 forward 期间各自填充快照 (deletedText 等), invert 复用该快照。
// ================================================================

import type { ICommand, CommandContext, StatePatch, SerializedCommand } from '../ICommand'
import { generateCommandId } from '../ICommand'

export class MacroCommand implements ICommand {
  readonly type = 'macro'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  readonly children: readonly ICommand[]

  constructor(id: string, timestamp: number, author: string, children: ICommand[]) {
    this.id = id
    this.timestamp = timestamp
    this.author = author
    this.children = children
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    let cursor: StatePatch['cursor']
    let selection: StatePatch['selection']
    let applied = false
    for (const child of this.children) {
      const patch = child.forward(ctx)
      if (!patch) continue
      applied = true
      if (patch.cursor) cursor = patch.cursor
      if (patch.selection) selection = patch.selection
    }
    if (!applied) return null
    // 复合命令跨多个节点/段落, 采用保守的 full 失效范围
    return { cursor, selection, invalidation: 'full' }
  }

  invert(ctx: CommandContext): ICommand | null {
    if (ctx.mode !== 'local') return null
    const inverses: ICommand[] = []
    for (let i = this.children.length - 1; i >= 0; i--) {
      const inv = this.children[i].invert?.(ctx)
      if (inv) inverses.push(inv)
    }
    if (inverses.length === 0) return null
    return new MacroCommand(generateCommandId(), Date.now(), this.author, inverses)
  }

  serialize(): SerializedCommand {
    return {
      type: 'macro', id: this.id, timestamp: this.timestamp, author: this.author,
      children: this.children.map((c) => c.serialize()),
    }
  }
}
