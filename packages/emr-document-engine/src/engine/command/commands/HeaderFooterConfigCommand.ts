// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// SetHeaderFooterConfigCommand — 页眉页脚选项变更 (架构 §5, §7.3)
//
// differentFirstPage / differentOddEven 是文档属性 (canonical = DocumentTree),
// 变更必须走 Command 系统以支持 undo/redo/序列化。
// ================================================================

import type { HeaderFooterConfig } from '../../document/core/DocumentModel'
import { ICommand, CommandContext, StatePatch, SerializedCommand } from '../ICommand'

export class SetHeaderFooterConfigCommand implements ICommand {
  readonly type = 'set-header-footer-config'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  readonly patch: Partial<HeaderFooterConfig>
  /** forward 前的旧值快照 (供 invert 恢复) */
  private oldConfig: HeaderFooterConfig | null = null

  constructor(
    id: string, timestamp: number, author: string,
    patch: Partial<HeaderFooterConfig>,
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.patch = patch
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { doc } = ctx
    const current = doc.headerFooterConfig ?? { differentFirstPage: false, differentOddEven: false }
    this.oldConfig = { ...current }
    doc.headerFooterConfig = { ...current, ...this.patch }
    // 开关决定逐页生效的页眉/页脚变体 (契约 §7.9), 会改变带内容与带高
    // (→ 正文可用区), 故必须全量重排; 且需重绘使当前页立刻反映。
    return { invalidation: 'full' }
  }

  invert(): ICommand | null {
    if (!this.oldConfig) return null
    // 仅恢复被本次 patch 覆盖的字段到旧值
    const restore: Partial<HeaderFooterConfig> = {}
    for (const key of Object.keys(this.patch) as (keyof HeaderFooterConfig)[]) {
      restore[key] = this.oldConfig[key]
    }
    return new SetHeaderFooterConfigCommand(this.id, this.timestamp, this.author, restore)
  }

  serialize(): SerializedCommand {
    return {
      type: 'set-header-footer-config', id: this.id, timestamp: this.timestamp,
      author: this.author, changes: this.patch as Record<string, unknown>,
    }
  }
}
