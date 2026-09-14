// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ParagraphStyleCommand — 段落格式命令 (对齐/缩进/列表)
// v20.35: 支持多段落批量操作 + MergeableCommand 自动合并撤销
// ================================================================

import type { Paragraph, ParagraphStyle } from '../../document/core/DocumentModel'
import { ICommand, CommandContext, StatePatch, SerializedCommand, generateCommandId, type MergeableCommand } from '../ICommand'

export class ParagraphStyleCommand implements ICommand, MergeableCommand {
  readonly type = 'paragraph-style'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  readonly paraIds: string[]
  readonly changes: Partial<ParagraphStyle>
  private oldStyles = new Map<string, Partial<ParagraphStyle>>()

  constructor(
    id: string, timestamp: number, author: string,
    paraIds: string[], changes: Partial<ParagraphStyle>,
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.paraIds = paraIds; this.changes = changes
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    for (const paraId of this.paraIds) {
      const para = pool.nodes.get(paraId) as Paragraph | undefined
      if (!para) continue
      this.oldStyles.set(paraId, {
        alignment: para.alignment,
        indent: para.indent,
        firstLineIndent: para.firstLineIndent,
        lineHeight: para.lineHeight,
        list: para.list,
        outlineLevel: para.outlineLevel,
      })
      pool.updateNode(paraId, { ...this.changes } as Partial<Paragraph>)
    }
    return { invalidation: this.paraIds.length === 1 ? 'paragraph' : 'flowbody' }
  }

  invert(): ICommand | null {
    if (this.oldStyles.size === 0) return null
    // 逐段落恢复旧样式 — 每个段落创建独立命令, 由 mergeWith 在 500ms 内自动合并
    const ts = Date.now()
    const inverted: ParagraphStyleCommand[] = []
    for (const [paraId, oldStyle] of this.oldStyles) {
      inverted.push(new ParagraphStyleCommand(
        generateCommandId(), ts, this.author,
        [paraId], oldStyle,
      ))
    }
    // 手动合并为单命令 — 只需要第一个命令携带全部 oldStyles
    if (inverted.length === 1) return inverted[0]
    const merged = inverted[0]
    for (let i = 1; i < inverted.length; i++) {
      inverted[i].oldStyles.forEach((v, k) => merged.oldStyles.set(k, v))
      merged.paraIds.push(...inverted[i].paraIds)
    }
    return merged
  }

  // ---- MergeableCommand ----

  canMergeWith(other: ICommand): boolean {
    if (other.type !== 'paragraph-style') return false
    if (other.author !== this.author) return false
    return true
  }

  mergeWith(other: ICommand): ICommand {
    const o = other as ParagraphStyleCommand
    const merged = new ParagraphStyleCommand(
      this.id, this.timestamp, this.author,
      [...this.paraIds, ...o.paraIds],
      { ...this.changes },
    )
    this.oldStyles.forEach((v, k) => merged.oldStyles.set(k, v))
    o.oldStyles.forEach((v, k) => merged.oldStyles.set(k, v))
    return merged
  }

  serialize(): SerializedCommand {
    return {
      type: 'paragraph-style', id: this.id, timestamp: this.timestamp,
      author: this.author, paraIds: this.paraIds,
      changes: this.changes as Record<string, unknown>,
    }
  }
}
