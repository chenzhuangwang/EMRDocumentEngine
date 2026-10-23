// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// CommentRenderPlan — 批注高亮的只读渲染计划 (契约 §12.14)
//
// 由 doc + pool + threads 一次性构建:
//   - 每条线程的段内区间 (commentSegments, 与摘录/命中同源)
//   - 段落子节点 → 段 id
//   - 段落子节点 → 段内起始偏移 (文本计 length, 非文本计 1)
//
// Draw 按页消费本计划, 不再逐页从 0 累加 item 文本 —— 那个写法在段落跨页
// 时会把第二页的偏移重新算成 0, 高亮与光标错位。
// ================================================================

import type { CommentThread, DocumentTree } from '../../document/core/DocumentModel'
import { NodeType } from '../../document/core/DocumentModel'
import type { NodePool } from '../../document/core/NodePool'
import { commentSegments, type CommentSegment } from '../../document/comment/CommentRanges'

export interface CommentPlanEntry {
  threadId: string
  segments: CommentSegment[]
}

export interface CommentRenderPlan {
  entries: CommentPlanEntry[]
  /** 子节点 id → 所属段落 id (仅计划覆盖的段落) */
  nodeToPara: Map<string, string>
  /** 段 id → (子节点 id → 段内起始偏移) */
  childStart: Map<string, Map<string, number>>
}

export function buildCommentRenderPlan(
  doc: DocumentTree,
  pool: NodePool,
  threads: readonly CommentThread[],
): CommentRenderPlan {
  const entries: CommentPlanEntry[] = []
  const nodeToPara = new Map<string, string>()
  const childStart = new Map<string, Map<string, number>>()

  for (const thread of threads) {
    const segments = commentSegments(doc, pool, thread)
    entries.push({ threadId: thread.id, segments })

    for (const seg of segments) {
      if (childStart.has(seg.paraId)) continue
      const starts = new Map<string, number>()
      let offset = 0
      for (const childId of pool.getChildren(seg.paraId)) {
        starts.set(childId, offset)
        const node = pool.nodes.get(childId)
        offset += node?.type === NodeType.TEXT
          ? ((node as unknown as { text: string }).text.length)
          : 1
      }
      childStart.set(seg.paraId, starts)
      // 空段落的占位行由布局以「段 id 本身」作为 item.nodeId 产出, 没有子节点
      // 可映射。把段 id 也登记进来, 否则空段落里的点批注永远找不到绘制位置。
      starts.set(seg.paraId, 0)
      nodeToPara.set(seg.paraId, seg.paraId)
      for (const childId of starts.keys()) {
        if (!nodeToPara.has(childId)) nodeToPara.set(childId, seg.paraId)
      }
    }
  }

  return { entries, nodeToPara, childStart }
}
