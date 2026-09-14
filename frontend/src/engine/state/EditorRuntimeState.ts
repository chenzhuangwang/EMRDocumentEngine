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

// ---- Selection 工具 ----

export function isCollapsed(sel: SelectionState): boolean {
  return (
    sel.anchor.paragraphPath.join('.') === sel.focus.paragraphPath.join('.') &&
    sel.anchor.offset === sel.focus.offset
  )
}

// ---- ViewState ----

export type EditorMode = 'edit' | 'readonly' | 'form' | 'clean' | 'design' | 'print'
export type PageMode = 'paging' | 'linkage'

export interface ViewState {
  mode: EditorMode
  pageMode: PageMode
  scale: number
  showInvisible: boolean
  scroll: { x: number; y: number }
  visiblePages: { start: number; end: number }
}

// ---- IMEState ----

export interface IMEState {
  composing: boolean
  compositionText: string
  compositionAnchor: CursorState | null
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
      mode: 'edit', pageMode: 'paging', scale: 1, showInvisible: false,
      scroll: { x: 0, y: 0 },
      visiblePages: { start: 0, end: 0 },
    },
    ime: {
      composing: false, compositionText: '',
      compositionAnchor: null,
    },
    history: {
      canUndo: false, canRedo: false,
      undoDepth: 0, redoDepth: 0,
    },
  }
}
