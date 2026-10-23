// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// MergeParagraphCommand — 退格并段 (架构 §6.6, v20.34)
//
// forward: 当前段 children 追加到上一段 → 合并 → 删除当前段
// invert:  子树快照式 — forward 前深拷贝前后两段子树, 撤销时整体重建
// ================================================================

import type { Paragraph, BaseNode } from '../../document/core/DocumentModel'
import type { NodePool } from '../../document/core/NodePool'
import { ICommand, CommandContext, StatePatch, SerializedCommand, PositionalCommand, generateCommandId } from '../ICommand'
import { mergeSeamRuns } from './ParagraphUtils'
import { resolveParagraphRegion, isPoolRegion } from '../../state/CaretScope'

// ---- 子树快照工具 (JSON 深拷贝, 与 takeSnapshot/restoreSnapshot 一致) ----

function cloneNode<T>(node: T): T {
  return JSON.parse(JSON.stringify(node)) as T
}

/** 深拷贝 rootId 子树 (含 root 自身 + 全部后代) 到 id → node Map */
function captureSubtree(pool: NodePool, rootId: string): Map<string, BaseNode> {
  const snapshot = new Map<string, BaseNode>()
  const walk = (id: string) => {
    const node = pool.nodes.get(id)
    if (!node) return
    snapshot.set(id, cloneNode(node))
    const children = (node as unknown as { children?: readonly string[] }).children
    if (children) for (const c of children) walk(c)
  }
  walk(rootId)
  return snapshot
}

/** 收集 rootId 子树当前的全部节点 id (含 root), 供撤销时整体摘除 */
function collectSubtreeIds(pool: NodePool, rootId: string): string[] {
  const ids: string[] = []
  const walk = (id: string) => {
    const node = pool.nodes.get(id)
    if (!node) return
    ids.push(id)
    const children = (node as unknown as { children?: readonly string[] }).children
    if (children) for (const c of children) walk(c)
  }
  walk(rootId)
  return ids
}

/** 段落字符偏移总长 (文本按 length, 非文本按 1) — 与光标/选区同一口径 */
function paragraphCharLength(para: Paragraph, pool: NodePool): number {
  let total = 0
  for (const childId of para.children) {
    const node = pool.nodes.get(childId)
    total += node?.type === 'text'
      ? ((node as unknown as { text?: string }).text || '').length
      : 1
  }
  return total
}

export class MergeParagraphCommand extends PositionalCommand {
  readonly type = 'merge-paragraph'
  private deletedParaId?: string
  private deletedParaSnapshot?: string
  private mergeOffset?: number
  // invert 快照 — forward 前深拷贝, 撤销时整体重建 (RULE 11 复合操作也依赖此)
  private prevParaId?: string
  private prevParaSnapshot?: Map<string, BaseNode>
  private currentParaSnapshot?: Map<string, BaseNode>

  constructor(id: string, timestamp: number, author: string, path: string[]) {
    super(id, timestamp, author, path)
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, doc } = ctx
    const currentPara = pool.nodes.get(this.path[this.path.length - 1]) as Paragraph | undefined
    if (!currentPara) return null

    // 1. 定位当前段所在区域 (body/cell/header/footer) 并找上一段
    const region = resolveParagraphRegion(currentPara.id, doc, pool)
    if (!region || region.index <= 0) return null
    const prevNode = pool.nodes.get(region.siblings[region.index - 1])
    // 上一兄弟必须是段落, 才能合并; 否则 (表格/图片/分隔符等) 退格不并段,
    // 避免把 text 节点误插进表格的 children (rows) 破坏结构
    if (!prevNode || prevNode.type !== 'paragraph') return null
    const prevPara = prevNode as Paragraph

    // 2. 深拷贝前后两段子树 (供 invert 整体重建)
    this.prevParaId = prevPara.id
    this.prevParaSnapshot = captureSubtree(pool, prevPara.id)
    this.currentParaSnapshot = captureSubtree(pool, currentPara.id)

    // 2.1 浅快照被删段落 (序列化兼容)
    this.deletedParaId = currentPara.id
    this.deletedParaSnapshot = JSON.stringify(currentPara)

    // 3. 当前段全部 children 追加到上一段
    // 接缝下标 = 追加前上一段的 children 数 (追加后第一段的插入位置)
    const seamIndex = prevPara.children.length
    // 接缝字符偏移 = 追加前上一段的字符总长 (文本按 length, 非文本按 1)。
    // 必须在追加前算: 追加后再数会把当前段的内容也算进去, 光标会跳到合并段
    // 的末尾, 而不是两段的接缝 (退格并段后光标"跳位"的根因)。
    const seamOffset = paragraphCharLength(prevPara, pool)
    for (const childId of currentPara.children) {
      pool.insertChild(prevPara.id, childId, prevPara.children.length)
    }
    // 清空当前段 children, 避免后续移除时 collectDescendants 误删已合并的文本节点
    currentPara.children = []

    // 3.1 当前段有列表样式而上一段没有 → 传播列表样式
    if (currentPara.list && !prevPara.list) {
      pool.updateNode(prevPara.id, { list: currentPara.list } as Partial<Paragraph>)
    }

    // 4. 只合并接缝处的一对 run。
    //    整段 normalize 会顺手并掉与并段无关的相邻 run —— 而 split 的逆操作
    //    正是本命令, 那会改写拆段前就存在的 run 边界, 撤销不再精确 (§8.2)。
    mergeSeamRuns(prevPara, pool, seamIndex)

    // 5. 从区域兄弟数组中移除当前段 (叶子节点, 仅删除段落包装)
    if (isPoolRegion(region)) {
      pool.detachChild(region.containerId, region.index)
    } else {
      region.siblings.splice(region.index, 1)
    }
    pool.removeNode(currentPara.id)

    // 6. 光标定位到合并接缝 (不是合并后段落的末尾)
    this.mergeOffset = seamOffset

    return {
      cursor: { paragraphPath: [...this.path.slice(0, -1), prevPara.id], offset: seamOffset },
      invalidation: region.type === 'cell' ? 'table' : 'flowbody',
    }
  }

  invert(ctx: CommandContext): ICommand | null {
    if (ctx.mode !== 'local') return null
    if (!this.prevParaId || !this.deletedParaId || !this.prevParaSnapshot || !this.currentParaSnapshot) return null
    return new RestoreMergeParagraphCommand(
      generateCommandId(), Date.now(), this.author,
      this.prevParaId, this.deletedParaId,
      this.prevParaSnapshot, this.currentParaSnapshot,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'merge-paragraph', id: this.id, timestamp: this.timestamp,
      author: this.author, path: this.path,
      deletedParaId: this.deletedParaId,
      deletedParaSnapshot: this.deletedParaSnapshot,
      mergeOffset: this.mergeOffset,
    }
  }
}

/** 撤销并段 — 从快照整体重建前后两段, 恢复被删段落 (MergeParagraphCommand 的逆操作) */
class RestoreMergeParagraphCommand implements ICommand {
  readonly type = 'restore-merge-paragraph'
  constructor(
    readonly id: string,
    readonly timestamp: number,
    readonly author: string,
    private readonly prevParaId: string,
    private readonly currentParaId: string,
    private readonly prevParaSnapshot: Map<string, BaseNode>,
    private readonly currentParaSnapshot: Map<string, BaseNode>,
  ) {}

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, doc } = ctx

    // 1. 整体摘除上一段当前子树 (含已合并进来的当前段文本节点)
    for (const id of collectSubtreeIds(pool, this.prevParaId)) {
      pool.removeNode(id)
    }

    // 2. 从快照重建上一段子树
    for (const [, node] of this.prevParaSnapshot) {
      pool.addNode(cloneNode(node))
    }

    // 3. 从快照重建被删段落子树
    for (const [, node] of this.currentParaSnapshot) {
      pool.addNode(cloneNode(node))
    }

    // 4. 将被删段落插回上一段之后
    const region = resolveParagraphRegion(this.prevParaId, doc, pool)
    if (!region) return null
    if (isPoolRegion(region)) {
      pool.insertChild(region.containerId, this.currentParaId, region.index + 1)
    } else {
      region.siblings.splice(region.index + 1, 0, this.currentParaId)
    }

    return { invalidation: region.type === 'cell' ? 'table' : 'flowbody' }
  }

  invert(): ICommand | null { return null }

  serialize(): SerializedCommand {
    return { type: this.type, id: this.id, timestamp: this.timestamp, author: this.author }
  }
}
