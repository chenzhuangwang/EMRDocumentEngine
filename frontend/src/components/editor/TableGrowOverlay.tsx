// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// TableGrowOverlay — 可增长表的「+ 添加行」入口 (契约 §12.9, PRD F8.2)
//
// 每个声明了 Table.dynamicRows 的表, 在其表尾挂一个显式按钮。点击经
// Editor.appendTableRow → AppendTableRowCommand (克隆末行结构含控件)。
//
// 为什么是叠加层而不是画在 Canvas 上: 按钮不参与文档排版与回流, 画进
// Canvas 会污染渲染命中测试 (与 RuntimeControlOverlay 同理由)。
//
// 边界:
//   - 编辑/表单模式 → 表尾挂「+ 添加行」**按钮** (可交互)。
//   - 设计模式 → 表尾挂「可增长」**只读标记** (pointer-events:none)。
//     没有它的话, 勾选「填写时可增长」在设置它的那个模式里毫无反馈 ——
//     必须切到编辑/表单才能看到按钮冒出来。
//   - 只读/纯文本/打印 → 什么都不渲染。
//     真正的强制在命令层 —— 非可增长表 append 必被拒 (§12.9)。
//   - 表 id 列表跟随 contentChange 同步 (不全量扫池于每帧); 几何每帧读
//     getTableClientRect, 仅数值变化才重渲染 (与 RuntimeControlOverlay 同法)。
// ================================================================

import { useEffect, useState } from 'react'
import { Plus, Rows3 } from 'lucide-react'
import { useEditorReady, useEditorRef, useEditorStoreSnapshot } from './EditorProvider'
import { useTranslation } from '@/i18n/useTranslation'

/** jsdom 无 rAF → setTimeout 兜底 (与 RuntimeControlOverlay 同法) */
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

interface GrowEntry {
  tableId: string
  left: number
  top: number
  width: number
  height: number
}

function sameEntries(a: GrowEntry[], b: GrowEntry[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]; const y = b[i]
    if (x.tableId !== y.tableId || x.left !== y.left || x.top !== y.top ||
        x.width !== y.width || x.height !== y.height) return false
  }
  return true
}

export function TableGrowOverlay() {
  const editorRef = useEditorRef()
  // 必须等 ready: 子组件的 mount effect 跑在 EditorProvider 建 Editor 之前,
  // 此时 editorRef.current 仍为 null —— 直接在 mount effect 里订阅会静默漏绑
  // (editorRef 是稳定引用, 不会自己触发重跑)。
  const ready = useEditorReady()
  const mode = useEditorStoreSnapshot((s) => s.runtime.view.mode)
  const { t } = useTranslation()
  /** 可交互: 表尾是「+ 添加行」按钮 */
  const editable = mode === 'edit' || mode === 'form'
  /** 设计态: 表尾是只读标记, 让「可增长」声明在设置它的模式里立即可见 */
  const design = mode === 'design'
  const visible = editable || design

  const [tableIds, setTableIds] = useState<string[]>([])
  const [entries, setEntries] = useState<GrowEntry[]>([])

  // 可增长表 id 列表: 跟随 contentChange 同步 (开关切换 / 表增删都会触发)
  useEffect(() => {
    const ed = editorRef.current
    if (!ready || !ed) return
    const sync = () => {
      const next = ed.listGrowableTables()
      setTableIds((prev) => (
        prev.length === next.length && prev.every((id, i) => id === next[i]) ? prev : next
      ))
    }
    sync()
    ed.on('contentChange', sync)
    return () => { ed.off('contentChange', sync) }
  }, [ready, editorRef])

  // 几何跟随: 读 getTableClientRect (滚动/缩放/回流同源)。
  //
  // 可见时用 rAF 逐帧跟随; **后台标签页里浏览器会完全挂起 rAF**
  // (实测 requestAnimationFrame 不触发, setTimeout 仍触发), 若只用 rAF,
  // 在后台标签打开编辑器时按钮会永远不出现 —— 故隐藏时退回定时轮询。
  useEffect(() => {
    if (!visible || tableIds.length === 0) {
      setEntries((prev) => (prev.length === 0 ? prev : []))
      return
    }
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
      if (ed) {
        const next: GrowEntry[] = []
        for (const id of tableIds) {
          const rect = ed.getTableClientRect(id)
          if (rect) next.push({ tableId: id, ...rect })
        }
        setEntries((prev) => (sameEntries(prev, next) ? prev : next))
      }
      schedule()
    }

    schedule()
    return () => { cancelled = true; cancelScheduled?.() }
  }, [visible, tableIds, editorRef])

  if (!visible || entries.length === 0) return null

  return (
    <>
      {entries.map((e) => (
        editable ? (
          <button
            key={e.tableId}
            type="button"
            title={t('tableGrow.addRowTitle')}
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={(ev) => {
              ev.preventDefault()
              ev.stopPropagation()
              editorRef.current?.appendTableRow(e.tableId)
            }}
            style={{ position: 'fixed', left: e.left + e.width - 88, top: e.top + e.height + 4 }}
            className="z-40 flex items-center gap-1 rounded border border-blue-200 bg-blue-50
                       px-2 py-0.5 text-xs text-blue-600 shadow-sm hover:bg-blue-100"
          >
            <Plus size={12} />
            {t('tableGrow.addRow')}
          </button>
        ) : (
          // 设计态只读标记: 明确不是入口 —— 虚线框 + pointer-events:none,
          // 与实心可点的「添加行」按钮在视觉上区分开。
          <div
            key={e.tableId}
            data-table-growable-marker={e.tableId}
            title={t('tableGrow.growableMarkerTitle')}
            style={{
              position: 'fixed', left: e.left + e.width - 88, top: e.top + e.height + 4,
              pointerEvents: 'none',
            }}
            className="z-40 flex items-center gap-1 rounded border border-dashed border-purple-300
                       bg-purple-50/80 px-2 py-0.5 text-xs text-purple-600"
          >
            <Rows3 size={12} />
            {t('tableGrow.growable')}
          </div>
        )
      ))}
    </>
  )
}
