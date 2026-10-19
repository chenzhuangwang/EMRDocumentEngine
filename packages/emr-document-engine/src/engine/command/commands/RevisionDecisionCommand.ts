// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// RevisionDecisionCommand — 接受 / 拒绝修订 (契约 §12.13)
//
// 四种组合:
//   accept insert → 去掉标记, 文字留下
//   reject insert → 删除该文字节点
//   accept delete → 删除该文字节点
//   reject delete → 去掉标记, 文字留下 (恢复原状)
//   modify        → 两种决定都只去标记 (保留类型, 本批无生产者)
//
// 为什么必须是命令: 接受/拒绝改变的是**文档内容**, 与编辑同权 —— 必须可撤销、
// 必须走 CommandManager 的失效传播, 不得直接改池。
//
// 逆操作一律整段快照还原 (RestoreParagraphsCommand): 本命令既可能删节点、
// 又可能只去标记, 纯文本反转描述不了。
//
// 全文档遍历走**受认可的两个脊柱** (契约 §31): bodyParagraphSpine 与
// hfParagraphsForExport — 绝不直接碰 doc.body.children。
// ================================================================

import type { DocumentTree, Paragraph, TextNode } from '../../document/core/DocumentModel'
import type { NodePool } from '../../document/core/NodePool'
import { bodyParagraphSpine } from '../../document/selection/SelectionCollector'
import { hfContainers } from '../../document/core/HeaderFooterRegions'
import { createTextNode } from '../../document/factory/ElementFormatter'
import type { CommandContext, ICommand, SerializedCommand, StatePatch } from '../ICommand'
import { generateCommandId } from '../ICommand'
import { normalizeParagraph } from './ParagraphUtils'
import { MintedOnce } from './MintedNodes'
import {
  captureParagraphSnapshot, RestoreParagraphsCommand,
  type ParagraphSnapshot,
} from './ParagraphSnapshot'

export type RevisionDecision = 'accept' | 'reject'

/** 作用范围: 全文档, 或指定的一组文字节点 (逐处接受/拒绝) */
export type RevisionTarget = { kind: 'all' } | { kind: 'nodes'; nodeIds: readonly string[] }

export class RevisionDecisionCommand implements ICommand {
  readonly type = 'revision-decision'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private readonly decision: RevisionDecision
  private readonly target: RevisionTarget
  private _snapshots: ParagraphSnapshot[] = []
  private _decided = 0
  /** 铸造一次 (契约 §8.3): 拒插后段落变空时补的空文本节点在 redo 复用同一 id */
  private mint = new MintedOnce()

  constructor(
    id: string, timestamp: number, author: string,
    decision: RevisionDecision, target: RevisionTarget,
  ) {
    this.id = id
    this.timestamp = timestamp
    this.author = author
    this.decision = decision
    this.target = target
  }

  /** forward 后读取实际处理的节点数 (0 = 没有可处理的修订) */
  get decided(): number { return this._decided }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, doc } = ctx

    // ---- 1. 目标节点 → 所属段落 ----
    const byPara = new Map<string, string[]>()
    const wanted = this.target.kind === 'nodes' ? new Set(this.target.nodeIds) : null
    for (const paraId of this.paragraphIds(doc, pool)) {
      const para = pool.nodes.get(paraId) as Paragraph | undefined
      if (!para) continue
      for (const childId of para.children) {
        if (wanted && !wanted.has(childId)) continue
        const node = pool.nodes.get(childId) as TextNode | undefined
        if (!node || node.type !== 'text' || !node.revision) continue
        const arr = byPara.get(paraId)
        if (arr) arr.push(childId)
        else byPara.set(paraId, [childId])
      }
    }
    if (byPara.size === 0) { this._decided = 0; return null }

    // ---- 2. 逐段动手 (先快照; 删除按索引降序, 避免下标漂移) ----
    this._snapshots = []
    this._decided = 0
    for (const [paraId, nodeIds] of byPara) {
      const para = pool.nodes.get(paraId) as Paragraph | undefined
      if (!para) continue
      this._snapshots.push(captureParagraphSnapshot(pool, para))

      const remove = new Set<string>()
      for (const nodeId of nodeIds) {
        const node = pool.nodes.get(nodeId) as TextNode | undefined
        if (!node?.revision) continue
        this._decided++
        const removeIt =
          (node.revision.type === 'insert' && this.decision === 'reject') ||
          (node.revision.type === 'delete' && this.decision === 'accept')
        if (removeIt) remove.add(nodeId)
        else pool.deleteNodeField(nodeId, 'revision')
      }

      if (remove.size > 0) {
        for (let i = para.children.length - 1; i >= 0; i--) {
          if (remove.has(para.children[i])) pool.removeChild(paraId, i)
        }
        // 段落不能空 (与 DeleteRange 同一底线): 补一个空文字节点可继续输入
        if (para.children.length === 0) {
          const [emptyId] = this.mint.run(pool, () => {
            const n = createTextNode('')
            pool.addNode(n)
            return [n.id]
          })
          para.children = [emptyId]
        }
      }
      normalizeParagraph(para, pool)
    }

    return { invalidation: 'flowbody' }
  }

  invert(ctx: CommandContext): ICommand | null {
    if (ctx.mode !== 'local') return null
    if (this._snapshots.length === 0) return null
    return new RestoreParagraphsCommand(
      generateCommandId(), Date.now(), this.author, this._snapshots,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'revision-decision', id: this.id, timestamp: this.timestamp, author: this.author,
      changes: { decision: this.decision, target: this.target },
    }
  }

  /**
   * 全文档段落 (契约 §31 的受认可脊柱; 含表格 cell 与**全部**页眉页脚变体)。
   *
   * 页眉页脚用 hfContainers 而不是 hfParagraphsForExport: 后者是**导出投影**,
   * 每个区域只取一个变体 —— 用它会让首屏/偶数页变体里的修订永远处理不到
   * (逐页变体见 §7.9)。这里要的是"全部容器"。
   */
  private paragraphIds(doc: DocumentTree, pool: NodePool): readonly string[] {
    const ids = new Set<string>(bodyParagraphSpine(doc, pool as never))
    for (const arr of hfContainers(doc)) {
      for (const id of arr) ids.add(id)
    }
    return [...ids]
  }
}
