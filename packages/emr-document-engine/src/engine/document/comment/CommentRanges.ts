// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// CommentRanges — 批注范围的唯一展开实现 (契约 §12.14)
//
// CommentThread 只存 rangeStart/rangeEnd 两段路径。本模块把它们展开成
// 「段内区间」列表:
//   - 同段: 一个区间
//   - 跨段: 经 selectionSpine (W3 读序) 取首/中/末段, 与选区/复制/删除
//     使用完全相同的读序与 region 判定
//
// 渲染 (Draw)、摘录 (Editor)、命中 (Editor) 三处共用本模块, 不允许第二套
// 区间算法 (§11 单源)。
// ================================================================

import type { CommentThread, DocumentTree } from '../core/DocumentModel'
import type { NodePool } from '../core/NodePool'
import { paragraphTextInRange, paragraphTextLength, selectionSpine } from '../selection/SelectionCollector'

/** 批注在单个段落内的区间 [from, to) */
export interface CommentSegment {
  paraId: string
  from: number
  to: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function lastId(path: readonly string[] | undefined): string | null {
  return path && path.length > 0 ? path[path.length - 1] : null
}

/**
 * 展开一条批注的范围为段内区间列表。
 *
 * 跨区 (body↔header / 变体不同 / 不同 cell) 的历史数据无法经 spine 归一,
 * 此时回退为「起始段到段末」——与旧渲染行为一致, 不猜中间段。
 */
export function commentSegments(
  doc: DocumentTree,
  pool: NodePool,
  thread: CommentThread,
): CommentSegment[] {
  const startPara = lastId(thread.rangeStart.path)
  const endPara = lastId(thread.rangeEnd.path)
  if (!startPara || !endPara) return []

  if (startPara === endPara) {
    const len = paragraphTextLength(pool, startPara)
    const from = clamp(Math.min(thread.rangeStart.offset, thread.rangeEnd.offset), 0, len)
    const to = clamp(Math.max(thread.rangeStart.offset, thread.rangeEnd.offset), 0, len)
    // 零长度 = 光标处的「点批注」(契约 §12.14): 保留一个点段, 由渲染层
    // 画成插入点标记, 而不是丢掉 —— 丢掉会让点批注在画布上完全不可见。
    return [{ paraId: startPara, from, to }]
  }

  const spine = selectionSpine(doc, pool, startPara, endPara)
  if (!spine) {
    const len = paragraphTextLength(pool, startPara)
    const from = clamp(thread.rangeStart.offset, 0, len)
    return from < len ? [{ paraId: startPara, from, to: len }] : []
  }

  const ids = spine.spine
  const startIndex = ids.indexOf(startPara)
  const endIndex = ids.indexOf(endPara)
  if (startIndex < 0 || endIndex < 0) {
    const len = paragraphTextLength(pool, startPara)
    const from = clamp(thread.rangeStart.offset, 0, len)
    return from < len ? [{ paraId: startPara, from, to: len }] : []
  }

  const forward = startIndex < endIndex
  const firstIndex = forward ? startIndex : endIndex
  const lastIndex = forward ? endIndex : startIndex
  const firstOffset = forward ? thread.rangeStart.offset : thread.rangeEnd.offset
  const lastOffset = forward ? thread.rangeEnd.offset : thread.rangeStart.offset

  const segments: CommentSegment[] = []
  for (let i = firstIndex; i <= lastIndex; i++) {
    const paraId = ids[i]
    const len = paragraphTextLength(pool, paraId)
    const from = i === firstIndex ? clamp(firstOffset, 0, len) : 0
    const to = i === lastIndex ? clamp(lastOffset, 0, len) : len
    if (to > from) segments.push({ paraId, from, to })
  }
  return segments
}

/** 光标位置是否落在批注范围内 (端点算在内, 便于点击边界命中) */
export function commentContains(
  segments: readonly CommentSegment[],
  paraId: string,
  offset: number,
): boolean {
  for (const seg of segments) {
    if (seg.paraId !== paraId) continue
    // 点批注只命中它自己的插入点
    if (seg.from === seg.to) {
      if (offset === seg.from) return true
      continue
    }
    if (offset >= seg.from && offset <= seg.to) return true
  }
  return false
}

/** 批注摘录: 逐段取文本, 跨段用一个空格连接 */
export function commentExcerpt(segments: readonly CommentSegment[], pool: NodePool): string {
  return segments
    .map(seg => paragraphTextInRange(pool, seg.paraId, seg.from, seg.to))
    .filter(text => text.length > 0)
    .join(' ')
    .trim()
}
