// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// 编辑器整体布局
// ============================================================

import type { ReactNode } from 'react'
import { HeaderBar } from './HeaderBar'
import { Toolbar } from './Toolbar'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'

import { useEditorStore, useUIStore } from '@/store'
import type { OutlineItem } from '@/components/sidebar/OutlineNav'
import type { CommentThread } from '@/engine/document/core/DocumentModel'
import type { EditorMode } from '@/engine'

interface EditorLayoutProps {
  children: ReactNode
  onSave?: () => void
  onImportDocument?: () => void
  onDocumentProperties?: () => void
  onFormat?: (action: string, value?: unknown) => void
  onInsert?: (elementType: string) => void
  onExportClick?: () => void
  onPrint?: () => void
  onPageSetup?: () => void
  wordCount?: number
  pageIndex?: number
  pageCount?: number
  scale?: number
  onScaleChange?: (scale: number) => void
  showInvisible?: boolean
  onToggleInvisible?: () => void
  /** 大纲条目 (TASK-456) */
  outlineItems?: OutlineItem[]
  /** 当前激活的标题 ID */
  activeOutlineId?: string | null
  /** 点击大纲条目 */
  onOutlineClick?: (item: OutlineItem) => void
  onTemplateSelect?: (id: string) => void
  templates?: { name: string; items: { id: string; name: string; description?: string }[] }[]
  /** 批注 (R32) */
  commentThreads?: CommentThread[]
  onSelectCommentThread?: (threadId: string) => void
  onResolveCommentThread?: (threadId: string) => void
  onAddCommentReply?: (threadId: string, content: string) => void
  /** 阅读模式 (R40) */
  readingMode?: boolean
  /** 当前编辑模式 */
  mode?: EditorMode
  /** 模式切换回调 */
  onModeChange?: (mode: EditorMode) => void
}

export function EditorLayout({
  children,
  onSave,
  onImportDocument,
  onDocumentProperties,
  onFormat,
  onInsert,
  onExportClick,
  onPrint,
  onPageSetup,
  wordCount = 0,
  pageIndex = 1,
  pageCount = 1,
  scale = 1,
  onScaleChange,
  showInvisible = false,
  onToggleInvisible,
  outlineItems = [],
  activeOutlineId,
  onOutlineClick,
  onTemplateSelect,
  templates,
  commentThreads = [],
  onSelectCommentThread,
  onResolveCommentThread,
  onAddCommentReply,
  readingMode = false,
  mode,
  onModeChange,
}: EditorLayoutProps) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen) && !readingMode
  const onlineUsers = useEditorStore((s) => s.onlineUsers)

  return (
    <div className="h-full flex flex-col">
      {/* 顶部导航栏 — 阅读模式下隐藏 */}
      {!readingMode && (
      <HeaderBar
        onSave={onSave}
        onImportDocument={onImportDocument}
        onDocumentProperties={onDocumentProperties}
        onFormat={onFormat}
      />
      )}

      {/* 工具栏 — 阅读模式下隐藏 */}
      {!readingMode && (
      <Toolbar
        onFormat={onFormat}
        onInsert={onInsert}
        onExportClick={onExportClick}
        onPrint={onPrint}
        onPageSetup={onPageSetup}
      />
      )}

      {/* 主体区域 */}
      <div className="flex flex-1 min-h-0">
        {/* 侧边栏 */}
        {sidebarOpen && (
          <Sidebar
            templates={templates || DEFAULT_TEMPLATES}
            onTemplateSelect={onTemplateSelect}
            outlineItems={outlineItems}
            activeOutlineId={activeOutlineId}
            onOutlineClick={onOutlineClick}
            commentThreads={commentThreads}
            onSelectCommentThread={onSelectCommentThread}
            onResolveCommentThread={onResolveCommentThread}
            onAddCommentReply={onAddCommentReply}
          />
        )}

        {/* 编辑器画布 */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {children}
          {!readingMode && (
          <StatusBar
            pageIndex={pageIndex}
            pageCount={pageCount}
            wordCount={wordCount}
            onlineCount={onlineUsers}
            scale={scale}
            onScaleChange={onScaleChange}
            showInvisible={showInvisible}
            onToggleInvisible={onToggleInvisible}
            mode={mode}
            onModeChange={onModeChange}
          />
          )}
        </div>

        {/* 属性面板 (契约 §7.7/§7.8): 文档属性走 DocumentPropertiesDialog;
            控件属性走 DesignControlProperties (轻量就地) 与右键「属性」→
            Control Config Dialog (完整语义层, 契约 §12.7, Editor.applyControlConfig) */}
      </div>
    </div>
  )
}

// 默认模板数据（Mock）
const DEFAULT_TEMPLATES = [
  {
    name: '基本信息',
    items: [
      { id: 'tpl_blank', name: '空白文档', description: '从头开始创建文档' },
    ],
  },
  {
    name: '医疗文书',
    items: [
      { id: 'tpl_admission', name: '入院记录', description: '标准入院记录模板' },
      { id: 'tpl_progress', name: '病程记录', description: '日常病程记录模板' },
      { id: 'tpl_discharge', name: '出院小结', description: '出院小结模板' },
      { id: 'tpl_consultation', name: '会诊记录', description: '会诊记录模板' },
    ],
  },
  {
    name: '检查报告',
    items: [
      { id: 'tpl_lab', name: '检验报告', description: '实验室检验报告模板' },
      { id: 'tpl_imaging', name: '影像报告', description: '影像学检查报告模板' },
    ],
  },
]
