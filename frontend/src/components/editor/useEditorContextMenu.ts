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
import { useEditorRef } from './EditorProvider'
import { buildContextMenuModel, type ContextMenuActionId, type ContextMenuEntry } from './contextMenuModel'

interface ContextMenuState {
  open: boolean
  x: number
  y: number
  snapshot: EditorContextSnapshot | null
}

const CLOSED_STATE: ContextMenuState = { open: false, x: 0, y: 0, snapshot: null }

export function useEditorContextMenu() {
  const editorRef = useEditorRef()
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
    setState({ open: true, x: e.clientX, y: e.clientY, snapshot })
  }, [editorRef])

  const close = useCallback(() => {
    setState((s) => (s.open ? { ...s, open: false } : s))
  }, [])

  const entries: ContextMenuEntry[] = useMemo(
    () => (state.snapshot ? buildContextMenuModel(state.snapshot).entries : []),
    [state.snapshot],
  )

  const runAction = useCallback((id: ContextMenuActionId) => {
    const editor = editorRef.current
    if (!editor) return
    switch (id) {
      // 剪贴板/删除 (P0)
      case 'copy': editor.copy(); break
      case 'paste': editor.paste(); break
      case 'delete': editor.deleteSelectedRange(); break
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
    }
    close()
  }, [editorRef, close])

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
