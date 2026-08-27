// ================================================================
// ParagraphUtils — normalizeParagraph 共享 (避免 InsertText/DeleteRange 循环依赖)
// ================================================================

import type { Paragraph, TextNode } from '../../document/core/DocumentModel'
import type { NodePool } from '../../document/core/NodePool'
import { sameStyle } from '../../document/factory/ElementFormatter'

export function normalizeParagraph(para: Paragraph, pool: NodePool): void {
  const merged: string[] = []
  const orphans: string[] = []
  let prev: TextNode | null = null

  for (const childId of para.children) {
    const node = pool.nodes.get(childId)
    if (node && (node as unknown as Record<string, unknown>).type === 'text' && prev && sameStyle(prev, node as TextNode)) {
      pool.updateNode(prev.id, { text: prev.text + (node as TextNode).text } as Partial<TextNode>)
      orphans.push(childId)
    } else {
      merged.push(childId)
      prev = (node && (node as unknown as Record<string, unknown>).type === 'text') ? node as TextNode : null
    }
  }

  ;(para as { children: string[] }).children = merged

  for (const id of orphans) {
    pool.removeOrphanLeaf(id)
  }
}
