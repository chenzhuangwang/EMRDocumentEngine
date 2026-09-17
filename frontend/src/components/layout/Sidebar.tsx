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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store'
import { OutlineNav, type OutlineItem } from '@/components/sidebar/OutlineNav'
import { CommentPanel } from '@/components/panels/CommentPanel'
import { QCResultPanel } from '@/components/panels/QCResultPanel'
import type { CommentThread } from '@/engine/document/core/DocumentModel'
import type { QCIssue, QCResult } from '@/engine/qc/QCEngine'

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
}

interface TemplateCategory {
  name: string
  items: { id: string; name: string; description?: string }[]
}

export function Sidebar({
  templates = [], onTemplateSelect, onNewTemplate, onElementClick,
  outlineItems = [], activeOutlineId, onOutlineClick,
  commentThreads = [], onSelectCommentThread, onResolveCommentThread, onAddCommentReply,
  onNewComment, getCommentExcerpt,
  qcResult = null, onQcIssueClick, onQcRecheck,
}: SidebarProps) {
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
          label="模板"
        />
        <SidebarTab
          active={sidebarTab === 'elements'}
          onClick={() => setSidebarTab('elements')}
          icon={<Puzzle size={14} />}
          label="元素"
        />
        <SidebarTab
          active={sidebarTab === 'pages'}
          onClick={() => setSidebarTab('pages')}
          icon={<ListTree size={14} />}
          label="大纲"
        />
        <SidebarTab
          active={sidebarTab === 'comments'}
          onClick={() => setSidebarTab('comments')}
          icon={<MessageSquare size={14} />}
          label="批注"
        />
        <SidebarTab
          active={sidebarTab === 'qc'}
          onClick={() => setSidebarTab('qc')}
          icon={<ShieldCheck size={14} />}
          label="质控"
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
            placeholder={sidebarTab === 'templates' ? '搜索模板...' : '搜索元素...'}
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
  return (
    <div className="space-y-3">
      {/* 新建模板按钮 */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-chrome-accent-ink
                   bg-chrome-accent hover:bg-chrome-accent-strong rounded-md transition-colors"
        onClick={onNewTemplate}
      >
        <FilePlus size={14} />
        新建模板
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
          暂无模板
        </div>
      )}
    </div>
  )
}

// ---- 元素面板 ----

function ElementPalette({ onClick }: { onClick?: (type: string) => void }) {
  const elements = [
    { type: 'table', label: '表格', icon: <Table size={16} /> },
    { type: 'image', label: '图片', icon: <Image size={16} /> },
  ]

  return (
    <div className="space-y-0.5">
      {elements.map((el) => (
        <div
          key={el.type}
          className="sidebar-item cursor-grab active:cursor-grabbing"
          draggable
          onClick={() => onClick?.(el.type)}
        >
          <span className="text-chrome-ink-muted">{el.icon}</span>
          <span className="text-sm">{el.label}</span>
        </div>
      ))}
    </div>
  )
}
