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
