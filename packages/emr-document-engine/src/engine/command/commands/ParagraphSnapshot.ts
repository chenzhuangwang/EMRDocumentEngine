// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ParagraphSnapshot — 段落整段快照 / 精确还原 (契约 §8.3 / §12.13)
//
// 有些删除不是"少了一段文字"可描述的:
//   - 范围触及非文本节点 (图片/域/控件) —— 文本反转重建不出来;
//   - 带修订留痕 —— 删除是把一个 TextNode 切成 before | 待删 | after,
//     纯文本反转还原不出切割与标记;
//   - 接受/拒绝修订 —— 既要删节点又要去标记, 还要保持段落非空。
// 它们的共同逆操作都是同一件事: **把段落恢复成动手之前的样子**。
//
// 因此一份实现: 动手前 captureParagraphSnapshot, 撤销时
// RestoreParagraphsCommand 逐段摘除现状、按快照重新注册节点并恢复顺序。
// 节点 id 全程保留 (§8.3 的判据: 带 id 的序列化逐字节相同)。
// ================================================================

import type { BaseNode, Paragraph } from '../../document/core/DocumentModel'
import type { NodePool } from '../../document/core/NodePool'
import type { CommandContext, ICommand, SerializedCommand, StatePatch } from '../ICommand'

/** 一段段落的完整子节点快照 (id 保留) */
export interface ParagraphSnapshot {
  paraId: string
  childIds: string[]
  nodes: BaseNode[]
}

function cloneNode(node: BaseNode): BaseNode {
  return JSON.parse(JSON.stringify(node)) as BaseNode
}

/** 动手前拍一张 (深拷贝但保留 id) */
export function captureParagraphSnapshot(pool: NodePool, para: Paragraph): ParagraphSnapshot {
  return {
    paraId: para.id,
    childIds: [...para.children],
    nodes: para.children
      .map(id => pool.nodes.get(id))
      .filter((n): n is BaseNode => !!n)
      .map(cloneNode),
  }
}

/**
 * 把若干段落恢复成快照。
 *
 * 只在 undo/redo 的逆操作里被临时 forward(), 不入栈, 故无需 invert。
 * 每次恢复都重新深拷贝: 池里放的必须是快照的副本, 否则下一次撤销拿到的是
 * 上一次恢复后的末态, 而不是"动手之前"的样子 (与 MintedNodes 同一手法)。
 */
export class RestoreParagraphsCommand implements ICommand {
  readonly type = 'restore-paragraphs'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private readonly snapshots: readonly ParagraphSnapshot[]

  constructor(
    id: string, timestamp: number, author: string,
    snapshots: readonly ParagraphSnapshot[],
  ) {
    this.id = id
    this.timestamp = timestamp
    this.author = author
    this.snapshots = snapshots
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    for (const snap of this.snapshots) {
      const para = pool.nodes.get(snap.paraId) as Paragraph | undefined
      if (!para) continue
      // 1. 摘除现状 (removeChild 会注销子树; 文本节点是叶子)
      for (let i = para.children.length - 1; i >= 0; i--) {
        pool.removeChild(snap.paraId, i)
      }
      // 2. 重新注册快照节点 (再深拷贝, 避免与快照共享引用)
      for (const n of snap.nodes) {
        if (!pool.nodes.has(n.id)) pool.addNode(cloneNode(n))
      }
      // 3. 恢复原始顺序
      para.children = [...snap.childIds]
    }
    return { invalidation: 'flowbody' }
  }

  invert(_ctx: CommandContext): ICommand | null { return null }

  serialize(): SerializedCommand {
    return {
      type: 'restore-paragraphs', id: this.id, timestamp: this.timestamp, author: this.author,
    }
  }
}
