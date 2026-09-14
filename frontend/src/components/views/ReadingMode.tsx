// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ReadingMode — 全屏阅读模式 (R40, v6.0)
//
// 隐藏工具栏/侧边栏/属性面板/状态栏, 仅显示文档内容
// 按 ESC 或点击"退出阅读"按钮退出
// ============================================================

import { useEffect, type ReactNode } from 'react'
import { Eye, EyeOff } from 'lucide-react'

interface ReadingModeProps {
  children: ReactNode
  /** 是否处于阅读模式 */
  active: boolean
  /** 切换阅读模式 */
  onToggle: () => void
}

export function ReadingModeOverlay({ children, active, onToggle }: ReadingModeProps) {
  useEffect(() => {
    if (!active) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onToggle()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, onToggle])

  return (
    <>
      {active && (
        <div className="fixed top-3 right-4 z-50 flex items-center gap-2">
          <span className="text-xs text-gray-400 bg-white/80 px-2 py-1 rounded shadow-sm">
            阅读模式 · 按 ESC 退出
          </span>
          <button
            onClick={onToggle}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-white
                       border border-gray-200 rounded-md shadow-sm
                       text-gray-600 hover:text-gray-800 hover:bg-gray-50"
          >
            <EyeOff size={14} />
            退出阅读
          </button>
        </div>
      )}
      {children}
    </>
  )
}

/** 阅读模式切换按钮 (用于 HeaderBar/Toolbar) */
export function ReadingModeToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={active ? '退出阅读模式' : '阅读模式'}
      className="flex items-center gap-1 px-2 py-1 text-xs rounded
                 text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
    >
      {active ? <EyeOff size={14} /> : <Eye size={14} />}
      <span>{active ? '退出' : '阅读'}</span>
    </button>
  )
}
