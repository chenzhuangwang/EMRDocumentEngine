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
   * 段落定位: ID 链路路径
   * 格式: [documentRootId, regionRootId, ..., paragraphId]
   * 末段永远是"可定位的文本容器节点"(Paragraph 或 FootnoteContent 等)
   *
   * 示例:
   *   ['doc_1', 'body_root', 'para_3']    — 正文第 3 段
   *   ['doc_1', 'header_root', 'para_h1'] — 页眉内段落
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
      mode: 'edit', scale: 1, showInvisible: false,
    },
    ime: { composing: false, compositionText: '' },
    history: {
      canUndo: false, canRedo: false,
      undoDepth: 0, redoDepth: 0,
    },
  }
}
