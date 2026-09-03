// ============================================================
// useEditorContextMenu — 右键菜单状态 + 动作分派 (UI 层)
//
// 持有菜单开关/位置/上下文快照; onContextMenu 委托 editor.resolveContextAt
// 采集只读快照; runAction 按 ContextMenuActionId 分派到 Editor 公共 API
// (复制/粘贴/删除), 全部动作经 Command 系统进入引擎 (契约 RULE 4)。
// ============================================================

import { useCallback, useMemo, useState } from 'react'
import type { EditorContextSnapshot } from '@/engine'
import { useEditorRef } from './EditorProvider'
import { buildContextMenuModel, type ContextMenuActionId, type ContextMenuItem } from './contextMenuModel'

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
    setState({ open: true, x: e.clientX, y: e.clientY, snapshot })
  }, [editorRef])

  const close = useCallback(() => {
    setState((s) => (s.open ? { ...s, open: false } : s))
  }, [])

  const items: ContextMenuItem[] = useMemo(
    () => (state.snapshot ? buildContextMenuModel(state.snapshot).items : []),
    [state.snapshot],
  )

  const runAction = useCallback((id: ContextMenuActionId) => {
    const editor = editorRef.current
    if (!editor) return
    switch (id) {
      case 'copy': editor.copy(); break
      case 'paste': editor.paste(); break
      case 'delete': editor.deleteSelectedRange(); break
    }
    close()
  }, [editorRef, close])

  return {
    open: state.open,
    x: state.x,
    y: state.y,
    items,
    onContextMenu,
    close,
    runAction,
  }
}
