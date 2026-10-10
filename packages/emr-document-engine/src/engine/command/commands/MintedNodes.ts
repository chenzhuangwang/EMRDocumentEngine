// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// MintedNodes — 命令「铸造一次」的节点台账 (契约 §8.3)
//
// 命令的 forward 会被调用**多次**: execute 一次, 之后每次 redo 一次
// (CommandUndoRedoStack.redo() 是把原命令对象的 forward 再跑一遍, 不是重放
// 一段录下来的变更)。而 forward 里的工厂 (createSection / createParagraph /
// createTextNode …) 每次都铸一个新 id。
//
// 于是: redo 铸出的节点换了个 id, 而 redo 链里后一条命令在**构造时**捕获的
// 正是这个 id (「在这个节里再插一个节」「在这个新段落里打字」) → 解析不到目标
// → forward 返回 null → 被栈**静默丢弃** → 链断在中途。undo×3 → redo×3
// 只回来一个节点, 是静默数据丢失 (契约 §31.5 禁止的失败模式)。
//
// 出路不是发明新机制: engine 早已有正确写法 —— RestoreNodesCommand /
// RestoreTableCommand / RestoreControlCommand 都在做「按 id 快照 → pool.addNode
// 重新注册 → 插回原位」, id 全程不变。本文件把那个惯用法抽成铸造侧的共享原语。
//
// 用法见 MintedOnce 的注释。判据 (契约 §8.3): execute → undo×N → redo×N 之后,
// **带 id 的序列化**必须与 execute 后逐字节相同。
// ================================================================

import type { BaseNode } from '../../document/core/DocumentModel'
import type { NodePool } from '../../document/core/NodePool'

/** 子树快照: id → 节点 (深拷贝, id 保留) */
export type SubtreeSnapshot = Map<string, BaseNode>

/**
 * 深拷贝若干根节点的子树 → { id → node } 快照。
 *
 * **深拷贝但保留 id** —— 这正是它能当「身份稳定」载体用的原因: 重新注册后
 * 每个节点的 id 与首次铸造时一致, 后续命令捕获的引用不会悬空。
 * (与 StructuralCommands 里表格 undo 用的是同一手法, 故只此一份实现, §11。)
 */
/** 深拷贝单节点 (保留 id; 与 captureMintedSubtree 同一手法, 故只此一份, §11) */
function cloneSnapshotNode<T extends BaseNode>(node: T): T {
  return JSON.parse(JSON.stringify(node)) as T
}

export function captureMintedSubtree(
  pool: NodePool,
  rootIds: readonly string[],
): SubtreeSnapshot {
  const ids: string[] = []
  const seen = new Set<string>()
  const stack = [...rootIds]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const node = pool.nodes.get(id)
    if (!node) continue
    ids.push(id)
    const children = (node as unknown as { children?: readonly string[] }).children
    if (children) for (const c of children) stack.push(c)
  }
  const snapshot: SubtreeSnapshot = new Map()
  for (const id of ids) {
    const node = pool.nodes.get(id)
    if (node) snapshot.set(id, cloneSnapshotNode(node))
  }
  return snapshot
}

/**
 * 把快照里的节点重新注册回池。
 *
 * **每次注册都重新深拷贝** —— 池里放的必须是快照的副本, 不能是快照对象本身:
 * 命令重放后还会继续改写这些节点 (截断文本 / 插子节点), 若池与快照共享同一对象,
 * 第一次重放就把快照改成末态, 第二次 undo→redo 拿到的已不是「铸造那一刻」的样子。
 *
 * 只注册, 不动父容器的 children —— 根节点插回哪个容器、哪个下标, 由调用方
 * 决定 (通常每次 forward 都要重做一次)。
 */
export function reregisterMintedSubtree(pool: NodePool, snapshot: SubtreeSnapshot): void {
  for (const [, node] of snapshot) {
    if (!pool.nodes.has(node.id)) pool.addNode(cloneSnapshotNode(node))
  }
}

/**
 * 一条命令的「铸造一次」台账 (契约 §8.3)。
 *
 * ```ts
 * private mint = new MintedOnce()
 *
 * forward(ctx) {
 *   const [sectionId] = this.mint.run(pool, () => {
 *     // ↓ 只在**首次** forward 执行: 铸造 + 构造内部结构
 *     const section = createSection()
 *     pool.addNode(section)
 *     const para = createTrailingParagraph(pool)
 *     pool.insertChild(section.id, para.id, 0)
 *     return [section.id]
 *   })
 *   // ↓ 每次 forward 都执行: 把根放回容器 (重放时它们只是被重新注册,
 *   //   尚未在父容器里)
 *   pool.insertChild(this.containerId, sectionId, at)
 * }
 * ```
 *
 * **分界线是契约 §8.3 的推论**: 「铸造 + 构造内部结构」进 once 区;
 * 「把根放进容器」留在 once 区之外。放反了要么子节点被插两次, 要么根没落位。
 */
export class MintedOnce {
  private snapshot: SubtreeSnapshot | null = null
  private rootIds: readonly string[] = []

  /** 首次: 执行 mint() 铸造并按根快照; 之后: 只把快照重新注册回池 */
  run(pool: NodePool, mint: () => readonly string[]): readonly string[] {
    if (this.snapshot === null) {
      this.rootIds = mint()
      this.snapshot = captureMintedSubtree(pool, this.rootIds)
      return this.rootIds
    }
    reregisterMintedSubtree(pool, this.snapshot)
    return this.rootIds
  }

  /** true = 本次 forward 走的是重放 (节点已由快照恢复, 未经铸造) */
  get replaying(): boolean { return this.snapshot !== null }

  /** 本命令铸出的根 id (尚未 forward 时为空) */
  get roots(): readonly string[] { return this.rootIds }
}
