// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ParagraphUtils — normalizeParagraph 共享 (避免 InsertText/DeleteRange 循环依赖)
// ================================================================

import type { Paragraph, TextNode } from '../../document/core/DocumentModel'
import type { NodePool } from '../../document/core/NodePool'
import { sameStyle } from '../../document/factory/ElementFormatter'
import { sameRevisionKind } from '../../revision/Revision'

/**
 * 合并相邻同一样式的 TextNode。
 *
 * **修订标记参与判据** (契约 §12.13): 两个标记不同的文本节点**不得合并** ——
 * 合并只能保留一份标记, 于是要么删除线凭空消失 (待删文字变成正常文字),
 * 要么待删文字被染成新增色。样式一样不够, 得"同一条修订记录"才够。
 * 这条判据以前不存在, 因为以前没有标记可丢。
 */
export function normalizeParagraph(para: Paragraph, pool: NodePool): void {
  const merged: string[] = []
  const orphans: string[] = []
  let prev: TextNode | null = null

  for (const childId of para.children) {
    const node = pool.nodes.get(childId)
    const isText = !!node && (node as unknown as Record<string, unknown>).type === 'text'
    if (isText && prev && sameStyle(prev, node as TextNode)
        && sameRevisionKind(prev.revision, (node as TextNode).revision)) {
      pool.updateNode(prev.id, { text: prev.text + (node as TextNode).text } as Partial<TextNode>)
      orphans.push(childId)
    } else {
      merged.push(childId)
      prev = isText ? node as TextNode : null
    }
  }

  para.children = merged

  for (const id of orphans) {
    pool.removeOrphanLeaf(id)
  }
}

/**
 * 只合并**接缝处**的一对相邻文本节点 (index-1 与 index)。
 *
 * 并段的正确副作用只有"接缝两侧的 run 合成一个"; 整段 normalize 会顺手并掉
 * 本命令无关的相邻 run —— 而 split 的逆操作正是本命令, 那会改写拆段前就存在
 * 的 run 边界, 撤销不再精确 (契约 §8.2)。
 */
export function mergeSeamRuns(para: Paragraph, pool: NodePool, index: number): void {
  if (index <= 0 || index >= para.children.length) return
  const leftId = para.children[index - 1]
  const rightId = para.children[index]
  const left = pool.nodes.get(leftId) as TextNode | undefined
  const right = pool.nodes.get(rightId) as TextNode | undefined
  const isText = (n: TextNode | undefined): n is TextNode =>
    !!n && (n as unknown as Record<string, unknown>).type === 'text'
  if (!isText(left) || !isText(right)) return
  if (!sameStyle(left, right) || !sameRevisionKind(left.revision, right.revision)) return
  pool.updateNode(left.id, { text: left.text + right.text } as Partial<TextNode>)
  para.children = para.children.filter((_, i) => i !== index)
  pool.removeOrphanLeaf(right.id)
}

/**
 * 段落里是否**已经**存在"相邻且可合并"的文本节点 (同样式 + 同修订标记)。
 *
 * normalizeParagraph 会把它们合成一个节点 —— 节点身份与 run 边界就此改变。
 * 正向路径里会 normalize、逆操作却只做轻量文本反转的命令, 必须据此先拍整段
 * 快照 (契约 §8.2/§8.3): 正常文档在命令之间是规范化的, 但清除格式 / 样式
 * 还原能让相邻 run 变得同样式却不触发合并, 于是"下一次输入"就成了第一个
 * 撞上它们的命令 —— 撤销再删掉刚输入的字, 也无法还原被并掉的 run 边界。
 */
export function hasMergeableRuns(para: Paragraph, pool: NodePool): boolean {
  let prev: TextNode | null = null
  for (const childId of para.children) {
    const node = pool.nodes.get(childId) as TextNode | undefined
    const isText = !!node && (node as unknown as Record<string, unknown>).type === 'text'
    if (isText && prev && sameStyle(prev, node) && sameRevisionKind(prev.revision, node.revision)) {
      return true
    }
    prev = isText ? node : null
  }
  return false
}
