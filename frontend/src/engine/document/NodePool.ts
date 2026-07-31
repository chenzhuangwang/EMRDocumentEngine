// ================================================================
// NodePool — 节点池 (架构 §2.1 权威定义, v20.34)
//
// 5 条铁律:
// 1. 单向引用: children: string[], 节点不存储 parentId
// 2. 顺序保证: children 数组顺序 = 文档逻辑顺序
// 3. 统一入口: insertChild/removeChild/moveChild 为唯一合法入口
// 4. ID 不可变: id 分配后永不修改, updateNode 拒绝 id/type 变更
// 5. 遍历范式: 必须通过 traversePool(), 禁止直接递归 children
// ================================================================

import type { BaseNode } from './DocumentModel'

export class NodePool {
  readonly nodes = new Map<string, BaseNode>()
  private _structureVersion = 0
  private _nodeVersions = new Map<string, number>()

  // ---- rootIds: buildNodePool 注入, 供 QCEngine 等使用 ----
  rootIds: {
    body: string
    header?: string[]
    footer?: string[]
    footnotes?: string[]
    endnotes?: string[]
  } = { body: '' }

  // ---- 版本访问 ----

  get structureVersion(): number {
    return this._structureVersion
  }

  getNodeVersion(nodeId: string): number {
    return this._nodeVersions.get(nodeId) ?? 0
  }

  // ---- 子节点操作 (唯一合法入口, 铁律 3) ----

  insertChild(parentId: string, childId: string, index: number): void {
    const parent = this.nodes.get(parentId)
    if (!parent || !('children' in parent)) {
      throw new Error(`Parent ${parentId} not found or has no children`)
    }
    const children = (parent as Record<string, unknown>).children as string[]
    // 检查重复: 该 ID 是否已在此父节点的 children 数组中
    if (children.includes(childId)) {
      throw new Error(`Duplicate ID in parent ${parentId}: ${childId}`)
    }
    children.splice(index, 0, childId)
    // 若节点尚未注册到池中, 也算重复 (同 ID 不同节点)
    if (this.nodes.has(childId)) {
      // 允许: 先注册再插入是合法模式
    }
    this._structureVersion++
  }

  removeChild(parentId: string, index: number): string {
    const parent = this.nodes.get(parentId)
    if (!parent || !('children' in parent)) {
      throw new Error(`Parent ${parentId} not found or has no children`)
    }
    const children = (parent as Record<string, unknown>).children as string[]
    const removedId = children.splice(index, 1)[0]
    // 级联回收后代
    const descendantIds = this.collectDescendants(removedId)
    for (const id of descendantIds) {
      this.nodes.delete(id)
      this._nodeVersions.delete(id)
    }
    this._structureVersion++
    return removedId
  }

  moveChild(parentId: string, fromIndex: number, toIndex: number): void {
    const parent = this.nodes.get(parentId)
    if (!parent || !('children' in parent)) {
      throw new Error(`Parent ${parentId} not found or has no children`)
    }
    const children = (parent as Record<string, unknown>).children as string[]
    const [moved] = children.splice(fromIndex, 1)
    children.splice(toIndex, 0, moved)
    this._structureVersion++
  }

  removeOrphanLeaf(nodeId: string): void {
    const node = this.nodes.get(nodeId)
    if (node && 'children' in node) {
      const children = (node as unknown as Record<string, unknown>).children as string[] | undefined
      if (children && children.length > 0) {
        throw new Error(`removeOrphanLeaf: ${nodeId} is not a leaf node`)
      }
    }
    this.nodes.delete(nodeId)
    this._nodeVersions.delete(nodeId)
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
    const parent = this.nodes.get(parentId)
    return ((parent as Record<string, unknown> | undefined)?.children as string[]) ?? []
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
    const children = (para as { children?: string[] }).children ?? []
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
    const children = (para as { children?: string[] }).children ?? []
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
    pool.nodes.set(id, node)
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
