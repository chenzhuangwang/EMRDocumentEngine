// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// useEditorContextMenu — 右键菜单状态 + 动作分派 (UI 层)
//
// 持有菜单开关/位置/上下文快照; onContextMenu 委托 editor.resolveContextAt
// 采集只读快照, 并在右键命中点未覆盖选区时折叠选区、移动光标到命中点
// (Word 行为), 使后续格式/段落动作作用于点击位置而非原光标处。
// runAction 按 ContextMenuActionId 分派到 Editor 公共 API
// (复制/粘贴/删除 + 文本格式/段落样式/列表层级), 全部动作经 Command 系统
// 进入引擎 (契约 RULE 4)。
// ============================================================

import { useCallback, useMemo, useState } from 'react'
import type { EditorContextSnapshot } from '@/engine'
import { useEditorRef, useEditorStoreSnapshot } from './EditorProvider'
import { buildContextMenuModel, type ContextMenuActionId, type ContextMenuEntry } from './contextMenuModel'

interface ContextMenuState {
  open: boolean
  x: number
  y: number
  snapshot: EditorContextSnapshot | null
}

const CLOSED_STATE: ContextMenuState = { open: false, x: 0, y: 0, snapshot: null }

export interface UseEditorContextMenuOptions {
  /** 设计模式控件「属性」业务回调 (菜单只发 id, 由业务层映射到 Control Config Dialog) */
  onProperty?: (controlId: string) => void
}

export function useEditorContextMenu(options?: UseEditorContextMenuOptions) {
  const { onProperty } = options ?? {}
  const editorRef = useEditorRef()
  // 光标处样式投影 (供勾选状态) — 与工具栏共用同一 canonical 投影
  const textStyle = useEditorStoreSnapshot((s) => s.textStyle)
  const paragraphStyle = useEditorStoreSnapshot((s) => s.paragraphStyle)
  const [state, setState] = useState<ContextMenuState>(CLOSED_STATE)

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const editor = editorRef.current
    if (!editor) return
    const snapshot = editor.resolveContextAt(e.nativeEvent)
    // 右键在选区外 → 折叠选区并把光标移到命中点, 使格式/段落动作作用于点击位置。
    if ((snapshot.kind === 'text' || snapshot.kind === 'cell') && !snapshot.coversSelection) {
      editor.collapseSelectionToPoint(snapshot.paragraphPath, snapshot.offset)
    }
    // 设计模式右键控件: Word 式「命中即选中」— 右键 B 时 B 成为属性目标 (契约 §12.7)。
    if (snapshot.kind === 'smartText') {
      editor.selectControl(snapshot.controlId)
    }
    setState({ open: true, x: e.clientX, y: e.clientY, snapshot })
  }, [editorRef])

  const close = useCallback(() => {
    // 右键命中控件 → 菜单关闭(未走「属性」)时也要清除选中态, 否则高亮残留
    if (state.open && state.snapshot?.kind === 'smartText') {
      editorRef.current?.selectControl(null)
    }
    setState((s) => (s.open ? { ...s, open: false } : s))
  }, [editorRef, state.open, state.snapshot])

  const entries: ContextMenuEntry[] = useMemo(
    () => (state.snapshot ? buildContextMenuModel(state.snapshot, { textStyle, paragraphStyle }).entries : []),
    [state.snapshot, textStyle, paragraphStyle],
  )

  const runAction = useCallback((id: ContextMenuActionId) => {
    const editor = editorRef.current
    if (!editor) return
    switch (id) {
      // 剪贴板/删除 (P0 / P1-b / P1-c)
      case 'cut': editor.cut(); break
      case 'copy': {
        const snap = state.snapshot
        if (snap?.kind === 'image') editor.copyImage(snap.nodeId)
        else editor.copy()
        break
      }
      case 'paste': editor.paste(); break
      case 'delete': {
        const snap = state.snapshot
        if (snap?.kind === 'image') {
          // image 右键删除 — 整节点 (设计 v2 §6)
          editor.deleteNode(snap.nodeId)
        } else if (snap?.kind === 'smartText') {
          // 控件右键删除 — 走 RemoveControlCommand (deletable 守卫, §12.1)
          editor.deleteSelectedControl()
        } else if (snap?.kind === 'text') {
          // body 段: 覆盖选区删选区, 折叠选区删整段 (P1-c)
          if (snap.coversSelection) editor.deleteSelection()
          else editor.deleteNode(snap.paragraphId)
        } else {
          // cell / 其余: 仅删选区 (原子, 跨段落选区亦一次 undo)
          editor.deleteSelection()
        }
        break
      }
      // 表格结构删除 (P2): 仅 cell 命中时执行
      case 'deleteRow': {
        const snap = state.snapshot
        if (snap?.kind === 'cell') editor.deleteTableRowAt(snap.tableId, snap.row)
        break
      }
      case 'deleteColumn': {
        const snap = state.snapshot
        if (snap?.kind === 'cell') editor.deleteTableColumnAt(snap.tableId, snap.row, snap.col)
        break
      }
      // 文本格式 (P1-a)
      case 'bold': editor.toggleFormat({ bold: true }); break
      case 'italic': editor.toggleFormat({ italic: true }); break
      case 'underline': editor.toggleFormat({ underline: true }); break
      case 'strikeout': editor.toggleFormat({ strikeout: true }); break
      case 'clearFormat': editor.clearFormat(); break
      // 段落样式 (P1-a)
      case 'alignLeft': editor.setParagraphStyle({ alignment: 'left' }); break
      case 'alignCenter': editor.setParagraphStyle({ alignment: 'center' }); break
      case 'alignRight': editor.setParagraphStyle({ alignment: 'right' }); break
      case 'alignJustify': editor.setParagraphStyle({ alignment: 'justify' }); break
      // 列表层级 (P1-a): Tab / Shift+Tab 语义
      case 'increaseIndent': editor.adjustListLevel(1); break
      case 'decreaseIndent': editor.adjustListLevel(-1); break
      // 控件属性 (P3, 设计模式 smartText): 菜单只发 id, 弹框由业务层映射
      case 'properties': {
        const snap = state.snapshot
        if (snap?.kind === 'smartText') onProperty?.(snap.controlId)
        break
      }
    }
    close()
    // 恢复焦点到编辑器隐藏 textarea: Radix DropdownMenu 关闭时 onCloseAutoFocus
    // 被 preventDefault, 焦点会丢失到 body, 导致引擎容器级快捷键 (Ctrl+Z 等) 失效。
    editor.focus()
  }, [editorRef, close, state, onProperty])

  return {
    open: state.open,
    x: state.x,
    y: state.y,
    entries,
    onContextMenu,
    close,
    runAction,
  }
}
