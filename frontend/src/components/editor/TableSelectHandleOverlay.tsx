// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// TableSelectHandleOverlay — 表格左上角的「选中表格」悬浮手柄 (契约 §31.3.1)
//
// 鼠标移到表格上时，在表格左上角外侧显示一个 16px 手柄；点它调用
// Editor.selectWholeTable(tableId)，整表进入块级选中态（Delete 可删表）。
//
// 几何与画布同源: Editor.getTableClientRects → Draw.getTableClientRects
// （canvasRect + scale + offsetX，pageY 扣 scrollY），不另算一套坐标。
// 后台标签页 rAF 被挂起 → 250ms 轮询兜底（仓库既有坑）。
// ================================================================

import { useEffect, useRef, useState } from 'react'
import { Grip } from 'lucide-react'
import { useEditorReady, useEditorRef, useEditorStoreSnapshot } from './EditorProvider'
import { useTranslation } from '@/i18n/useTranslation'

function raf(cb: FrameRequestCallback): number {
  return typeof requestAnimationFrame !== 'undefined'
    ? requestAnimationFrame(cb)
    : window.setTimeout(() => cb(Date.now()), 16)
}
function caf(id: number): void {
  if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(id)
  else window.clearTimeout(id)
}

/** 后台标签页的轮询间隔 (rAF 被挂起时的兜底节奏) */
const HIDDEN_POLL_MS = 250
const HANDLE_SIZE = 16
const HANDLE_OFFSET = 18
const HIT_SLACK = 6

interface HoverState {
  tableId: string
  left: number
  top: number
}

export function TableSelectHandleOverlay() {
  const editorRef = useEditorRef()
  const ready = useEditorReady()
  const mode = useEditorStoreSnapshot((s) => s.runtime.view.mode)
  const { t } = useTranslation()

  const visibleMode = mode === 'edit' || mode === 'design'
  const mouseRef = useRef<{ x: number; y: number } | null>(null)
  const hoverRef = useRef<HoverState | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)

  const updateHover = (next: HoverState | null): void => {
    const prev = hoverRef.current
    if (prev === next) return
    if (prev && next && prev.tableId === next.tableId &&
        prev.left === next.left && prev.top === next.top) return
    hoverRef.current = next
    setHover(next)
  }

  // 鼠标位置: window 级监听 (叠加层本身 pointer-events:none)
  useEffect(() => {
    const onMove = (e: MouseEvent) => { mouseRef.current = { x: e.clientX, y: e.clientY } }
    const onLeave = () => { mouseRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  // 逐帧读表格几何 + 命中鼠标
  useEffect(() => {
    if (!ready || !visibleMode) { updateHover(null); return }
    let cancelled = false
    let cancelScheduled: (() => void) | null = null

    const schedule = () => {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.hidden) {
        const id = window.setTimeout(run, HIDDEN_POLL_MS)
        cancelScheduled = () => window.clearTimeout(id)
      } else {
        const id = raf(run)
        cancelScheduled = () => caf(id)
      }
    }

    function run() {
      if (cancelled) return
      const ed = editorRef.current
      const mouse = mouseRef.current
      if (!ed || !mouse) {
        updateHover(null)
        schedule()
        return
      }

      const rects = ed.getTableClientRects()
      let next: HoverState | null = null
      let keptCurrent = false

      // 鼠标已在手柄上 → 保持当前手柄 (否则离开表格矩形手柄会先消失, 点不到)
      const cur = hoverRef.current
      if (cur && mouse.x >= cur.left && mouse.x <= cur.left + HANDLE_SIZE &&
          mouse.y >= cur.top && mouse.y <= cur.top + HANDLE_SIZE) {
        next = cur
        keptCurrent = true
      }

      if (!keptCurrent) {
        for (const [tableId, r] of rects) {
          if (mouse.x < r.left - HIT_SLACK || mouse.x > r.left + r.width + HIT_SLACK) continue
          if (mouse.y < r.top - HIT_SLACK || mouse.y > r.top + r.height + HIT_SLACK) continue
          next = {
            tableId,
            left: Math.max(4, r.left - HANDLE_OFFSET),
            top: Math.max(4, r.top - HANDLE_OFFSET),
          }
          break
        }
      }

      updateHover(next)
      schedule()
    }

    schedule()
    return () => { cancelled = true; cancelScheduled?.() }
  }, [ready, visibleMode, editorRef])

  if (!visibleMode || !hover) return null

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 35 }}>
      <button
        type="button"
        data-table-select-handle={hover.tableId}
        title={t('editor.table.selectHandle')}
        aria-label={t('editor.table.selectHandle')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const ed = editorRef.current
          if (!ed) return
          ed.selectWholeTable(hover.tableId)
          // 焦点交回编辑器: 否则 Delete/Backspace 到不了容器级快捷键
          ed.focus()
          setHover(null)
        }}
        style={{
          position: 'fixed',
          left: hover.left,
          top: hover.top,
          width: HANDLE_SIZE,
          height: HANDLE_SIZE,
          pointerEvents: 'auto',
        }}
        className="flex items-center justify-center rounded-sm border border-chrome-border
                   bg-chrome-surface text-chrome-ink-muted shadow-sm hover:bg-chrome-hover"
      >
        <Grip size={12} />
      </button>
    </div>
  )
}
