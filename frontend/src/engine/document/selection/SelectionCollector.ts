// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

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
import { childTypesOf } from '../core/ContainerChildTypes'
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

/**
 * 遍历器所需的最小只读池视图 (契约 §31)。
 *
 * 逻辑流只回答"按阅读顺序下一个是什么", 只需按 id 查类型 —— 故此处刻意不依赖
 * `NodePool` 的完整 API: document/io 的序列化与 lib/ 的导出这类只读消费方
 * 不必持有可变池引用。NodePool 结构上满足本接口。
 */
export interface SpinePool {
  nodes: ReadonlyMap<string, { type: string; children?: readonly string[] }>
}

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

/**
 * 读取段落 [start,end) 区间内的纯文本 —— 供批注锚定摘录等 UI 展示。
 * 字符计数口径与 paragraphTextLength 一致 (文本计 length, 非文本内联计 1
 * 但**不产出字符**), 否则摘录会与光标/范围解析错位。
 */
export function paragraphTextInRange(
  pool: NodePool, paraId: string, start: number, end: number,
): string {
  const para = pool.nodes.get(paraId)
  if (!para || para.type !== NodeType.PARAGRAPH) return ''
  const children = (para as { children?: readonly string[] }).children
  if (!children) return ''

  let offset = 0
  let out = ''
  for (const childId of children) {
    const node = pool.nodes.get(childId)
    const isText = node?.type === NodeType.TEXT
    const len = isText ? (node as TextNode).text.length : 1
    const nodeStart = offset
    const nodeEnd = offset + len
    offset = nodeEnd
    if (!isText) continue                              // 原子内联不产出字符
    if (nodeEnd <= start || nodeStart >= end) continue  // 与区间无交
    const text = (node as TextNode).text
    out += text.slice(Math.max(0, start - nodeStart), Math.min(len, end - nodeStart))
  }
  return out
}

/** 收集段落 [start,end) 内重叠的所有文本节点 id (end 可为 INF) */export function collectTextNodeIds(
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
 * 展平块级序列为「阅读顺序的文本容器序列」— 表格展开为 cell 内段落
 * (行主序、每行按 cell 顺序), 其余块 (paragraph/image/separator/...) 保留原 id。
 *
 * 展开是**递归**的 (契约 §31.3 W3 / §31.13): cell 里的嵌套表按其内层 cell 段落
 * 展开, 而不是把嵌套表的 id 本身当作段落推出去。此前是无条件 `push(paraId)`,
 * 于是一个格内表/格内节会让表 id 泄漏进段落流 —— 依赖"每个 id 都是段落"的
 * 消费方 (字数统计 / QC / 复制 / 选区展平) 随之静默算错。
 *
 * 选区、复制、渲染的线性定位都基于此序列: cell 段落不在 body.children,
 * 若不展平, body↔table 跨域选区会 indexOf=-1 被整体丢弃
 * (「全选选不中表格」/ 从正文拖拽选区进表格选不中的根因)。
 *
 * 低层原语 — 新调用方请用 `bodyParagraphSpine` (契约 §31.3 W3),
 * 它先经 `bodyBlockSpine` 做类型校验与 Section 展开。
 */
export function flattenTextContainers(
  pool: SpinePool,
  bodyChildIds: readonly string[],
): string[] {
  const out: string[] = []
  pushFlattened(pool, bodyChildIds, out)
  return out
}

function pushFlattened(
  pool: SpinePool,
  ids: readonly string[],
  out: string[],
): void {
  for (const id of ids) {
    const node = pool.nodes.get(id)
    if (node?.type === NodeType.TABLE) {
      expandTable(pool, node as { children?: readonly string[] }, out)
    } else {
      out.push(id)
    }
  }
}

/** 表格 → 行主序、每行按 cell 顺序的内层段落序列 (cell 内嵌套表递归展开) */
function expandTable(
  pool: SpinePool,
  table: { children?: readonly string[] },
  out: string[],
): void {
  for (const rowId of table.children ?? []) {
    const row = pool.nodes.get(rowId) as { children?: readonly string[] } | undefined
    for (const cellId of row?.children ?? []) {
      const cell = pool.nodes.get(cellId) as { children?: readonly string[] } | undefined
      pushFlattened(pool, cell?.children ?? [], out)
    }
  }
}

// ================================================================
// 文档遍历器 (契约 §31) — 结构树 vs 逻辑文档流的唯一实现
//
// 铁律: 「是什么」走结构树 (`pool.getChildren`), 「按什么顺序读」走这里。
// 两者永不互换 —— 写路径 / 序列化 / 容器身份 / 归属解析一律不得用本模块。
//
//   W1  collectDocumentNodes   序列化可达节点 (document/io/DocumentSerializer)
//   W2  bodyBlockSpine         块级逻辑流 (Section 就地展开, 自身不入列)
//   W3  bodyParagraphSpine     段落逻辑流 = W2 ∘ 表格展开
//   W4  sectionsOf             节枚举 (前序, 含 Section 自身)
//   R1  sectionOf              节归属 (最近祖先)
//   R2  resolveParagraphRegion 段落所在区域 + 真实兄弟数组 (state/CaretScope)
//
// 本模块是唯一允许遍历 `doc.body.children` 的逻辑流入口; 静态闸门
// (DocumentWalkGate.test.ts) 保证模块外不得自行遍历。
// ================================================================

/**
 * body / Section 直接子节点允许出现的类型 —— **派生自契约 §31.13 的唯一事实源**,
 * 不在此另留一份私有副本 (§11)。两张表都含 `section` 自身 (契约里 Section 可
 * 嵌 Section), 但 pushBlockIds 的 SECTION 分支先短路并就地展开, 故它永不落到
 * 这张表的判定上 —— 行为与派生前逐字相同。
 */
const BODY_BLOCK_TYPES: ReadonlySet<string> = childTypesOf(NodeType.DOCUMENT)

/** Section 的直接子节点允许出现的类型 — 块级内容或嵌套 Section (契约 §31.10) */
const SECTION_CHILD_TYPES: ReadonlySet<string> = childTypesOf(NodeType.SECTION)

/** 逻辑流遇到未知块类型时抛出 — 静默丢弃内容是比报错更坏的失败 (契约 §31.5) */
export class BodySpineError extends Error {
  constructor(nodeId: string, type: string) {
    // 开发者可见的不变量诊断 (与 NodePool 的 addNode/removeOrphanLeaf 报错同构),
    // 不是用户可见文案 —— 故不接 i18n (I18nGate 的 EXEMPT 判据即"中文在这里是不是内容")。
    super(`bodyBlockSpine: unknown body child type ${type} (node ${nodeId})`)
    this.name = 'BodySpineError'
  }
}

/**
 * W2 — 块级逻辑流: body 的阅读顺序块序列 (契约 §31.3)。
 *
 * - Section 就地展开 (递归), **Section 自身不入列** (它不是内容, 是容器)
 * - section_break **入列** (Layout 需要它产出标记行)
 * - visited 语义: 每个 id 至多产出一次 —— 跨父重复归属的脏数据不得重复产出,
 *   也同时使自引用/环状 Section 不可能无限递归
 * - 未知类型 → 抛 BodySpineError
 */
export function bodyBlockSpine(doc: DocumentTree, pool: SpinePool): string[] {
  const out: string[] = []
  const visited = new Set<string>()
  pushBlockIds(doc.body.children, pool, out, visited, false)
  return out
}

function pushBlockIds(
  ids: readonly string[],
  pool: SpinePool,
  out: string[],
  visited: Set<string>,
  nested: boolean,
): void {
  for (const id of ids) {
    if (visited.has(id)) continue
    visited.add(id)
    const node = pool.nodes.get(id)
    if (!node) continue // 悬空引用已由 DocumentLoader.validate 拦截, 此处静默跳过
    if (node.type === NodeType.SECTION) {
      // Section 是容器: 就地展开, 自身不入列 (契约 §31.3)。Section 恒可为
      // body 直接子节点或另一 Section 的子节点 —— 与是否嵌套无关。
      const children = (node as { children?: readonly string[] }).children ?? []
      pushBlockIds(children, pool, out, visited, true)
      continue
    }
    const allowed = nested ? SECTION_CHILD_TYPES : BODY_BLOCK_TYPES
    if (!allowed.has(node.type)) throw new BodySpineError(id, node.type)
    out.push(id)
  }
}

/**
 * W3 — 段落逻辑流 = W2 ∘ 表格展开 (契约 §31.3)。
 *
 * 对**无 Section 文档**输出与旧 `flattenTextContainers(pool, doc.body.children)`
 * 逐元素一致 (P0 零行为变更的判据)。
 */
export function bodyParagraphSpine(doc: DocumentTree, pool: SpinePool): string[] {
  return flattenTextContainers(pool, bodyBlockSpine(doc, pool))
}

// ---- 节遍历器 (契约 §31.2 W4 / R1) ----

/**
 * W4 — `sectionsOf(doc, pool)`: 文档中的全部 Section, **前序** (文档顺序),
 * **含 Section 自身** (契约 §31.2)。
 *
 * 与 W2/W3 的区别是刻意的: W2/W3 回答"按阅读顺序下一个是什么" (Section 是容器,
 * 就地展开、自身不入列); W4 回答"有哪些节" —— 这是**结构事实**, 用于大纲投影、
 * 节级命令、结构化导出。二者不可互换 (契约 §31.1)。
 *
 * 嵌套 Section 一并收入, 且父先于子 (前序)。
 */
export function sectionsOf(doc: DocumentTree, pool: SpinePool): string[] {
  const out: string[] = []
  const visited = new Set<string>()
  const walk = (ids: readonly string[]): void => {
    for (const id of ids) {
      if (visited.has(id)) continue
      visited.add(id)
      const node = pool.nodes.get(id)
      if (!node || node.type !== NodeType.SECTION) continue
      out.push(id)
      const children = (node as { children?: readonly string[] }).children ?? []
      walk(children)
    }
  }
  walk(doc.body.children)
  return out
}

/**
 * R1 — `sectionOf(nodeId, pool)`: nodeId 的**最近**祖先 Section, 无则 null
 * (契约 §31.2)。
 *
 * "最近"是硬要求: `Section A > Section A1 > Paragraph` 时返回 A1, 不是 A。
 * Section 自身作为 nodeId 时返回其**父** Section (不是它自己) —— 归属问的是
 * "我被谁拥有"。
 */
export function sectionOf(nodeId: string, pool: SpinePool): string | null {
  let current = nodeId
  const seen = new Set<string>([nodeId])
  for (;;) {
    let parent: string | null = null
    for (const [id, node] of pool.nodes) {
      if (seen.has(id)) continue
      const children = (node as { children?: readonly string[] }).children
      if (children?.includes(current)) { parent = id; break }
    }
    if (parent === null) return null
    const p = pool.nodes.get(parent)
    if (p?.type === NodeType.SECTION) return parent
    if (seen.has(parent)) return null // 环状脏数据: 不无限上溯
    seen.add(parent)
    current = parent
  }
}

// ---- 结构侧助手 (真实下标 / 真实兄弟, 不是逻辑流) ----

/** body 中段落数 (守卫口径, 契约 §31.7) — 遍历走 W2, 保证 Section 展开后口径一致 */
export function bodyParagraphCount(doc: DocumentTree, pool: SpinePool): number {
  let n = 0
  for (const id of bodyBlockSpine(doc, pool)) {
    if (pool.nodes.get(id)?.type === NodeType.PARAGRAPH) n++
  }
  return n
}

/**
 * 初始光标落点 — W3 首个段落 → 否则 W2 首个块 → 否则 [] (契约 §31.5)。
 * 旧实现取 `body.children[0]` 而不校验类型, 首块是表格/图片时光标落在一个
 * 非文本容器上 (静默失效)。
 */
export function initialCursorParaPath(doc: DocumentTree, pool: SpinePool): string[] {
  for (const id of bodyParagraphSpine(doc, pool)) {
    if (pool.nodes.get(id)?.type === NodeType.PARAGRAPH) return [doc.id, id]
  }
  const blocks = bodyBlockSpine(doc, pool)
  return blocks.length > 0 ? [doc.id, blocks[0]] : []
}

/** 同上, 但在**块级逻辑流**上找 (契约 §31.3 W2) — 供方向键跨块导航 */
export function nearestParagraphInSpine(
  spine: readonly string[],
  pool: SpinePool,
  fromIndex: number,
  dir: 1 | -1,
): string | null {  for (let i = fromIndex + dir; i >= 0 && i < spine.length; i += dir) {
    if (pool.nodes.get(spine[i])?.type === NodeType.PARAGRAPH) return spine[i]
  }
  return null
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
  if (!aLoc) return { section: 'body', variant: null, spine: bodyParagraphSpine(doc, pool) }
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
  return bodyParagraphSpine(doc, pool)
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
  for (const id of bodyParagraphSpine(doc, pool)) push(id)
  for (const arr of hfContainers(doc)) for (const id of arr) push(id)
  return out
}
