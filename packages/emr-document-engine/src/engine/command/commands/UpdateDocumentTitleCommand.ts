// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// UpdateDocumentTitleCommand — 文档标题变更 (契约 §7.7 / §7.8)
//
// 编辑 DocumentTree.title (顶级必填, 不属于 DocumentMetadata —— §7.7 明示
// "title is NOT metadata")。与 UpdateDocumentPropertiesCommand 平行:
// title 是文档级属性, 必须经命令修改, 不得由属性 UI 直改 DocumentModel。
//
// forward: 快照旧值 old → doc.title = next (整体替换; title 无删除语义,
//           空串也是合法标题)。
// invert:  复用自身, 逆操作恢复为 old, 精确还原。
//
// invalidation 'none': 标题属文档级元信息, 不参与正文布局 reflow, 与
// metadata (§7.7) 一致, 仅经命令系统 markDirty 并随 DocumentTree.title 持久化。
// ================================================================

import type { CommandContext, ICommand, SerializedCommand, StatePatch } from '../ICommand'
import { generateCommandId } from '../ICommand'

export class UpdateDocumentTitleCommand implements ICommand {
  readonly type = 'update-document-title'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private next: string
  /** forward 时快照的旧标题 */
  private old = ''

  constructor(id: string, timestamp: number, author: string, next: string) {
    this.id = id
    this.timestamp = timestamp
    this.author = author
    this.next = next
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { doc } = ctx
    this.old = doc.title
    doc.title = this.next
    return { invalidation: 'none' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    // 复用自身作为逆操作: 恢复为旧标题
    return new UpdateDocumentTitleCommand(
      generateCommandId(), Date.now(), this.author, this.old,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'update-document-title', id: this.id, timestamp: this.timestamp,
      author: this.author, changes: { title: this.next },
    }
  }
}
