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
  rootIds: {
    body: string
    header?: string[]
    footer?: string[]
    footnotes?: string[]
    endnotes?: string[]
  } = { body: '' }

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
      const children = (node as unknown as Record<string, unknown>).children as string[] | undefined
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
      for (const childId of (node as unknown as Record<string, unknown>).children as string[]) {
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
      for (const childId of (node as unknown as Record<string, unknown>).children as string[]) {
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
export function buildNodePool(
  flatNodes: Map<string, BaseNode>,
  rootIds: {
    body: string
    header?: string[]
    footer?: string[]
    footnotes?: string[]
    endnotes?: string[]
  },
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
      for (const childId of (node as unknown as Record<string, unknown>).children as string[]) {
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
