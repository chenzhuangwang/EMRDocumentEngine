// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// SetTableGrowableCommand — 切换「填写时可增长」开关 (契约 §12.9)
//
// Table.dynamicRows 是**文档内容** (表格的结构属性), 所以它的变更同样
// 必须走命令系统 (§5/§6), 不能由设计态 UI 直接 pool.updateNode。
//
// 只改行为开关, 不改结构也不改几何 → invalidation 'none' (表格的排版
// 结果不变; 追加行按钮是叠加在图上的 UI, 不参与回流)。
// ================================================================

import type { Table } from '../../document/core/DocumentModel'
import { NodeType } from '../../document/core/DocumentModel'
import type { CommandContext, ICommand, SerializedCommand, StatePatch } from '../ICommand'
import { generateCommandId } from '../ICommand'

export class SetTableGrowableCommand implements ICommand {
  readonly type = 'set-table-growable'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private tableId: string
  private growable: boolean
  /** forward 记录旧值, invert 据此还原 (undefined 与 false 都要还原对) */
  private previous: boolean | undefined

  constructor(
    id: string, timestamp: number, author: string,
    tableId: string, growable: boolean,
  ) {
    this.id = id
    this.timestamp = timestamp
    this.author = author
    this.tableId = tableId
    this.growable = growable
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    const table = pool.nodes.get(this.tableId) as Table | undefined
    if (!table || table.type !== NodeType.TABLE) return null

    this.previous = table.dynamicRows
    // 无实质变化 → 视为无操作, 不入 undo 栈 (与 applyControlConfig 的守卫同旨)
    if ((table.dynamicRows === true) === this.growable) return null

    // 关闭时写回 undefined 而非 false —— 让「缺失 = 固定表」这一约定
    // 在往返序列化后保持 (契约 §12.9: absent 表示固定表)
    pool.updateNode(this.tableId, {
      dynamicRows: this.growable ? true : undefined,
    } as Partial<Table>)

    return { invalidation: 'none' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    return new SetTableGrowableCommand(
      generateCommandId(), Date.now(), this.author,
      this.tableId, this.previous === true,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'set-table-growable', id: this.id, timestamp: this.timestamp,
      author: this.author, changes: { tableId: this.tableId, growable: this.growable },
    }
  }
}
