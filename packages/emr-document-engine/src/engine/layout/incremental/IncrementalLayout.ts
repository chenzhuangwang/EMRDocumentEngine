// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// IncrementalLayout — 增量布局缓存原语 (TASK-482, v7.0)
//
// 段落级布局缓存的数据结构与键; 脏区判定由调用方以键比对完成 —
// 曾经的 DirtyTracker 已删除 (2026-10-21), 不再按"脏标记"复用。
// ============================================================

import type { LineElement } from '../line/LineLayout'
import type { NodePool } from '../../document/core/NodePool'

export interface CachedParagraphLayout {
  paragraphId: string
  lines: { elements: LineElement[]; width: number; height: number; maxAscent: number; maxDescent: number; indent?: number }[]
  /** 段落总高度 */
  totalHeight: number
}

export class IncrementalLayout {
  /**
   * 段落布局缓存键 (M1, 见 knowledge/增量排版-设计方案.md §3.1)。
   *
   * 覆盖「段落自身 + 子节点内容 + 结构位置」三类输入:
   * - `structureVersion`: 任何 children 增删/移动都会变 —— 结构编辑让全部
   *   段落缓存失效, 这是刻意的保守失效;
   * - 段落节点版本: 段落样式 (缩进/对齐/列表/行距) 变化;
   * - 子节点 id + 各自版本: **版本号只落在被更新节点自身**(NodePool.updateNode
   *   不会向父节点冒泡), 所以必须逐子聚合, 不能只读段落版本。
   *
   * 不覆盖的输入: 页边距/纸张、页眉页脚变体、主题 token、locale、模板定义、
   * 计算值 —— 它们由调用方的全量失效规则兜底 (§3.2), 不进入本键。含控件的
   * 段落由调用方把计算值代次与模板定义版本作为附加段并入
   * (LayoutEngine.paragraphLineCacheKey, 契约 §16.1)。
   *
   * @returns 段落不存在或无 children 时返回 null
   */
  static paragraphKey(pool: NodePool, paraId: string): string | null {
    const para = pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
    if (!para?.children) return null

    const parts: string[] = [
      paraId,
      String(pool.structureVersion),
      String(pool.getNodeVersion(paraId)),
    ]
    for (const childId of para.children) {
      parts.push(`${childId}:${pool.getNodeVersion(childId)}`)
    }
    return parts.join('|')
  }

  /**
   * 表格子树缓存键 (增量分页用, 契约 §16.1)。
   *
   * 表格不是"段落布局单元"——它的分页由 TablePaginator 自持游标。这里只需要
   * 判断"表格子树是否变了": 变了就必须从表格起始页重排, 没变则可以让分页从
   * 表格之后的页续排。
   *
   * 覆盖: structureVersion + 子树每个节点 (table/row/cell/paragraph/child) 的 id
   * 与版本。控件值的变化通过节点版本体现; 公式结果与模板外观定义的变化不在
   * 节点上 —— 由调用方把计算值代次与模板定义版本并入键 (见 LayoutEngine)。
   */
  static tableKey(pool: NodePool, tableId: string): string | null {
    const root = pool.nodes.get(tableId)
    if (!root) return null
    const parts: string[] = [String(pool.structureVersion)]
    const visit = (id: string): void => {
      const node = pool.nodes.get(id) as
        { children?: readonly string[] } | undefined
      parts.push(`${id}:${pool.getNodeVersion(id)}`)
      for (const childId of node?.children ?? []) visit(childId)
    }
    visit(tableId)
    return parts.join('|')
  }

  /**
   * 子树里是否含某类型节点 (不含根自身)。
   *
   * 表格键需要知道"子树里有没有域" —— 域的量宽取样输入 (页数位数/locale/标题)
   * 不在节点版本上, 必须像段落键一样追加进表格键 (契约 §16.1)。
   */
  static subtreeHasType(pool: NodePool, rootId: string, type: string): boolean {
    const root = pool.nodes.get(rootId) as { children?: readonly string[] } | undefined
    const stack = [...(root?.children ?? [])]
    while (stack.length > 0) {
      const id = stack.pop()!
      const node = pool.nodes.get(id) as
        { type?: string; children?: readonly string[] } | undefined
      if (!node) continue
      if (node.type === type) return true
      for (const childId of node.children ?? []) stack.push(childId)
    }
    return false
  }

  private cache = new Map<string, CachedParagraphLayout>()

  /** 获取缓存的段落布局 */
  get(paragraphId: string): CachedParagraphLayout | undefined {
    return this.cache.get(paragraphId)
  }

  /** 缓存段落布局 */
  set(paragraphId: string, layout: CachedParagraphLayout): void {
    this.cache.set(paragraphId, layout)
  }

  /** 使指定段落的缓存失效 */
  invalidate(paragraphId: string): void {
    this.cache.delete(paragraphId)
  }

  /** 使所有缓存失效 */
  invalidateAll(): void {
    this.cache.clear()
  }

  /** 获取缓存大小 */
  get size(): number { return this.cache.size }
}
