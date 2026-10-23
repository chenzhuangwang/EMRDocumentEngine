// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// CommentPanel — 批注面板 (R32, v6.0)
//
// 右侧浮层: 批注列表 + 筛选 + 回复线程 + resolve
// 对齐架构 TASK-513, UIUX §5.5
// ============================================================

import { useEffect, useState } from 'react'
import { MessageSquare, Check, Reply, ChevronDown, X, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CommentThread } from '@emrde/document-engine'
import { useTranslation } from '@/i18n/useTranslation'
import { locale as localeManager, type LocaleParams, type LocaleMessages } from '@emrde/document-engine'

// ---- 组件 Props ----

interface CommentPanelProps {
  threads: CommentThread[]
  activeThreadId?: string
  onSelectThread?: (threadId: string) => void
  onResolveThread?: (threadId: string) => void
  onAddReply?: (threadId: string, content: string) => void
  /** 删除整条批注线程 (确认后调用; 引擎侧可撤销) */
  onDeleteThread?: (threadId: string) => void
  /** 删除一条回复 (引擎侧可撤销) */
  onDeleteReply?: (threadId: string, replyId: string) => void
  onClose?: () => void
  /**
   * 新建批注。**返回 false 表示锚定失败** (无选区且无光标, 或选区跨段落) ——
   * 面板据此显示提示。做成返回值而不是 void, 是为了不出现"点了没反应"。
   */
  onNewComment?: (content: string) => boolean
  /** 读取某条批注锚定的文字摘录 (列表里显示"这条批注标的是哪段字") */
  getThreadExcerpt?: (threadId: string) => string
}

type FilterMode = 'all' | 'open' | 'resolved'

// ---- 组件 ----

export function CommentPanel({
  threads,
  activeThreadId,
  onSelectThread,
  onResolveThread,
  onAddReply,
  onDeleteThread,
  onDeleteReply,
  onClose,
  onNewComment,
  getThreadExcerpt,
}: CommentPanelProps) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<FilterMode>('open')
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set())
  const [replyText, setReplyText] = useState<Record<string, string>>({})
  /** 新建批注的内联输入 (R32 补: 此前面板只有列表, 无任何创建入口) */
  const [newOpen, setNewOpen] = useState(false)
  const [newText, setNewText] = useState('')
  const [newError, setNewError] = useState<string | null>(null)

  // 选中的线程必须可见: 自动展开; 若当前筛选把它隐藏了 (例如选中一条
  // 已解决批注而面板停在「未解决」), 自动切到「全部」。否则画布高亮了、
  // 列表里却找不到对应条目。
  useEffect(() => {
    if (!activeThreadId) return
    const thread = threads.find(item => item.id === activeThreadId)
    if (!thread) return
    setExpandedThreads(prev => {
      if (prev.has(activeThreadId)) return prev
      const next = new Set(prev)
      next.add(activeThreadId)
      return next
    })
    const hidden = (filter === 'open' && thread.status === 'resolved') ||
      (filter === 'resolved' && thread.status !== 'resolved')
    if (hidden) setFilter('all')
  }, [activeThreadId, threads, filter])

  const submitNew = () => {
    const content = newText.trim()
    if (content === '' || !onNewComment) return
    if (onNewComment(content)) {
      setNewText(''); setNewOpen(false); setNewError(null)
    } else {
      setNewError(t('comment.anchorFailed'))
    }
  }

  const toggleExpand = (threadId: string) => {
    setExpandedThreads(prev => {
      const next = new Set(prev)
      if (next.has(threadId)) next.delete(threadId); else next.add(threadId)
      return next
    })
  }

  const filtered = threads.filter(t => {
    if (filter === 'open') return t.status !== 'resolved'
    if (filter === 'resolved') return t.status === 'resolved'
    return true
  })

  const counts = {
    all: threads.length,
    open: threads.filter(t => t.status !== 'resolved').length,
    resolved: threads.filter(t => t.status === 'resolved').length,
  }

  const FILTERS: { key: FilterMode; labelKey: 'comment.filter.all' | 'comment.filter.unresolved' | 'comment.filter.resolved' }[] = [
    { key: 'all', labelKey: 'comment.filter.all' },
    { key: 'open', labelKey: 'comment.filter.unresolved' },
    { key: 'resolved', labelKey: 'comment.filter.resolved' },
  ]

  return (
    <div className="flex flex-col h-full bg-chrome border-l border-line">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-line-subtle">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-chrome-ink-tertiary" />
          <span className="text-sm font-medium text-chrome-ink-strong">{t('comment.title')}</span>
          <span className="text-xs text-chrome-ink-muted bg-chrome-muted px-1.5 py-0.5 rounded">
            {counts.open}
          </span>
          {onNewComment && (
            <button
              onClick={() => { setNewOpen(v => !v); setNewError(null) }}
              title={t('comment.newTitle')}
              className={cn(
                'ml-1 flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded transition-colors',
                newOpen ? 'bg-blue-50 text-blue-700' : 'text-blue-600 hover:bg-blue-50',
              )}
            >
              <Plus size={12} />
              {t('comment.newThread')}
            </button>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-1 rounded hover:bg-chrome-muted text-chrome-ink-muted hover:text-chrome-ink-secondary"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* 筛选 */}
      <div className="flex gap-1 px-4 py-2 border-b border-line-subtle">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'text-xs px-2 py-1 rounded transition-colors',
              filter === f.key
                ? 'bg-blue-50 text-blue-700 font-medium'
                : 'text-chrome-ink-tertiary hover:bg-chrome-subtle hover:text-chrome-ink-body',
            )}
          >
            {t(f.labelKey, { n: counts[f.key] })}
          </button>
        ))}
      </div>

      {/* 新建批注 (R32 补): 锚点取文档当前选区/光标, 故输入框只收内容 */}
      {newOpen && onNewComment && (
        <div className="px-4 py-2 border-b border-line-subtle bg-blue-50/40">
          <textarea
            autoFocus
            value={newText}
            onChange={(e) => { setNewText(e.target.value); setNewError(null) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitNew() }
              if (e.key === 'Escape') { setNewOpen(false); setNewText(''); setNewError(null) }
            }}
            rows={2}
            placeholder={t('comment.placeholder')}
            className="w-full text-xs px-2 py-1.5 border border-line rounded resize-none
                       focus:outline-none focus:border-blue-400 bg-chrome"
          />
          {newError && <p className="mt-1 text-[10px] text-amber-600">{newError}</p>}
          <div className="flex justify-end gap-1 mt-1">
            <button
              onClick={() => { setNewOpen(false); setNewText(''); setNewError(null) }}
              className="px-2 py-1 text-xs text-chrome-ink-secondary hover:bg-chrome-muted rounded"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={submitNew}
              disabled={newText.trim() === ''}
              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700
                         disabled:opacity-40 disabled:cursor-default"
            >
              {t('comment.addReply')}
            </button>
          </div>
        </div>
      )}

      {/* 批注列表 */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-chrome-ink-muted">
            <MessageSquare size={32} className="mb-2 opacity-40" />
            <span className="text-sm">{t('comment.empty')}</span>
          </div>
        ) : (
          <div className="divide-y divide-line-subtle">
            {filtered.map(thread => {
              const isExpanded = expandedThreads.has(thread.id)
              const isActive = thread.id === activeThreadId
              const lastEntry = thread.comments[thread.comments.length - 1]
              const excerpt = getThreadExcerpt?.(thread.id) ?? ''
              /** 零长度 = 光标处的点批注 (契约 §12.14), 没有文字可摘录 */
              const isPoint = thread.rangeStart.path.join('\u0000') === thread.rangeEnd.path.join('\u0000') &&
                thread.rangeStart.offset === thread.rangeEnd.offset

              return (
                <div
                  key={thread.id}
                  className={cn(
                    'px-4 py-3 cursor-pointer transition-colors',
                    isActive && 'bg-blue-50 border-l-2 border-blue-400',
                    !isActive && 'hover:bg-chrome-subtle',
                  )}
                  onClick={() => onSelectThread?.(thread.id)}
                >
                  {/* 线程头部 */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0" onClick={() => toggleExpand(thread.id)}>
                      <div className="flex items-center gap-1.5">
                        <ChevronDown
                          size={12}
                          className={cn(
                            'text-chrome-ink-muted transition-transform',
                            isExpanded && 'rotate-180',
                          )}
                        />
                        <span className="text-xs font-medium text-chrome-ink-strong truncate">
                          {thread.author}
                        </span>
                        <span className="text-[10px] text-chrome-ink-muted">
                          {formatTime(lastEntry?.createdAt, t)}
                        </span>
                      </div>
                      <p className="text-xs text-chrome-ink-secondary mt-1 line-clamp-2 ml-[18px]">
                        {lastEntry?.content || t('comment.noContent')}
                      </p>
                      {/* 锚定摘录: 没有它, 列表里看不出这条批注标的是哪段字。
                          点批注没有文字, 显示「光标位置」。 */}
                      {(excerpt || isPoint) && (
                        <p className="text-[10px] text-chrome-ink-muted mt-0.5 ml-[18px] truncate">
                          {isPoint ? t('comment.pointAnchor') : t('comment.anchor', { text: excerpt })}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-0.5 shrink-0">
                      {onResolveThread && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onResolveThread(thread.id) }}
                          className={cn(
                            'p-1 rounded text-chrome-ink-disabled',
                            thread.status === 'resolved'
                              ? 'hover:bg-amber-50 hover:text-amber-600'
                              : 'hover:bg-green-50 hover:text-green-600',
                          )}
                          title={thread.status === 'resolved' ? t('comment.unresolve') : t('comment.resolveTitle')}
                        >
                          {thread.status === 'resolved' ? <RotateCcw size={14} /> : <Check size={14} />}
                        </button>
                      )}
                      {onDeleteThread && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (window.confirm(t('comment.deleteConfirm'))) onDeleteThread(thread.id)
                          }}
                          className="p-1 rounded text-chrome-ink-disabled hover:bg-red-50 hover:text-red-600"
                          title={t('comment.deleteThread')}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {thread.status === 'resolved' && (
                    <span className="inline-block mt-1 ml-[18px] text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded">
                      {t('comment.resolvedBadge')}
                    </span>
                  )}

                  {/* 展开的回复线程 */}
                  {isExpanded && (
                    <div className="mt-2 ml-[18px] space-y-2">
                      {thread.comments.map((entry, idx) => (
                        <div
                          key={entry.id}
                          className={cn(
                            'text-xs p-2 rounded',
                            idx === 0 ? 'bg-amber-50' : 'bg-chrome-subtle',
                          )}
                        >
                          <div className="flex items-center justify-between gap-1.5 mb-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-chrome-ink-body">{entry.author}</span>
                              <span className="text-[10px] text-chrome-ink-muted">
                                {formatTime(entry.createdAt, t)}
                              </span>
                            </div>
                            {/* 只删回复: 首条是线程本体, 删它请用线程级删除 */}
                            {onDeleteReply && idx > 0 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onDeleteReply(thread.id, entry.id) }}
                                className="p-0.5 rounded text-chrome-ink-disabled hover:bg-red-50 hover:text-red-600"
                                title={t('comment.deleteReply')}
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                          <p className="text-chrome-ink-secondary leading-relaxed">{entry.content}</p>
                        </div>
                      ))}

                      {/* 回复输入 */}
                      {thread.status !== 'resolved' && (
                        <div className="flex gap-1.5 pt-1">
                          <input
                            type="text"
                            value={replyText[thread.id] || ''}
                            onChange={(e) => {
                              e.stopPropagation()
                              setReplyText(prev => ({ ...prev, [thread.id]: e.target.value }))
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && replyText[thread.id]?.trim()) {
                                e.stopPropagation()
                                onAddReply?.(thread.id, replyText[thread.id].trim())
                                setReplyText(prev => ({ ...prev, [thread.id]: '' }))
                              }
                            }}
                            placeholder={t('comment.replyPlaceholder')}
                            className="flex-1 text-xs px-2 py-1.5 border border-line rounded focus:outline-none focus:border-blue-300"
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (replyText[thread.id]?.trim()) {
                                onAddReply?.(thread.id, replyText[thread.id].trim())
                                setReplyText(prev => ({ ...prev, [thread.id]: '' }))
                              }
                            }}
                            disabled={!replyText[thread.id]?.trim()}
                            className="p-1 rounded text-chrome-ink-muted hover:text-blue-600 disabled:opacity-30"
                          >
                            <Reply size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 底部信息 */}
      <div className="px-4 py-2 border-t border-line-subtle text-[10px] text-chrome-ink-muted">
        {t('comment.summary', { open: counts.open, total: counts.all })}
      </div>
    </div>
  )
}

// ---- 工具函数 ----

function formatTime(
  ts: number | undefined,
  t: (key: keyof LocaleMessages, params?: LocaleParams) => string,
): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return t('comment.timeJustNow')
  if (diffMin < 60) return t('comment.timeMinutesAgo', { n: diffMin })
  if (diffMin < 1440) return t('comment.timeHoursAgo', { n: Math.floor(diffMin / 60) })
  return d.toLocaleDateString(localeManager.getLocale(), { month: 'short', day: 'numeric' })
}
