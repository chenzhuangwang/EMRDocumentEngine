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
import type { OutlineItem, SectionOutlineAction } from '@/components/sidebar/OutlineNav'
import type { CommentThread } from '@emrde/document-engine'
import type { EditorMode, ScoreResult, LocaleMessages } from '@emrde/document-engine'
import type { ToolbarAction } from '@emrde/document-engine'
import type { QCIssue, QCResult, RevisionListEntry } from '@emrde/document-engine'
import { useTranslation } from '@/i18n/useTranslation'

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
  /** 水印设置 (契约 §12.4) */
  onWatermark?: () => void
  /** 插件注册的工具栏动作 (契约 §12) */
  pluginActions?: ToolbarAction[]
  wordCount?: number
  pageIndex?: number
  pageCount?: number
  scale?: number
  onScaleChange?: (scale: number) => void
  showInvisible?: boolean
  /** 节结构显示开关 (契约 §31.14) */
  showSectionStructure?: boolean
  /** 节结构显示切换回调 */
  onToggleSectionStructure?: () => void
  onToggleInvisible?: () => void
  /** 修订留痕显示 (契约 §12.13) */
  showRevisionMarks?: boolean
  onToggleRevisionMarks?: () => void
  /** 修订追踪开关 (契约 §12.13) */
  trackChanges?: boolean
  onToggleTrackChanges?: () => void
  /** 接受 / 拒绝全部修订 (契约 §12.13) */
  onAcceptAllRevisions?: () => void
  onRejectAllRevisions?: () => void
  /** 大纲条目 (TASK-456) */
  outlineItems?: OutlineItem[]
  /** 当前激活的标题 ID */
  activeOutlineId?: string | null
  /** 点击大纲条目 */
  onOutlineClick?: (item: OutlineItem) => void
  /** 大纲节行操作 (契约 §31.14) */
  onSectionAction?: (action: SectionOutlineAction, item: OutlineItem) => void
  onTemplateSelect?: (id: string) => void
  templates?: { name: string; items: { id: string; name: string; description?: string }[] }[]
  /** 批注 (R32) */
  commentThreads?: CommentThread[]
  onSelectCommentThread?: (threadId: string) => void
  onResolveCommentThread?: (threadId: string) => void
  onAddCommentReply?: (threadId: string, content: string) => void
  /** 新建批注 (返回 false = 锚定失败) */
  onNewComment?: (content: string) => boolean
  /** 读取批注锚定的文字摘录 */
  getCommentExcerpt?: (threadId: string) => string
  /** 质控结果 (契约 §12.2) */
  qcResult?: QCResult | null
  onQcIssueClick?: (issue: QCIssue) => void
  onQcRecheck?: () => void
  /** 修订列表 (契约 §12.13) */
  revisions?: RevisionListEntry[]
  onSelectRevision?: (entry: RevisionListEntry) => void
  onAcceptRevision?: (entry: RevisionListEntry) => void
  onRejectRevision?: (entry: RevisionListEntry) => void
  /** 阅读模式 (R40) */
  readingMode?: boolean
  /** 当前编辑模式 */
  mode?: EditorMode
  /** 模式切换回调 */
  onModeChange?: (mode: EditorMode) => void
  /** 控件量表评分 (契约 §12.6.2 layer E, 只读派生) */
  scaleScore?: ScoreResult | null
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
  onWatermark,
  pluginActions,
  wordCount = 0,
  pageIndex = 1,
  pageCount = 1,
  scale = 1,
  onScaleChange,
  showInvisible = false,
  showSectionStructure = true,
  onToggleInvisible,
  onToggleSectionStructure,
  showRevisionMarks = true,
  onToggleRevisionMarks,
  trackChanges = false,
  onToggleTrackChanges,
  onAcceptAllRevisions,
  onRejectAllRevisions,
  outlineItems = [],
  activeOutlineId,
  onOutlineClick,
  onSectionAction,
  onTemplateSelect,
  templates,
  commentThreads = [],
  onSelectCommentThread,
  onResolveCommentThread,
  onAddCommentReply,
  onNewComment,
  getCommentExcerpt,
  qcResult,
  onQcIssueClick,
  onQcRecheck,
  revisions = [],
  onSelectRevision,
  onAcceptRevision,
  onRejectRevision,
  readingMode = false,
  mode,
  onModeChange,
  scaleScore,
}: EditorLayoutProps) {
  const { t } = useTranslation()
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
        onWatermark={onWatermark}
        pluginActions={pluginActions}
      />
      )}

      {/* 主体区域 */}
      <div className="flex flex-1 min-h-0">
        {/* 侧边栏 */}
        {sidebarOpen && (
          <Sidebar
            templates={templates || defaultTemplates(t)}
            onTemplateSelect={onTemplateSelect}
            outlineItems={outlineItems}
            activeOutlineId={activeOutlineId}
            onOutlineClick={onOutlineClick}
            onSectionAction={onSectionAction}
            commentThreads={commentThreads}
            onSelectCommentThread={onSelectCommentThread}
            onResolveCommentThread={onResolveCommentThread}
            onAddCommentReply={onAddCommentReply}
            onNewComment={onNewComment}
            getCommentExcerpt={getCommentExcerpt}
            qcResult={qcResult}
            onQcIssueClick={onQcIssueClick}
            onQcRecheck={onQcRecheck}
            revisions={revisions}
            onSelectRevision={onSelectRevision}
            onAcceptRevision={onAcceptRevision}
            onRejectRevision={onRejectRevision}
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
            showSectionStructure={showSectionStructure}
            onToggleInvisible={onToggleInvisible}
            onToggleSectionStructure={onToggleSectionStructure}
            showRevisionMarks={showRevisionMarks}
            onToggleRevisionMarks={onToggleRevisionMarks}
            trackChanges={trackChanges}
            onToggleTrackChanges={onToggleTrackChanges}
            onAcceptAllRevisions={onAcceptAllRevisions}
            onRejectAllRevisions={onRejectAllRevisions}
            mode={mode}
            onModeChange={onModeChange}
            scaleScore={scaleScore}
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

// 默认模板数据（Mock）— 文案存 i18n 键, 渲染时按当前语言展开
const DEFAULT_TEMPLATE_KEYS: {
  nameKey: keyof LocaleMessages
  items: { id: string; nameKey: keyof LocaleMessages; descKey: keyof LocaleMessages }[]
}[] = [
  {
    nameKey: 'mock.template.basic',
    items: [
      { id: 'tpl_blank', nameKey: 'mock.template.blank', descKey: 'mock.template.blankDesc' },
    ],
  },
  {
    nameKey: 'mock.template.medical',
    items: [
      { id: 'tpl_admission', nameKey: 'mock.template.admission', descKey: 'mock.template.admissionDesc' },
      { id: 'tpl_progress', nameKey: 'mock.template.progress', descKey: 'mock.template.progressDesc' },
      { id: 'tpl_discharge', nameKey: 'mock.template.discharge', descKey: 'mock.template.dischargeDesc' },
      { id: 'tpl_consultation', nameKey: 'mock.template.consultation', descKey: 'mock.template.consultationDesc' },
    ],
  },
  {
    nameKey: 'mock.template.report',
    items: [
      { id: 'tpl_lab', nameKey: 'mock.template.lab', descKey: 'mock.template.labDesc' },
      { id: 'tpl_imaging', nameKey: 'mock.template.imaging', descKey: 'mock.template.imagingDesc' },
    ],
  },
]

/** 按当前语言展开默认模板 (与 Sidebar 的 TemplateCategory 结构一致) */
function defaultTemplates(t: (key: keyof LocaleMessages) => string) {
  return DEFAULT_TEMPLATE_KEYS.map((c) => ({
    name: t(c.nameKey),
    items: c.items.map((i) => ({ id: i.id, name: t(i.nameKey), description: t(i.descKey) })),
  }))
}
