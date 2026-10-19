// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// 侧边栏
// ============================================================

import {
  FileText,
  Puzzle,
  Search,
  FolderOpen,
  FilePlus,
  ChevronRight,
  Folder,
  Table,
  Image,
  ListTree,
  MessageSquare,
  ShieldCheck,
  History,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store'
import { OutlineNav, type OutlineItem, type SectionOutlineAction } from '@/components/sidebar/OutlineNav'
import { CommentPanel } from '@/components/panels/CommentPanel'
import { QCResultPanel } from '@/components/panels/QCResultPanel'
import { RevisionsPanel } from '@/components/panels/RevisionsPanel'
import type { CommentThread, RevisionListEntry } from '@emrde/document-engine'
import type { QCIssue, QCResult } from '@emrde/document-engine'
import { useTranslation } from '@/i18n/useTranslation'

interface SidebarProps {
  templates?: TemplateCategory[]
  onTemplateSelect?: (templateId: string) => void
  onNewTemplate?: () => void
  onElementClick?: (type: string) => void
  /** 大纲条目 (TASK-456) */
  outlineItems?: OutlineItem[]
  /** 当前激活的标题 ID */
  activeOutlineId?: string | null
  /** 点击大纲条目 */
  onOutlineClick?: (item: OutlineItem) => void
  /** 大纲节行操作 (契约 §31.14) */
  onSectionAction?: (action: SectionOutlineAction, item: OutlineItem) => void
  /** 批注线程 (R32) */
  commentThreads?: CommentThread[]
  /** 批注回调 */
  onSelectCommentThread?: (threadId: string) => void
  onResolveCommentThread?: (threadId: string) => void
  onAddCommentReply?: (threadId: string, content: string) => void
  /** 新建批注 (返回 false = 锚定失败, 面板据此提示) */
  onNewComment?: (content: string) => boolean
  /** 读取批注锚定的文字摘录 */
  getCommentExcerpt?: (threadId: string) => string
  /** 质控结果 (契约 §12.2；null = 尚未检查) */
  qcResult?: QCResult | null
  /** 点击质控问题 → 跳转到所在位置 */
  onQcIssueClick?: (issue: QCIssue) => void
  /** 重新运行质控 */
  onQcRecheck?: () => void
  /** 文档中的修订 (契约 §12.13; 来自 Editor.listRevisions) */
  revisions?: RevisionListEntry[]
  /** 点击修订条目 → 定位 */
  onSelectRevision?: (entry: RevisionListEntry) => void
  onAcceptRevision?: (entry: RevisionListEntry) => void
  onRejectRevision?: (entry: RevisionListEntry) => void
}

interface TemplateCategory {
  name: string
  items: { id: string; name: string; description?: string }[]
}

export function Sidebar({
  templates = [], onTemplateSelect, onNewTemplate, onElementClick,
  outlineItems = [], activeOutlineId, onOutlineClick, onSectionAction,
  commentThreads = [], onSelectCommentThread, onResolveCommentThread, onAddCommentReply,
  onNewComment, getCommentExcerpt,
  qcResult = null, onQcIssueClick, onQcRecheck,
  revisions = [], onSelectRevision, onAcceptRevision, onRejectRevision,
}: SidebarProps) {
  const { t } = useTranslation()
  const sidebarTab = useUIStore((s) => s.sidebarTab)
  const setSidebarTab = useUIStore((s) => s.setSidebarTab)

  return (
    <aside className="w-sidebar bg-chrome border-r border-line flex flex-col flex-shrink-0 select-none">
      {/* Tab 切换 */}
      <div className="flex border-b border-line">
        <SidebarTab
          active={sidebarTab === 'templates'}
          onClick={() => setSidebarTab('templates')}
          icon={<FileText size={14} />}
          label={t('sidebar.tab.templates')}
        />
        <SidebarTab
          active={sidebarTab === 'elements'}
          onClick={() => setSidebarTab('elements')}
          icon={<Puzzle size={14} />}
          label={t('sidebar.tab.elements')}
        />
        <SidebarTab
          active={sidebarTab === 'pages'}
          onClick={() => setSidebarTab('pages')}
          icon={<ListTree size={14} />}
          label={t('sidebar.tab.pages')}
        />
        <SidebarTab
          active={sidebarTab === 'comments'}
          onClick={() => setSidebarTab('comments')}
          icon={<MessageSquare size={14} />}
          label={t('sidebar.tab.comments')}
        />
        <SidebarTab
          active={sidebarTab === 'qc'}
          onClick={() => setSidebarTab('qc')}
          icon={<ShieldCheck size={14} />}
          label={t('sidebar.tab.qc')}
        />
        <SidebarTab
          active={sidebarTab === 'revisions'}
          onClick={() => setSidebarTab('revisions')}
          icon={<History size={14} />}
          label={t('sidebar.tab.revisions')}
        />
      </div>

      {/* 搜索 — 仅模板/元素两个列表页需要 (质控/大纲/批注无"搜索"语义) */}
      {(sidebarTab === 'templates' || sidebarTab === 'elements') && (
      <div className="p-3">
        <div className="flex items-center gap-2 px-2 py-1.5 bg-chrome-subtle rounded-md border border-line">
          <Search size={14} className="text-chrome-ink-muted flex-shrink-0" />
          <input
            className="bg-transparent border-none outline-none text-sm text-chrome-ink-body w-full
                       placeholder:text-chrome-ink-muted"
            placeholder={t('sidebar.searchPlaceholder')}
          />
        </div>
      </div>
      )}

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin px-2 pb-4">
        {sidebarTab === 'templates' && (
          <TemplateList
            templates={templates}
            onTemplateSelect={onTemplateSelect}
            onNewTemplate={onNewTemplate}
          />
        )}
        {sidebarTab === 'elements' && <ElementPalette onClick={onElementClick} />}
        {sidebarTab === 'pages' && (
          <OutlineNav
            items={outlineItems}
            activeId={activeOutlineId}
            onItemClick={onOutlineClick}
            onSectionAction={onSectionAction}
          />
        )}
        {sidebarTab === 'comments' && (
          <CommentPanel
            threads={commentThreads}
            onSelectThread={onSelectCommentThread}
            onResolveThread={onResolveCommentThread}
            onAddReply={onAddCommentReply}
            onNewComment={onNewComment}
            getThreadExcerpt={getCommentExcerpt}
          />
        )}
        {sidebarTab === 'qc' && (
          <QCResultPanel
            result={qcResult}
            onIssueClick={onQcIssueClick}
            onRecheck={onQcRecheck}
          />
        )}
        {sidebarTab === 'revisions' && (
          <RevisionsPanel
            revisions={revisions}
            onSelect={onSelectRevision}
            onAccept={onAcceptRevision}
            onReject={onRejectRevision}
          />
        )}
      </div>
    </aside>
  )
}

// ---- Tab 按钮 ----

function SidebarTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      className={cn(
        'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors',
        active
          ? 'text-chrome-accent-ink border-b-2 border-primary-500 bg-chrome-accent/50'
          : 'text-chrome-ink-tertiary hover:text-chrome-ink-body hover:bg-chrome-subtle'
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
}

// ---- 模板列表 ----

function TemplateList({
  templates,
  onTemplateSelect,
  onNewTemplate,
}: {
  templates: TemplateCategory[]
  onTemplateSelect?: (id: string) => void
  onNewTemplate?: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      {/* 新建模板按钮 */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-chrome-accent-ink
                   bg-chrome-accent hover:bg-chrome-accent-strong rounded-md transition-colors"
        onClick={onNewTemplate}
      >
        <FilePlus size={14} />
        {t('file.new')}
      </button>

      {/* 模板分类 */}
      {templates.length > 0 ? (
        templates.map((category) => (
          <div key={category.name}>
            <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-chrome-ink-tertiary uppercase tracking-wider">
              <Folder size={12} />
              {category.name}
            </div>
            <div className="mt-1 space-y-0.5">
              {category.items.map((item) => (
                <button
                  key={item.id}
                  className="sidebar-item w-full text-left"
                  onClick={() => onTemplateSelect?.(item.id)}
                >
                  <FileText size={14} className="text-chrome-ink-muted flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{item.name}</div>
                    {item.description && (
                      <div className="text-xs text-chrome-ink-muted truncate">{item.description}</div>
                    )}
                  </div>
                  <ChevronRight size={14} className="text-chrome-ink-disabled flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="text-center py-8 text-sm text-chrome-ink-muted">
          <FolderOpen size={32} className="mx-auto mb-2 text-chrome-ink-disabled" />
          {t('sidebar.templatesEmpty')}
        </div>
      )}
    </div>
  )
}

// ---- 元素面板 ----

function ElementPalette({ onClick }: { onClick?: (type: string) => void }) {
  const { t } = useTranslation()
  const elements: { key: 'type-table' | 'type-image'; type: string; labelKey: 'editor.insert.table' | 'editor.insert.image'; icon: React.ReactNode }[] = [
    { key: 'type-table', type: 'table', labelKey: 'editor.insert.table', icon: <Table size={16} /> },
    { key: 'type-image', type: 'image', labelKey: 'editor.insert.image', icon: <Image size={16} /> },
  ]

  return (
    <div className="space-y-0.5">
      {elements.map((el) => (
        <div
          key={el.key}
          className="sidebar-item cursor-grab active:cursor-grabbing"
          draggable
          onClick={() => onClick?.(el.type)}
        >
          <span className="text-chrome-ink-muted">{el.icon}</span>
          <span className="text-sm">{t(el.labelKey)}</span>
        </div>
      ))}
    </div>
  )
}