// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// BookmarkDialog — 书签与交叉引用对话框 (R38, v6.0)
//
// 功能: 插入书签 (命名+位置) / 插入交叉引用 (选择类型+目标)
// ============================================================

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Bookmark, Link, Hash } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/useTranslation'

// ---- 类型 ----

export interface BookmarkTarget {
  id: string
  label: string
  type: 'heading' | 'bookmark' | 'footnote'
  pageHint?: number
}

interface BookmarkDialogProps {
  open: boolean
  onClose: () => void
  /** 可用书签/标题/脚注列表 */
  targets?: BookmarkTarget[]
  onInsertBookmark?: (name: string) => void
  onInsertCrossReference?: (targetId: string, refType: string, displayText: string) => void
}

type TabId = 'bookmark' | 'crossref'

/**
 * 交叉引用格式。`label` 是历史唯一形态 (纯书签名, 不含页码);
 * 另两种携带占位符, 由 LayoutEngine 在排版期展开为真实页码/编号 (契约 §12.2)。
 */
type RefFormat = 'label' | 'page' | 'labelPage'

// ---- 组件 ----

export function BookmarkDialog({
  open, onClose, targets = [],
  onInsertBookmark, onInsertCrossReference,
}: BookmarkDialogProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<TabId>('bookmark')
  const [name, setName] = useState('')
  const [filter, setFilter] = useState('')
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null)
  /** 交叉引用格式 —— 决定 displayText 是否携带 {page}/{number} 占位符 */
  const [refFormat, setRefFormat] = useState<RefFormat>('label')

  const filtered = filter
    ? targets.filter(tg => tg.label.includes(filter) || tg.id.includes(filter))
    : targets

  const handleInsertBookmark = () => {
    if (!name.trim()) return
    onInsertBookmark?.(name.trim())
    setName('')
    onClose()
  }

  const handleInsertCrossRef = () => {
    if (!selectedTarget) return
    const target = targets.find(tg => tg.id === selectedTarget)
    if (!target) return
    // 脚注解析的是 {number} (编号), 其余是 {page} (页码)
    const ph = target.type === 'footnote' ? '{number}' : '{page}'
    const pageText = target.type === 'footnote'
      ? t('bookmark.footnotePrefix', { n: ph })
      : t('bookmark.pagePrefix', { n: ph })
    const displayText =
      refFormat === 'page' ? pageText
        : refFormat === 'labelPage' ? `${target.label}（${pageText}）`
          : target.label
    onInsertCrossReference?.(target.id, target.type, displayText)
    setSelectedTarget(null)
    onClose()
  }

  const tabs: { id: TabId; labelKey: 'bookmark.insertBookmark' | 'bookmark.insertCrossRef'; icon: React.ReactNode }[] = [
    { id: 'bookmark', labelKey: 'bookmark.insertBookmark', icon: <Bookmark size={14} /> },
    { id: 'crossref',  labelKey: 'bookmark.insertCrossRef',  icon: <Link size={14} /> },
  ]

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content
          className="fixed top-1/4 left-1/2 -translate-x-1/2 z-50
                     w-[420px] bg-chrome rounded-lg shadow-xl border border-line"
        >
          {/* 头部 */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-line-subtle">
            <div className="flex items-center gap-2">
              <Bookmark size={16} className="text-chrome-ink-tertiary" />
              <Dialog.Title className="text-sm font-medium text-chrome-ink-strong">{t('dialog.title.bookmark')}</Dialog.Title>
            </div>
            <button onClick={onClose} aria-label={t('common.close')}
                    className="p-1 rounded hover:bg-chrome-muted text-chrome-ink-muted hover:text-chrome-ink-secondary">
              <X size={14} />
            </button>
          </div>

          {/* Tab */}
          <div className="flex border-b border-line-subtle px-5">
            {tabs.map(tabItem => (
              <button
                key={tabItem.id}
                onClick={() => setTab(tabItem.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px',
                  tab === tabItem.id
                    ? 'border-blue-500 text-blue-700'
                    : 'border-transparent text-chrome-ink-tertiary hover:text-chrome-ink-body',
                )}
              >
                {tabItem.icon}
                {t(tabItem.labelKey)}
              </button>
            ))}
          </div>

          {/* 内容 */}
          <div className="px-5 py-4">
            {tab === 'bookmark' ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-chrome-ink-secondary block mb-1">{t('bookmark.nameLabel')}</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleInsertBookmark() }}
                    placeholder={t('bookmark.namePlaceholder')}
                    className="w-full text-sm px-3 py-2 border border-line rounded-md
                               focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                    autoFocus
                  />
                </div>
                <p className="text-xs text-chrome-ink-muted">
                  {t('bookmark.description')}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* 引用格式: 决定 displayText 里是否带 {page} 占位符 —— 带占位符时
                    由 LayoutEngine 在排版期展开为真实页码 (契约 §12.2) */}
                <div>
                  <label className="text-xs font-medium text-chrome-ink-secondary block mb-1">{t('bookmark.refFormatLabel')}</label>
                  <select
                    value={refFormat}
                    onChange={(e) => setRefFormat(e.target.value as RefFormat)}
                    className="w-full text-sm px-3 py-2 border border-line rounded-md bg-chrome
                               focus:outline-none focus:border-blue-400"
                  >
                    <option value="label">{t('bookmark.refFormatLabelOnly')}</option>
                    <option value="page">{t('bookmark.refFormatPageOnly', { n: '{page}' })}</option>
                    <option value="labelPage">{t('bookmark.refFormatLabelPage', { n: '{page}' })}</option>
                  </select>
                </div>

                {/* 搜索过滤 */}
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t('bookmark.filterPlaceholder')}
                  className="w-full text-sm px-3 py-2 border border-line rounded-md
                             focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                />

                {/* 目标列表 */}
                <div className="max-h-48 overflow-y-auto border border-line-subtle rounded-md divide-y divide-line-subtle">
                  {filtered.length === 0 ? (
                    <div className="px-3 py-6 text-center text-xs text-chrome-ink-muted">
                      {t('bookmark.noTargets')}
                    </div>
                  ) : (
                    filtered.map(target => (
                      <button
                        key={target.id}
                        onClick={() => setSelectedTarget(target.id)}
                        className={cn(
                          'w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors',
                          selectedTarget === target.id
                            ? 'bg-blue-50 text-blue-700'
                            : 'hover:bg-chrome-subtle text-chrome-ink-body',
                        )}
                      >
                        {target.type === 'heading' && <Hash size={14} className="text-chrome-ink-muted flex-shrink-0" />}
                        {target.type === 'bookmark' && <Bookmark size={14} className="text-chrome-ink-muted flex-shrink-0" />}
                        {target.type === 'footnote' && <Link size={14} className="text-chrome-ink-muted flex-shrink-0" />}
                        <span className="truncate flex-1">{target.label}</span>
                        {target.pageHint && (
                          <span className="text-xs text-chrome-ink-muted flex-shrink-0">{t('bookmark.pageNumber', { n: target.pageHint })}</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 底部 */}
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-line-subtle bg-chrome-subtle rounded-b-lg">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-chrome-ink-secondary hover:text-chrome-ink-strong"
            >
              {t('common.cancel')}
            </button>
            {tab === 'bookmark' ? (
              <button
                onClick={handleInsertBookmark}
                disabled={!name.trim()}
                className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded-md
                           hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('bookmark.insertBookmark')}
              </button>
            ) : (
              <button
                onClick={handleInsertCrossRef}
                disabled={!selectedTarget}
                className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded-md
                           hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('bookmark.insertCrossRef')}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}