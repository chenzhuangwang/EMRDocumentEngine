// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// UpdateDocumentPropertiesCommand — 文档级元数据变更 (契约 §7.7 / §7.8)
//
// 编辑 DocumentTree.metadata —— 仅改写文档级元数据 (DocumentMetadata),
// 不改文档内容 / 控件定义 / 控件运行时值, 不新建/删除节点。
//
// forward: 快照旧值 old → 整体替换 (next 为 undefined 或空对象 → delete
//           doc.metadata; 否则 doc.metadata = next)。
// invert:  复用自身 (同 UpdateControlDefinitionCommand): 逆操作恢复为 old
//           (old 为 undefined → delete; 否则赋回 old), 精确还原。
//
// 边界 (§7.8):
//   - 输入 next 必须已是合法 DocumentMetadata; 本命令「只改变状态」, 不负责
//     把任意 object 清洗/校验成 metadata —— 规范化在边界层 (UI / importer /
//     loader) 经 normalizeDocumentMetadata 完成。
//   - invalidation 'none': metadata 不参与布局 reflow, 仅经命令系统 markDirty
//     并随 DocumentTree.metadata 持久化 (§7.7)。
// ================================================================

import type { DocumentMetadata } from '../../document/core/DocumentModel'
import type { CommandContext, ICommand, SerializedCommand, StatePatch } from '../ICommand'
import { generateCommandId } from '../ICommand'

export class UpdateDocumentPropertiesCommand implements ICommand {
  readonly type = 'update-document-properties'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private next?: DocumentMetadata
  /** forward 时快照的旧值; null 表示「原本无 metadata」 */
  private old: DocumentMetadata | null = null

  constructor(
    id: string, timestamp: number, author: string,
    next?: DocumentMetadata,
  ) {
    this.id = id
    this.timestamp = timestamp
    this.author = author
    this.next = next
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { doc } = ctx

    this.old = doc.metadata ?? null
    const hasFields = !!this.next && Object.keys(this.next).length > 0
    if (hasFields) doc.metadata = this.next
    else delete doc.metadata

    return { invalidation: 'none' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    // 复用自身作为逆操作: 恢复为旧值 (old 为 null → delete; 否则赋回 old)
    return new UpdateDocumentPropertiesCommand(
      generateCommandId(), Date.now(), this.author,
      this.old ?? undefined,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'update-document-properties', id: this.id, timestamp: this.timestamp,
      author: this.author, changes: { metadata: this.next },
    }
  }
}
