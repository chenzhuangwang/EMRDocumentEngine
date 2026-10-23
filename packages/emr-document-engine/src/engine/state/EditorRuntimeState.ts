// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// EditorRuntimeState — 运行时状态模型 (架构 §4.1, v20.34)
//
// 不持久化、不参与协作同步、仅在前端内存中
// 与 DocumentTree 并列为 Editor 的两大数据源
// ================================================================

import type { HistoryState } from './HistoryState'

// ---- CursorState ----

export interface CursorState {
  /**
   * 段落定位: `[documentRootId, paragraphId]` —— **恒为 2 元素** (契约 §31.4)。
   *
   * 末元素永远是"可定位的文本容器节点"(Paragraph / FootnoteContent 等)。
   * 全仓库的构造点 (HitTestIndex / Editor / MouseHandler / 派生命令的
   * `[...path.slice(0,-1), newParaId]`) 都产 2 元素路径; 不存在 3+ 元素路径,
   * 也不存在 `body_root` / `header_root` 这类中间节点。
   *
   * **祖先信息不在此承载**: 段落所在的容器 (body / cell / header / footer /
   * section) 一律在使用点现场解析 —— `resolveParagraphRegion` /
   * `resolveCellPosition` / `resolveHfParagraphLocation`, 走的是"段落 id → 扫池
   * 找父", 与路径深度无关。因此 Section 的加入**不改变**本字段的格式。
   *
   * 不要在路径里插入容器 id: `path[length-2]` 的兜底语义
   * (SplitParagraphCommand / InsertNodesCommand) 会随之静默改变。
   */
  paragraphPath: string[]
  /** 字符偏移: 在该段落全部可见文本中的 UTF-16 码元偏移 (0..totalTextLength) */
  offset: number
  visible: boolean
}

// ---- SelectionState ----

export type SelectionGranularity = 'character' | 'node' | 'block' | 'table'

export interface SelectionState {
  anchor: CursorState
  focus: CursorState
  active: boolean
  granularity: SelectionGranularity
}

// ---- ViewState ----

export type EditorMode = 'edit' | 'readonly' | 'form' | 'clean' | 'design' | 'print'

/**
 * 视图状态。
 *
 * 这里刻意**只留真正被读写的字段**。原先还有 `pageMode` / `scroll` /
 * `visiblePages` 三个字段, 全仓除默认值外零读写 —— 它们会让人以为"连页模式"
 * 和"视口页范围记录"已经存在 (实际滚动位置在 CoordinateSystem.transform.scrollY,
 * 可见页范围由 LayoutEngine.getVisiblePages 按需算, 都不需要在这里存一份)。
 * 真要做视口虚拟化时再按需加回来, 而不是留三个空槽让人误判。
 */
export interface ViewState {
  mode: EditorMode
  scale: number
  showInvisible: boolean
  /**
   * 画布上是否显示修订留痕 (修订色 + 删除线; 契约 §12.13)。
   *
   * 纯**视图**开关: 关掉只改绘制, 文档内容 / 布局 / 序列化字节全部不变。
   * 与 `EditorMode.clean` 无关 —— clean 是只读模式, 不是"留痕模式"。
   */
  showRevisionMarks: boolean
  /**
   * 画布上是否显示批注强调层 (正常高亮 + 锚点标记; 契约 §12.14)。
   *
   * 纯**视图**开关: 关闭后锚定文字仍保留一层淡底色 (让人仍能看出哪里有
   * 批注), 只是去掉强调高亮与锚点标记。文档内容 / 布局 / 序列化字节不变。
   */
  showCommentMarks: boolean
  /**
   * 画布上是否显示 Section 结构 (左侧细线 + sectionCode 标签)。
   *
   * 纯 UI 层开关: 只影响 DOM 叠加层 (SectionStructureOverlay), **不参与排版、
   * 不进 Draw/Canvas、不影响分页**。关掉它 Section 的结构/命令/选区/序列化/历史
   * 全部照常 (契约 §31.14)。
   */
  showSectionStructure: boolean
}

// ---- IMEState ----

export interface IMEState {
  composing: boolean
  compositionText: string
}

// ---- EditorRuntimeState ----

export interface EditorRuntimeState {
  cursor: CursorState
  selection: SelectionState
  view: ViewState
  ime: IMEState
  history: HistoryState
}

// ---- 默认值 ----

export function createDefaultRuntimeState(): EditorRuntimeState {
  return {
    cursor: { paragraphPath: [], offset: 0, visible: true },
    selection: {
      anchor: { paragraphPath: [], offset: 0, visible: false },
      focus: { paragraphPath: [], offset: 0, visible: false },
      active: false,
      granularity: 'character',
    },
    view: {
      mode: 'edit', scale: 1, showInvisible: false, showSectionStructure: true,
      showRevisionMarks: true, showCommentMarks: true,
    },
    ime: { composing: false, compositionText: '' },
    history: {
      canUndo: false, canRedo: false,
      undoDepth: 0, redoDepth: 0,
    },
  }
}
