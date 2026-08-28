// ============================================================
// BookmarkRenderer — 书签/交叉引用解析器 (TASK-511, v7.0)
//
// 遍历文档中的 CrossReferenceNode, 解析目标页码
// 支持: bookmark → page number, heading → page number, footnote → number
// ============================================================

import type { DocumentTree } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'

// ---- 类型 ----

export interface ResolvedReference {
  /** 引用节点 ID */
  nodeId: string
  /** 目标类型 */
  refType: string
  /** 目标页码 (1-based, 0 = 未找到) */
  pageNumber: number
  /** 目标显示文本 */
  displayText: string
}

// ---- 查找辅助函数 ----

/** 在文档中查找 BookmarkNode */
function findBookmarkTarget(doc: DocumentTree, pool: NodePool, bookmarkName: string): string | null {
  for (const blockId of doc.body.children) {
    const block = pool.nodes.get(blockId)
    if (!block) continue
    const para = block as unknown as { children?: readonly string[] }
    if (para.children) {
      for (const childId of para.children) {
        const child = pool.nodes.get(childId) as { type?: string; name?: string } | undefined
        if (child?.type === 'bookmark' && child.name === bookmarkName) {
          return blockId
        }
      }
    }
  }
  return null
}

/** 获取段落所在页码 (从 SLIF 或 PageStartTable 查询) */
function getParagraphPage(
  paragraphId: string,
  pageMap?: Map<string, number>,
): number {
  if (pageMap) {
    return (pageMap.get(paragraphId) ?? -1) + 1  // 0-based → 1-based
  }
  return 0
}

/** 获取脚注编号 */
function getFootnoteNumber(
  footnoteId: string,
  pool: NodePool,
): number {
  const fn = pool.nodes.get(footnoteId) as { number?: number } | undefined
  return fn?.number ?? 0
}

// ---- 解析器 ----

export class BookmarkRenderer {
  /**
   * 解析文档中所有 CrossReferenceNode
   *
   * @param doc 文档树
   * @param pool 节点池
   * @param pageMap 段落→页索引映射 (可选, 由 LayoutEngine 提供)
   * @returns ResolvedReference[] 已解析的引用列表
   */
  resolveAll(
    doc: DocumentTree,
    pool: NodePool,
    pageMap?: Map<string, number>,
  ): ResolvedReference[] {
    const results: ResolvedReference[] = []

    for (const blockId of doc.body.children) {
      const block = pool.nodes.get(blockId) as { children?: readonly string[]; type?: string } | undefined
      if (!block || block.type !== 'paragraph') continue

      if (block.children) {
        for (const childId of block.children) {
          const child = pool.nodes.get(childId) as {
            type?: string; refType?: string; targetRef?: string
            displayText?: string
          } | undefined

          if (child?.type === 'cross_reference') {
            const resolved = this.resolveOne(
              childId, child.refType || 'bookmark', child.targetRef || '',
              child.displayText || '', doc, pool, blockId, pageMap,
            )
            if (resolved) results.push(resolved)
          }
        }
      }
    }

    return results
  }

  /**
   * 解析单个 CrossReferenceNode
   * @returns ResolvedReference 或 null
   */
  resolveOne(
    nodeId: string,
    refType: string,
    targetRef: string,
    displayText: string,
    doc: DocumentTree,
    pool: NodePool,
    _paragraphId: string,
    pageMap?: Map<string, number>,
  ): ResolvedReference | null {
    let pageNumber = 0
    let text = displayText

    switch (refType) {
      case 'bookmark': {
        const targetParaId = findBookmarkTarget(doc, pool, targetRef)
        if (targetParaId) {
          pageNumber = getParagraphPage(targetParaId, pageMap)
          text = text.replace(/\{page\}/g, String(pageNumber || '?'))
        }
        break
      }
      case 'heading': {
        // targetRef 是 heading 段落的文本内容
        const targetParaId = this.findHeadingByText(doc, pool, targetRef)
        if (targetParaId) {
          pageNumber = getParagraphPage(targetParaId, pageMap)
          text = text.replace(/\{page\}/g, String(pageNumber || '?'))
        }
        break
      }
      case 'footnote': {
        const num = getFootnoteNumber(targetRef, pool)
        text = text.replace(/\{number\}/g, String(num || '?'))
        break
      }
    }

    return { nodeId, refType, pageNumber, displayText: text }
  }

  /** 按文本内容查找标题段落 */
  private findHeadingByText(
    doc: DocumentTree,
    pool: NodePool,
    text: string,
  ): string | null {
    for (const blockId of doc.body.children) {
      const block = pool.nodes.get(blockId) as {
        type?: string; outlineLevel?: number; children?: readonly string[]
      } | undefined
      if (!block || block.type !== 'paragraph') continue
      if (!block.outlineLevel || block.outlineLevel < 1) continue

      // 获取段落纯文本
      const fullText = this.getParagraphText(block, pool)
      if (fullText.includes(text)) return blockId
    }
    return null
  }

  /** 获取段落纯文本 */
  private getParagraphText(
    block: { children?: readonly string[] },
    pool: NodePool,
  ): string {
    if (!block.children) return ''
    return block.children
      .map(cid => (pool.nodes.get(cid) as { text?: string } | undefined)?.text || '')
      .join('')
  }
}
