// ================================================================
// SelectionCollector — 选区 → 段落区间/文本节点的投影 (契约 §11.2)
//
// 这是「collect selected text-node ids / paragraph ranges」的唯一
// 共享实现。Drift 3 的反转: 原先同一份「遍历段落 children、文本节点
// 计 text.length、非文本计 1、累加偏移」的循环在 Editor.ts 与
// FormatTextCommand.ts 里各有一份逐行复制; 现统一到此模块。
//
// 纯 DOCUMENT 域 (依赖 DocumentModel + NodePool, 不依赖运行时
// SelectionState): FormatRange 是「投影到文档的选区段落区间」, 属于
// 本层, command 层 import 它 (§19 依赖方向)。
//
// endOffset 语义: exclusive; Number.MAX_SAFE_INTEGER 表示「到段落
// 末尾」(与 Editor 既有约定一致)。
// ================================================================

import type { TextNode, DocumentTree } from '../core/DocumentModel'
import { NodeType } from '../core/DocumentModel'
import type { NodePool } from '../core/NodePool'
import {
  hfArrayOf, hfContainers, resolveHfParagraphLocation,
  type HeaderFooterBand, type HeaderFooterVariant,
} from '../core/HeaderFooterRegions'

/** 段落字符偏移区间 (exclusive end), 语义与 PositionalCommand.path 一致 */
export interface FormatRange {
  /** [docId, paraId] — 末段为可定位文本容器 */
  path: string[]
  /** 段内字符偏移 (inclusive) */
  start: number
  /** 段内字符偏移 (exclusive) */
  end: number
}

/** 选区投影出的「段内区间」片段 (paraId + [start,end)), end 可为 INF */
export interface SelectionSegment {
  paraId: string
  start: number
  end: number
}

const INF = Number.MAX_SAFE_INTEGER

/** 段落内全部可见文本的总字符数 (文本节点计 text.length, 非文本计 1) */
export function paragraphTextLength(pool: NodePool, paraId: string): number {
  const para = pool.nodes.get(paraId)
  if (!para || para.type !== NodeType.PARAGRAPH) return 0
  const children = (para as { children?: readonly string[] }).children
  if (!children) return 0
  let len = 0
  for (const childId of children) {
    const node = pool.nodes.get(childId)
    if (node?.type === NodeType.TEXT) len += (node as TextNode).text.length
    else len += 1
  }
  return len
}

/** 收集段落 [start,end) 内重叠的所有文本节点 id (end 可为 INF) */
export function collectTextNodeIds(
  pool: NodePool, paraId: string, start: number, end: number,
): string[] {
  const ids: string[] = []
  const para = pool.nodes.get(paraId)
  if (!para || para.type !== NodeType.PARAGRAPH) return ids
  const children = (para as { children?: readonly string[] }).children
  if (!children) return ids

  let offset = 0
  for (const childId of children) {
    const node = pool.nodes.get(childId)
    const len = node?.type === NodeType.TEXT ? (node as TextNode).text.length : 1
    if (node?.type === NodeType.TEXT && offset + len > start && offset < end) {
      ids.push(childId)
    }
    offset += len
  }
  return ids
}

/** 读取 [start,end) 内首个文本节点 (供 toggle 方向判断), 无则 null */
export function findFirstTextNodeInRange(
  pool: NodePool, range: FormatRange,
): TextNode | null {
  const paraId = range.path[range.path.length - 1]
  const para = pool.nodes.get(paraId)
  if (!para || para.type !== NodeType.PARAGRAPH) return null
  const children = (para as { children?: readonly string[] }).children
  if (!children) return null

  let offset = 0
  for (const childId of children) {
    const node = pool.nodes.get(childId)
    const len = node?.type === NodeType.TEXT ? (node as TextNode).text.length : 1
    if (node?.type === NodeType.TEXT && offset + len > range.start && offset < range.end) {
      return node as TextNode
    }
    offset += len
  }
  return null
}

/**
 * 展平 body 为「阅读顺序的文本容器序列」— 表格展开为 cell 内段落
 * (行主序、每行按 cell 顺序), 其余块 (paragraph/image/separator/...) 保留原 id。
 *
 * 选区、复制、渲染的线性定位都基于此序列: cell 段落不在 body.children,
 * 若不展平, body↔table 跨域选区会 indexOf=-1 被整体丢弃
 * (「全选选不中表格」/ 从正文拖拽选区进表格选不中的根因)。
 */
export function flattenTextContainers(
  pool: NodePool,
  bodyChildIds: readonly string[],
): string[] {
  const out: string[] = []
  for (const id of bodyChildIds) {
    const node = pool.nodes.get(id)
    if (node?.type === NodeType.TABLE) {
      const rows = (node as { children?: readonly string[] }).children ?? []
      for (const rowId of rows) {
        const row = pool.nodes.get(rowId) as { children?: readonly string[] } | undefined
        for (const cellId of row?.children ?? []) {
          const cell = pool.nodes.get(cellId) as { children?: readonly string[] } | undefined
          for (const paraId of cell?.children ?? []) {
            out.push(paraId)
          }
        }
      }
    } else {
      out.push(id)
    }
  }
  return out
}

/**
 * 选区 → 段内区间片段列表 (同段/跨段)。
 *
 * 不依赖 pool / SelectionState, 只接收已解析的 anchor/focus 段落 id +
 * 偏移, 与 doc.body.children (段落 id 顺序表)。首段 end 用 INF 表示
 * 「到段落末尾」, 由调用方决定如何物化 (算实际长度 / 直接传 collectTextNodeIds)。
 */
export function collectSelectionSegments(
  bodyChildIds: readonly string[],
  anchorParaId: string,
  anchorOffset: number,
  focusParaId: string,
  focusOffset: number,
): SelectionSegment[] {
  const segments: SelectionSegment[] = []

  if (anchorParaId === focusParaId) {
    const start = Math.min(anchorOffset, focusOffset)
    const end = Math.max(anchorOffset, focusOffset)
    if (start < end) segments.push({ paraId: anchorParaId, start, end })
    return segments
  }

  const aIdx = bodyChildIds.indexOf(anchorParaId)
  const fIdx = bodyChildIds.indexOf(focusParaId)
  if (aIdx < 0 || fIdx < 0) return segments

  const lo = Math.min(aIdx, fIdx)
  const hi = Math.max(aIdx, fIdx)
  const loOff = aIdx === lo ? anchorOffset : focusOffset
  const hiOff = aIdx === hi ? anchorOffset : focusOffset

  for (let i = lo; i <= hi; i++) {
    const paraId = bodyChildIds[i]
    if (i === lo && i === hi) {
      if (loOff < hiOff) segments.push({ paraId, start: loOff, end: hiOff })
    } else if (i === lo) {
      segments.push({ paraId, start: loOff, end: INF })
    } else if (i === hi) {
      segments.push({ paraId, start: 0, end: hiOff })
    } else {
      segments.push({ paraId, start: 0, end: INF })
    }
  }
  return segments
}

// ================================================================
// 选区区域 (body / header / footer) 读序助手
// ================================================================

export type SelectionSection = 'body' | 'header' | 'footer'

/**
 * 区域**身份** (含页眉/页脚变体, 契约 §7.9)。
 * 同区判定必须用它而非 SelectionSection: `header` 与 `header:first` 是
 * 两个不同区域, 段落 id 不共享, 混选必须拒绝。
 */
export type SelectionRegionId = 'body' | `${HeaderFooterBand}:${HeaderFooterVariant}`

/** 段落所属区域身份 (body / header:variant / footer:variant) */
export function regionIdOf(paraId: string, doc: DocumentTree): SelectionRegionId {
  const loc = resolveHfParagraphLocation(doc, paraId)
  return loc ? `${loc.band}:${loc.variant}` : 'body'
}

/**
 * 选区读序 spine — anchor/focus 必须同区 (含变体)。
 *   body          → flattenTextContainers(body) (保留 body↔table 线性语义)
 *   header:variant → 该变体数组
 *   footer:variant → 该变体数组
 * 跨区 / 跨变体 (body↔header, header↔header:first 等) 返回 null。
 */
export function selectionSpine(
  doc: DocumentTree,
  pool: NodePool,
  anchorParaId: string,
  focusParaId: string,
): { section: SelectionSection; variant: HeaderFooterVariant | null; spine: string[] } | null {
  const aLoc = resolveHfParagraphLocation(doc, anchorParaId)
  if (regionIdOf(anchorParaId, doc) !== regionIdOf(focusParaId, doc)) return null
  if (!aLoc) return { section: 'body', variant: null, spine: flattenTextContainers(pool, doc.body.children) }
  return {
    section: aLoc.band,
    variant: aLoc.variant,
    spine: [...hfArrayOf(doc, aLoc.band, aLoc.variant)],
  }
}

/** 整区段落数组 (Ctrl+A / 需要整区时) — 页眉页脚须指明变体 */
export function regionSpine(
  doc: DocumentTree,
  pool: NodePool,
  section: SelectionSection,
  variant: HeaderFooterVariant = 'default',
): string[] {
  if (section === 'header' || section === 'footer') return [...hfArrayOf(doc, section, variant)]
  return flattenTextContainers(pool, doc.body.children)
}

/**
 * 全文档阅读顺序的文本容器 spine (查找/替换 / QC 的搜索范围)。
 *
 * 顺序: body (展平表格 cell 段落) → header 各变体 → footer 各变体。
 * 页眉/页脚段落每页都有副本, 但**文档里只有一份**, 故在此只出现一次。
 * 按 id 去重 (保留首次出现) — 防御同一段落被两个数组引用的异常文档。
 * 脚注/尾注不在其中 (无既有消费方, 属既有缺口)。
 */
export function documentSpine(doc: DocumentTree, pool: NodePool): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (id: string): void => {
    if (seen.has(id)) return
    seen.add(id)
    out.push(id)
  }
  for (const id of flattenTextContainers(pool, doc.body.children)) push(id)
  for (const arr of hfContainers(doc)) for (const id of arr) push(id)
  return out
}
