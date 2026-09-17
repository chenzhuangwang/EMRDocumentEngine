// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

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
/**
 * 书签 → 其锚点所在段落 id (供取页码)。
 *
 * ref 可为**书签名**或**书签节点 id** —— UI 的 getBookmarkTargets 返回的是 id,
 * 而本函数最初只认 name, 于是即便接通也永远解析不出 (该错配因"从不被调用"而
 * 一直未暴露)。优先用书签自身的 targetId 定位锚点段落 —— 书签标在哪里, 页码
 * 就该按哪里算, 而不是按书签节点恰好落在哪个段落。
 */
function findBookmarkTarget(doc: DocumentTree, pool: NodePool, ref: string): string | null {
  for (const [, node] of pool.nodes) {
    const b = node as unknown as { type?: string; id?: string; name?: string; targetId?: string }
    if (b.type !== 'bookmark') continue
    if (b.name !== ref && b.id !== ref) continue
    if (b.targetId) {
      const para = findParagraphOfNode(pool, b.targetId)
      if (para) return para
    }
    const own = findParagraphOfNode(pool, b.id ?? '')
    if (own) return own
    break
  }

  // 回退: 历史实现 (书签作为正文段落直接子节点时够用)
  for (const blockId of doc.body.children) {
    const para = pool.nodes.get(blockId) as { children?: readonly string[] } | undefined
    if (!para?.children) continue
    for (const childId of para.children) {
      const child = pool.nodes.get(childId) as { type?: string; name?: string } | undefined
      if (child?.type === 'bookmark' && child.name === ref) return blockId
    }
  }
  return null
}

/** 节点 id → 其所属段落 id (节点本身是段落则返回自身; 无则 null) */
function findParagraphOfNode(pool: NodePool, nodeId: string): string | null {
  const n = pool.nodes.get(nodeId)
  if (n?.type === 'paragraph') return nodeId
  for (const [, node] of pool.nodes) {
    if (node.type !== 'paragraph') continue
    const p = node as unknown as { id: string; children?: readonly string[] }
    if (p.children?.includes(nodeId)) return p.id
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

    /**
   * 按文本内容查找标题段落。ref 可为标题段落 id (UI 的 getBookmarkTargets 传 id)
   * 或标题文本 (历史约定) —— 二者都接受, 否则调用方与解析方永远对不上。
   */
  private findHeadingByText(
    doc: DocumentTree,
    pool: NodePool,
    text: string,
  ): string | null {
    const direct = pool.nodes.get(text) as { type?: string; outlineLevel?: number } | undefined
    if (direct && direct.type === 'paragraph' && (direct.outlineLevel ?? 0) > 0) return text

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
