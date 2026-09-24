// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// NodePool — 节点池 (架构 §2.1 权威定义, v20.34)
//
// 5 条铁律:
// 1. 单向引用: children: readonly string[], 节点不存储 parentId
// 2. 顺序保证: children 数组顺序 = 文档逻辑顺序
// 3. 统一入口: insertChild/removeChild/moveChild 为唯一合法入口
// 4. ID 不可变: id 分配后永不修改, updateNode 拒绝 id/type 变更
// 5. 遍历范式: 必须通过 traversePool(), 禁止直接递归 children
// ================================================================

import type { BaseNode } from './DocumentModel'

export class NodePool {
  private _nodes = new Map<string, BaseNode>()
  private _structureVersion = 0
  private _nodeVersions = new Map<string, number>()

  /**
   * 只读节点视图 — 类型级 choke point (契约 §6.1)。
   * 外部仅可 get/has/遍历; set/delete 必须经 addNode/removeNode。
   */
  get nodes(): ReadonlyMap<string, BaseNode> {
    return this._nodes
  }

  // ---- rootIds: buildNodePool 注入, 供 QCEngine 等使用 ----
  rootIds: NodePoolRootIds = { body: '' }

  // ---- 节点注册 (唯一合法入口, 铁律 3 / 契约 §6.1) ----

  /** 注册新节点 — 重复 id 抛错 (替代裸 pool.nodes.set) */
  addNode(node: BaseNode): void {
    if (this._nodes.has(node.id)) {
      throw new Error(`NodePool.addNode: duplicate id ${node.id}`)
    }
    this._nodes.set(node.id, node)
  }

  /** 注销节点及其版本缓存 (替代裸 pool.nodes.delete) */
  removeNode(nodeId: string): void {
    this._nodes.delete(nodeId)
    this._nodeVersions.delete(nodeId)
  }

  // ---- 版本访问 ----

  get structureVersion(): number {
    return this._structureVersion
  }

  getNodeVersion(nodeId: string): number {
    return this._nodeVersions.get(nodeId) ?? 0
  }

  // ---- 子节点操作 (唯一合法入口, 铁律 3) ----

  /** 解析节点的 children 数组 — 兼容 DocumentTree (body.children) 和普通节点 (children) */
  private resolveChildren(parentId: string): string[] {
    const parent = this.nodes.get(parentId)
    if (!parent) throw new Error(`Parent ${parentId} not found`)
    const p = parent as unknown as Record<string, unknown>
    // DocumentTree: children 在 body 上
    if (p.body && typeof p.body === 'object') {
      const b = p.body as Record<string, unknown>
      if (Array.isArray(b.children)) return b.children as string[]
    }
    // 普通节点: children 直接在节点上
    if (Array.isArray(p.children)) return p.children as string[]
    throw new Error(`Parent ${parentId} has no children array`)
  }

  insertChild(parentId: string, childId: string, index: number): void {
    this.insertChildren(parentId, [childId], index)
  }

  /** 批量插入多个子节点 (铁律 3)。替代裸 children.push / splice(idx,0,...)。 */
  insertChildren(parentId: string, childIds: readonly string[], index: number): void {
    const children = this.resolveChildren(parentId)
    for (const childId of childIds) {
      if (children.includes(childId)) {
        throw new Error(`Duplicate ID in parent ${parentId}: ${childId}`)
      }
    }
    children.splice(index, 0, ...childIds)
    this._structureVersion++
  }

  removeChild(parentId: string, index: number): string {
    const children = this.resolveChildren(parentId)
    const removedId = children.splice(index, 1)[0]
    const descendantIds = this.collectDescendants(removedId)
    for (const id of descendantIds) {
      this.removeNode(id)
    }
    this._structureVersion++
    return removedId
  }

  /**
   * 从父节点 children 中摘除子节点, 但不删除其子树 (区别于 removeChild)。
   * 供撤销等需要保留子树节点引用 (再单独清理) 的场景使用。
   */
  detachChild(parentId: string, index: number): string {
    const children = this.resolveChildren(parentId)
    const removedId = children.splice(index, 1)[0]
    this._structureVersion++
    return removedId
  }

  moveChild(parentId: string, fromIndex: number, toIndex: number): void {
    const children = this.resolveChildren(parentId)
    const [moved] = children.splice(fromIndex, 1)
    children.splice(toIndex, 0, moved)
    this._structureVersion++
  }

  /**
   * 跨父移动: 把 childId 从 fromParentId 移到 toParentId 的 toIndex。
   *
   * 与同父 moveChild 的区别是**容器身份也变了** —— 这是"整节移动"这类命令
   * 需要的能力 (契约 §31: 节可以被挪到另一个位置/另一个父容器)。此前本仓库
   * **根本没有**跨父移动能力: `moveChild` 只在单个父内重排, 且零调用者。
   *
   * 受控语义 (契约 §6.1):
   *   - 必须先查两边都是已注册节点, 且 childId 确在 fromParentId 下 (否则抛错,
   *     不做静默 no-op —— 静默失败会让 undo 把内容还原到错误位置)
   *   - 移动是**摘除 + 插入**, 子树节点身份不变 (它们仍在池中, 只是父换了)
   *   - 目标父若已含 childId (跨父重复归属的脏数据) → 抛错, 不制造第二个引用
   *   - **toIndex 与 moveChild 同一约定**: 它是「摘除之后」目标数组中的下标。
   *     同父内向后移动时, 调用方给的"我想让它到第 N 位"会因自身被摘除而左移一位,
   *     这是既有 API 的语义, 不在此另立一套 (两个同族方法语义不同才是真陷阱)。
   *
   * @returns 实际插入下标
   */
  moveChildTo(
    childId: string,
    fromParentId: string,
    toParentId: string,
    toIndex: number,
  ): number {
    const from = this.resolveChildren(fromParentId)
    const fromIndex = from.indexOf(childId)
    if (fromIndex < 0) {
      throw new Error(`NodePool.moveChildTo: ${childId} is not a child of ${fromParentId}`)
    }
    const sameParent = fromParentId === toParentId
    const to = sameParent ? from : this.resolveChildren(toParentId)
    // 同父重排时 childId 本来就在 to 里 (那是它自己), 只在**跨父**时查重
    if (!sameParent && to.includes(childId)) {
      throw new Error(`NodePool.moveChildTo: duplicate ID in parent ${toParentId}: ${childId}`)
    }
    // 自环防护: 不能把一个节点移进它自己的子树 (会让树变成环)
    if (childId === toParentId || this.collectDescendants(childId).includes(toParentId)) {
      throw new Error(`NodePool.moveChildTo: cannot move ${childId} into its own subtree (${toParentId})`)
    }
    from.splice(fromIndex, 1)
    // 与 moveChild 逐字同一语义: 直接 splice 到 toIndex (该下标是**摘除后**数组中的
    // 位置)。同父内向后移动时调用方给的"第 N 位"因此会左移一位 —— 这是既有约定,
    // 两个同族方法必须一致, 不能各立一套。
    const clamped = Math.max(0, Math.min(toIndex, to.length))
    to.splice(clamped, 0, childId)
    this._structureVersion++
    return clamped
  }

  /**
   * 截断 children 尾部 (fromIndex 起全部摘除), detach 但不删除子树。
   * 返回被摘除的 child id 列表, 供调用方挪到别的父节点。
   * 替代裸 children.splice(fromIndex)。
   */
  truncateChildren(parentId: string, fromIndex: number): string[] {
    const children = this.resolveChildren(parentId)
    const removed = children.splice(fromIndex)
    this._structureVersion++
    return removed
  }

  removeOrphanLeaf(nodeId: string): void {
    const node = this.nodes.get(nodeId)
    if (node && 'children' in node) {
      const children = (node as unknown as Record<string, unknown>).children as readonly string[] | undefined
      if (children && children.length > 0) {
        throw new Error(`removeOrphanLeaf: ${nodeId} is not a leaf node`)
      }
    }
    this.removeNode(nodeId)
    this._structureVersion++
  }

  // ---- 节点更新 (铁律 4) ----

  updateNode(nodeId: string, changes: Partial<BaseNode>): void {
    if ('id' in changes || 'type' in changes) {
      throw new Error('id and type are immutable')
    }
    const node = this.nodes.get(nodeId)
    if (node) {
      Object.assign(node, changes)
      this._nodeVersions.set(nodeId, (this._nodeVersions.get(nodeId) ?? 0) + 1)
    }
  }

  /**
   * 删除节点上的一个自有字段 (契约 §12.6.1 规范空态)。
   *
   * updateNode 用 Object.assign, 会把 `value: undefined` 写成自有键 (键在值空),
   * 与「缺失 value 字段 = 未填」的规范空态在内存中不等价。本方法真正 delete 该键,
   * 供 SetControlValueCommand 清空运行时值时调用。拒绝 id/type (铁律 4)。
   */
  deleteNodeField(nodeId: string, field: string): void {
    if (field === 'id' || field === 'type') {
      throw new Error('id and type are immutable')
    }
    const node = this.nodes.get(nodeId) as Record<string, unknown> | undefined
    if (node && field in node) {
      delete node[field]
      this._nodeVersions.set(nodeId, (this._nodeVersions.get(nodeId) ?? 0) + 1)
    }
  }

  bumpNodeVersion(nodeId: string): void {
    this._nodeVersions.set(nodeId, (this._nodeVersions.get(nodeId) ?? 0) + 1)
  }

  // ---- 查询 ----

  getChildren(parentId: string): readonly string[] {
    try { return this.resolveChildren(parentId) } catch { return [] }
  }

  getChildNodes(parentId: string): readonly BaseNode[] {
    return this.getChildren(parentId)
      .map(id => this.nodes.get(id)!)
      .filter(Boolean)
  }

  // ---- 字符偏移解析 ----

  resolveCharOffset(
    paragraphId: string,
    charOffset: number,
  ): { textNodeId: string; localOffset: number } | null {
    const para = this.nodes.get(paragraphId) as Record<string, unknown> | undefined
    if (!para) return null
    const children = (para as { children?: readonly string[] }).children ?? []
    let remaining = charOffset
    for (const childId of children) {
      const node = this.nodes.get(childId)
      if (node && (node as unknown as Record<string, unknown>).type === 'text') {
        const len = ((node as unknown as Record<string, unknown>).text as string).length
        if (remaining <= len) return { textNodeId: childId, localOffset: remaining }
        remaining -= len
      } else {
        if (remaining <= 1) return { textNodeId: childId, localOffset: Math.min(remaining, 1) }
        remaining -= 1
      }
    }
    return null
  }

  getCharOffset(paragraphId: string, textNodeId: string, localOffset: number): number {
    const para = this.nodes.get(paragraphId) as Record<string, unknown> | undefined
    if (!para) return 0
    const children = (para as { children?: readonly string[] }).children ?? []
    let offset = 0
    for (const childId of children) {
      if (childId === textNodeId) return offset + localOffset
      const node = this.nodes.get(childId)
      if (node && (node as unknown as Record<string, unknown>).type === 'text') {
        offset += ((node as unknown as Record<string, unknown>).text as string).length
      } else {
        offset += 1
      }
    }
    return offset
  }

  // ---- 内部 ----

  private collectDescendants(nodeId: string): string[] {
    const result: string[] = [nodeId]
    const node = this.nodes.get(nodeId)
    if (node && 'children' in node) {
      for (const childId of (node as unknown as Record<string, unknown>).children as readonly string[]) {
        result.push(...this.collectDescendants(childId))
      }
    }
    return result
  }
}

/**
 * 树遍历 — 基于 NodePool (铁律 5)
 */
export function traversePool(
  pool: NodePool,
  rootId: string,
  visitor: (node: BaseNode, depth: number) => void,
): void {
  const visited = new Set<string>()
  const walk = (id: string, depth: number) => {
    if (visited.has(id)) throw new Error(`Cycle detected: ${id}`)
    visited.add(id)
    const node = pool.nodes.get(id)
    if (!node) return
    visitor(node, depth)
    if ('children' in node) {
      for (const childId of (node as unknown as Record<string, unknown>).children as readonly string[]) {
        walk(childId, depth + 1)
      }
    }
  }
  walk(rootId, 0)
}

/**
 * buildNodePool — 扁平节点注册 (架构 §2.1, v20.15 重写)
 *
 * 输入: DocumentLoader 已将 JSON 序列化数据展开为扁平 Map + 根 ID 集合
 */
export interface NodePoolRootIds {
  body: string
  header?: string[]
  footer?: string[]
  /** 首页/偶数页页眉页脚变体 (契约 §7.9) */
  firstPageHeader?: string[]
  firstPageFooter?: string[]
  evenPageHeader?: string[]
  evenPageFooter?: string[]
  footnotes?: string[]
  endnotes?: string[]
}

export function buildNodePool(
  flatNodes: Map<string, BaseNode>,
  rootIds: NodePoolRootIds,
): NodePool {
  const pool = new NodePool()

  // Pass 1: 全量注册
  for (const [id, node] of flatNodes) {
    if (pool.nodes.has(id)) {
      console.warn(`[NodePool] Duplicate ID: ${id}, skipping`)
      continue
    }
    pool.addNode(node)
  }

  // Pass 2: 校验引用完整性
  for (const node of flatNodes.values()) {
    if ('children' in node) {
      for (const childId of (node as unknown as Record<string, unknown>).children as readonly string[]) {
        if (!pool.nodes.has(childId)) {
          console.warn(`[NodePool] Orphan reference: ${node.id} → ${childId}`)
        }
      }
    }
  }

  // Pass 3: 校验 rootIds
  const rootIdSet = new Set([
    rootIds.body,
    ...(rootIds.header ?? []),
    ...(rootIds.footer ?? []),
    ...(rootIds.firstPageHeader ?? []),
    ...(rootIds.firstPageFooter ?? []),
    ...(rootIds.evenPageHeader ?? []),
    ...(rootIds.evenPageFooter ?? []),
    ...(rootIds.footnotes ?? []),
    ...(rootIds.endnotes ?? []),
  ])
  for (const id of rootIdSet) {
    if (!pool.nodes.has(id)) {
      throw new Error(`[NodePool] Root node not found: ${id}`)
    }
  }

  // Pass 4: 存储 rootIds
  pool.rootIds = rootIds

  return pool
}
