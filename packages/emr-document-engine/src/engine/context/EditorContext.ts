// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// EditorContext — 右键命中上下文只读快照 (契约 RULE 10)
//
// 引擎对 UI 消费者暴露「编辑器上下文快照」, 仅描述编辑器/文档事实:
//   - 命中点位置 (pageIndex + 页面局部坐标)
//   - 命中对象的种类与标识 (文本/表格/单元格/图片/分隔符/分节符/控件/页眉页脚/空白)
//   - 选区是否覆盖命中点 (coversSelection)
//
// 快照 MUST NOT 包含: 菜单项、UI 组件、菜单动作、React 状态、UI 专用命令。
// UI 层据此自行推导菜单呈现与可用动作。
//
// 本模块为纯函数, 无副作用, 可脱离 Editor/DOM 单测。
// ================================================================

import type { CaretScope, CellPosition } from '../state/CaretScope'
import type { SelectionState } from '../state/EditorRuntimeState'

// ---- 上下文种类 (可辨识联合, discriminated union) ----

/** 所有上下文快照共享的命中位置基座 */
export interface ContextBase {
  pageIndex: number
  localX: number
  localY: number
  /**
   * 命中点所属的 Section 事实 (契约 §31.2 R1)。
   *
   * **是一个"附加事实", 不是一个 `kind`** —— 与 `tableGrowable` /
   * `headerFooterSection` 同类: 边界采集事实, 纯函数消费。
   *
   * 为什么不新增 `kind: 'section'`: Section 没有任何可命中的 item
   * (HitTestIndex 只索引 page.items, 而 Section 不产出 item, 契约 §31.14),
   * 所以那个 kind **永远不可达**。用户永远是"在节**内容**里右键", 想让节的
   * 操作作用在**所包裹的节**上 —— 这正是附加事实的形状。而且新增 kind 会
   * **顶掉** `kind: 'text'`, 把用户此刻需要的剪切/复制/格式菜单整个删掉。
   *
   * 字段名刻意用 `sectionFact` **而不是** `section`: 后者已被
   * `HeaderFooterContext.section` 占用, 含义是"页眉带/页脚带" —— 与文档结构容器
   * Section 无关 (契约 §31.11 要求同名歧义必须改名)。
   */
  sectionFact: ContextSectionFact | null
}

/**
 * 命中点所属节的定位事实 —— 全部由边界 (Editor.resolveContextAt) 采集。
 *
 * 供右键菜单判断"节操作可不可用", 不承载任何文档状态。
 */
export interface ContextSectionFact {
  /** 最近祖先节 id (R1) */
  id: string
  /** 该节在同父兄弟中的**真实下标** (契约 §31.6) */
  index: number
  /** 同父兄弟总数 (供上移/下移的 enable 判断) */
  siblingCount: number
  /**
   * 能否在命中块之后插入新节 —— 即命中块的真实父容器落在 body / section (§31.13)。
   * 命中落在表格 cell 内时为 false (cell 里放 Section 是非法结构, 不是未支持)。
   */
  insertable: boolean
}

/** 正文文本命中 */
export interface TextContext extends ContextBase {
  kind: 'text'
  paragraphId: string
  paragraphPath: string[]
  offset: number
  scope: CaretScope
  coversSelection: boolean
}

/** 表格单元格内文本命中 */
export interface CellContext extends ContextBase {
  kind: 'cell'
  tableId: string
  row: number
  col: number
  paragraphId: string
  paragraphPath: string[]
  offset: number
  coversSelection: boolean
  /** 所在表是否声明「填写时可增长」(契约 §12.9) */
  tableGrowable: boolean
}

/** 表格命中 (未定位到单元格文本, 如空单元格/单元格边距) */
export interface TableContext extends ContextBase {
  kind: 'table'
  tableId: string
  /** 该表是否声明「填写时可增长」(契约 §12.9) */
  tableGrowable: boolean
}

/** 图片命中 */
export interface ImageContext extends ContextBase {
  kind: 'image'
  nodeId: string
}

/** 分隔符命中 */
export interface SeparatorContext extends ContextBase {
  kind: 'separator'
  nodeId: string
}

/** 分节符命中 */
export interface SectionBreakContext extends ContextBase {
  kind: 'sectionBreak'
  nodeId: string
}

/** 交互模式 (design/edit/form) smarttext 控件命中 */
export interface SmartTextContext extends ContextBase {
  kind: 'smartText'
  controlId: string
}

/** 页眉/页脚区域命中 */
export interface HeaderFooterContext extends ContextBase {
  kind: 'headerFooterRegion'
  section: 'header' | 'footer'
}

/** 空白命中 (页面内未命中任何对象) */
export interface BlankContext extends ContextBase {
  kind: 'blank'
}

export type EditorContextSnapshot =
  | BlankContext
  | HeaderFooterContext
  | SmartTextContext
  | TextContext
  | CellContext
  | TableContext
  | ImageContext
  | SeparatorContext
  | SectionBreakContext

// ---- 输入事实 (由 Editor.resolveContextAt 采集, 注入 buildContextSnapshot) ----

/** 段落文本命中事实 */
export interface TextHit {
  paragraphId: string
  paragraphPath: string[]
  offset: number
  scope: CaretScope
}

/**
 * 上下文解析输入 — Editor.resolveContextAt 完成坐标变换与 Level 1/2 命中后,
 * 将「文档事实」聚合为 ContextFacts, 交给纯函数 buildContextSnapshot 判别。
 */
export interface ContextFacts {
  /** Level 1 命中 nodeId (text 节点 / table / image / separator 块 id), 无命中为 null */
  nodeId: string | null
  /** Level 1 命中条目类型 ('table' | 'image' | 'separator' | 'section_break' | 'text' | ...) */
  entryType: string | null
  pageIndex: number
  localX: number
  localY: number
  /** 命中页眉/页脚区域, 无则 null */
  headerFooterSection: 'header' | 'footer' | null
  /** 设计模式 smarttext 控件命中, 无则 null */
  controlId: string | null
  /** 表格单元格位置 (仅 cell 命中), 无则 null */
  cellPosition: CellPosition | null
  /**
   * 命中的表是否声明「填写时可增长」(契约 §12.9)。
   * 本模块是纯函数, 该事实由边界 (Editor) 采集后传入。
   */
  tableGrowable: boolean
  /** 段落文本命中 (body 或 cell), 无则 null */
  textHit: TextHit | null
  /** 命中段落在其作用域内的有序兄弟段落 id (供跨段落选区覆盖判定), 无则 undefined */
  siblings?: readonly string[]
  /** 当前运行时选区 (用于计算 coversSelection) */
  selection: SelectionState
  /** 命中点所属节事实 (契约 §31.2 R1); 无则 null。与 tableGrowable 同类, 由边界采集 */
  sectionFact: ContextSectionFact | null
}

// ---- 纯函数 ----

/**
 * 判断选区是否覆盖给定文本命中点。
 *
 * - 未提供 `siblings` (作用域内有序兄弟段落 id) 时: 仅同段落内判定
 *   (anchor/focus/命中点同段落且命中偏移落在选区偏移区间内)。
 * - 提供 `siblings` 时: 支持跨段落选区覆盖判定 —
 *   选区覆盖 [lo 段落 loOff..段尾] + 中间段落整段 + [hi 段落段首..hiOff]。
 *   命中段落落在 lo..hi 之外返回 false; 落在边界段落按偏移判定; 落在中间返回 true。
 */
export function isCoversPoint(
  selection: SelectionState,
  point: { paragraphPath: string[]; offset: number },
  siblings?: readonly string[],
): boolean {
  if (!selection.active) return false

  const aId = selection.anchor.paragraphPath[selection.anchor.paragraphPath.length - 1]
  const fId = selection.focus.paragraphPath[selection.focus.paragraphPath.length - 1]
  const pId = point.paragraphPath[point.paragraphPath.length - 1]

  // 无兄弟顺序信息 → 仅同段落内判定
  if (!siblings) {
    if (aId !== fId || aId !== pId) return false
    const lo = Math.min(selection.anchor.offset, selection.focus.offset)
    const hi = Math.max(selection.anchor.offset, selection.focus.offset)
    return point.offset >= lo && point.offset <= hi
  }

  const ai = siblings.indexOf(aId)
  const fi = siblings.indexOf(fId)
  const pi = siblings.indexOf(pId)

  // 选区段落不在同一兄弟域 → 保守回退同段落判定
  if (ai < 0 || fi < 0) {
    if (aId !== fId || aId !== pId) return false
    const lo = Math.min(selection.anchor.offset, selection.focus.offset)
    const hi = Math.max(selection.anchor.offset, selection.focus.offset)
    return point.offset >= lo && point.offset <= hi
  }
  // 命中段落不在兄弟域 → 视为未覆盖
  if (pi < 0) return false

  const loIdx = Math.min(ai, fi)
  const hiIdx = Math.max(ai, fi)
  const loOff = ai === loIdx ? selection.anchor.offset : selection.focus.offset
  const hiOff = ai === hiIdx ? selection.anchor.offset : selection.focus.offset

  // 命中段落在选区范围之外
  if (pi < loIdx || pi > hiIdx) return false

  // 单段落选区: 此时 ai === fi === loIdx === hiIdx, loOff/hiOff 均被赋成
  // anchor.offset, 若直接 min/max 会退化成「仅覆盖 anchor 单点」。
  // 必须取 anchor/focus 两端的偏移归约, 与无 siblings 分支保持一致。
  if (loIdx === hiIdx) {
    const lo = Math.min(selection.anchor.offset, selection.focus.offset)
    const hi = Math.max(selection.anchor.offset, selection.focus.offset)
    return point.offset >= lo && point.offset <= hi
  }

  // 跨段落选区: 边界段落按偏移判定, 中间段落整段覆盖
  if (pi === loIdx) return point.offset >= loOff
  if (pi === hiIdx) return point.offset <= hiOff
  return true
}

/**
 * 依据采集到的事实构建上下文快照 (纯函数, 无副作用)。
 *
 * 判别顺序 (设计 v2):
 *   headerFooterRegion → smartText (design) → cell (cellPosition && textHit)
 *   → table → image / separator / sectionBreak → text → blank
 */
export function buildContextSnapshot(facts: ContextFacts): EditorContextSnapshot {
  const base: ContextBase = {
    pageIndex: facts.pageIndex,
    localX: facts.localX,
    localY: facts.localY,
    sectionFact: facts.sectionFact,
  }

  // 控件命中优先于页眉/页脚区域: 页眉/页脚带内的 smarttext 控件右键应得
  // smartText 上下文 (→ 属性菜单), 而非整块 headerFooterRegion。
  if (facts.controlId) {
    return { ...base, kind: 'smartText', controlId: facts.controlId }
  }

  if (facts.headerFooterSection) {
    return { ...base, kind: 'headerFooterRegion', section: facts.headerFooterSection }
  }

  if (facts.cellPosition && facts.textHit) {
    return {
      ...base,
      kind: 'cell',
      tableId: facts.cellPosition.tableId,
      row: facts.cellPosition.row,
      col: facts.cellPosition.col,
      paragraphId: facts.textHit.paragraphId,
      paragraphPath: facts.textHit.paragraphPath,
      offset: facts.textHit.offset,
      coversSelection: isCoversPoint(facts.selection, facts.textHit, facts.siblings),
      tableGrowable: facts.tableGrowable,
    }
  }

  if (facts.entryType === 'table' && facts.nodeId) {
    return { ...base, kind: 'table', tableId: facts.nodeId, tableGrowable: facts.tableGrowable }
  }
  if (facts.entryType === 'image' && facts.nodeId) {
    return { ...base, kind: 'image', nodeId: facts.nodeId }
  }
  if (facts.entryType === 'separator' && facts.nodeId) {
    return { ...base, kind: 'separator', nodeId: facts.nodeId }
  }
  if (facts.entryType === 'section_break' && facts.nodeId) {
    return { ...base, kind: 'sectionBreak', nodeId: facts.nodeId }
  }

  if (facts.textHit) {
    return {
      ...base,
      kind: 'text',
      paragraphId: facts.textHit.paragraphId,
      paragraphPath: facts.textHit.paragraphPath,
      offset: facts.textHit.offset,
      scope: facts.textHit.scope,
      coversSelection: isCoversPoint(facts.selection, facts.textHit, facts.siblings),
    }
  }

  return { ...base, kind: 'blank' }
}
