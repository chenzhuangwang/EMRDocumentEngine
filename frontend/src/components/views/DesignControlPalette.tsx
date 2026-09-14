// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// DesignControlPalette — 设计态控件库面板 (契约 §12.4)
//
// 仅在设计模式渲染的浮动面板: 读取控件库目录 (CONTROL_LIBRARY),
// 点击条目调用 Editor.insertControl(element, definition) 将控件插入
// 光标处。面板只消费引擎公共 API, 不直接改 pool / store (§12.4)。
//
// 目录数据归属 platform/data (前端), 引擎不硬编码医疗字典。
// ============================================================

import { useState } from 'react'
import { PanelRightClose, PanelRightOpen, Puzzle } from 'lucide-react'
import { useEditorRef, useEditorStoreSnapshot } from '@/components/editor/EditorProvider'
import { CONTROL_LIBRARY, type ControlLibraryEntry } from '@/platform/data/controlLibrary'

export function DesignControlPalette() {
  const editorRef = useEditorRef()
  const mode = useEditorStoreSnapshot((s) => s.runtime.view.mode)
  const [collapsed, setCollapsed] = useState(false)

  if (mode !== 'design') return null

  const insert = (entry: ControlLibraryEntry) => {
    editorRef.current?.insertControl(entry.element, entry.definition)
  }

  const groups = new Map<string, ControlLibraryEntry[]>()
  for (const entry of CONTROL_LIBRARY) {
    const list = groups.get(entry.category) ?? []
    list.push(entry)
    groups.set(entry.category, list)
  }

  return (
    <div className="fixed right-4 top-16 z-40 w-60 flex flex-col rounded-lg border border-gray-200 bg-white shadow-lg">
      {/* 面板头 */}
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
          <Puzzle size={13} className="text-blue-500" />
          控件库
        </span>
        <button
          className="p-0.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? '展开' : '折叠'}
        >
          {collapsed ? <PanelRightOpen size={13} /> : <PanelRightClose size={13} />}
        </button>
      </div>

      {/* 条目列表 */}
      {!collapsed && (
        <div className="max-h-[70vh] overflow-y-auto p-1.5">
          {[...groups.entries()].map(([category, entries]) => (
            <div key={category} className="mb-1">
              <div className="px-1.5 py-1 text-[11px] font-medium text-gray-400">{category}</div>
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => insert(entry)}
                  className="w-full flex items-center justify-between rounded px-2 py-1.5 text-left text-xs
                             text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                  title={entry.definition?.tips || entry.name}
                >
                  <span>{entry.name}</span>
                  {entry.definition?.single && (
                    <span className="text-[10px] text-amber-500" title="单值字段 (文档中仅可插入一次)">单值</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
