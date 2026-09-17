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

import { useState } from 'react'
import { MessageSquare, Check, Reply, ChevronDown, X, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CommentThread } from '@/engine/document/core/DocumentModel'

// ---- 组件 Props ----

interface CommentPanelProps {
  threads: CommentThread[]
  activeThreadId?: string
  onSelectThread?: (threadId: string) => void
  onResolveThread?: (threadId: string) => void
  onAddReply?: (threadId: string, content: string) => void
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
  onClose,
  onNewComment,
  getThreadExcerpt,
}: CommentPanelProps) {
  const [filter, setFilter] = useState<FilterMode>('open')
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set())
  const [replyText, setReplyText] = useState<Record<string, string>>({})
  /** 新建批注的内联输入 (R32 补: 此前面板只有列表, 无任何创建入口) */
  const [newOpen, setNewOpen] = useState(false)
  const [newText, setNewText] = useState('')
  const [newError, setNewError] = useState<string | null>(null)

  const submitNew = () => {
    const content = newText.trim()
    if (content === '' || !onNewComment) return
    if (onNewComment(content)) {
      setNewText(''); setNewOpen(false); setNewError(null)
    } else {
      setNewError('请先在文档中选中同一段落内的文字（或把光标放到要批注的位置）')
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

  const FILTERS: { key: FilterMode; label: string }[] = [
    { key: 'all', label: `全部 (${counts.all})` },
    { key: 'open', label: `未解决 (${counts.open})` },
    { key: 'resolved', label: `已解决 (${counts.resolved})` },
  ]

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-gray-500" />
          <span className="text-sm font-medium text-gray-800">批注</span>
          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
            {counts.open}
          </span>
          {onNewComment && (
            <button
              onClick={() => { setNewOpen(v => !v); setNewError(null) }}
              title="在文档中选中文字后新建批注"
              className={cn(
                'ml-1 flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded transition-colors',
                newOpen ? 'bg-blue-50 text-blue-700' : 'text-blue-600 hover:bg-blue-50',
              )}
            >
              <Plus size={12} />
              新建
            </button>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* 筛选 */}
      <div className="flex gap-1 px-4 py-2 border-b border-gray-100">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'text-xs px-2 py-1 rounded transition-colors',
              filter === f.key
                ? 'bg-blue-50 text-blue-700 font-medium'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 新建批注 (R32 补): 锚点取文档当前选区/光标, 故输入框只收内容 */}
      {newOpen && onNewComment && (
        <div className="px-4 py-2 border-b border-gray-100 bg-blue-50/40">
          <textarea
            autoFocus
            value={newText}
            onChange={(e) => { setNewText(e.target.value); setNewError(null) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitNew() }
              if (e.key === 'Escape') { setNewOpen(false); setNewText(''); setNewError(null) }
            }}
            rows={2}
            placeholder="批注内容…（Enter 提交，Shift+Enter 换行）"
            className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded resize-none
                       focus:outline-none focus:border-blue-400 bg-white"
          />
          {newError && <p className="mt-1 text-[10px] text-amber-600">{newError}</p>}
          <div className="flex justify-end gap-1 mt-1">
            <button
              onClick={() => { setNewOpen(false); setNewText(''); setNewError(null) }}
              className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded"
            >
              取消
            </button>
            <button
              onClick={submitNew}
              disabled={newText.trim() === ''}
              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700
                         disabled:opacity-40 disabled:cursor-default"
            >
              添加批注
            </button>
          </div>
        </div>
      )}

      {/* 批注列表 */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <MessageSquare size={32} className="mb-2 opacity-40" />
            <span className="text-sm">暂无批注</span>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map(thread => {
              const isExpanded = expandedThreads.has(thread.id)
              const isActive = thread.id === activeThreadId
              const lastEntry = thread.comments[thread.comments.length - 1]
              const excerpt = getThreadExcerpt?.(thread.id) ?? ''

              return (
                <div
                  key={thread.id}
                  className={cn(
                    'px-4 py-3 cursor-pointer transition-colors',
                    isActive && 'bg-blue-50 border-l-2 border-blue-400',
                    !isActive && 'hover:bg-gray-50',
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
                            'text-gray-400 transition-transform',
                            isExpanded && 'rotate-180',
                          )}
                        />
                        <span className="text-xs font-medium text-gray-800 truncate">
                          {thread.author}
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {formatTime(lastEntry?.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 mt-1 line-clamp-2 ml-[18px]">
                        {lastEntry?.content || '(无内容)'}
                      </p>
                      {/* 锚定摘录: 没有它, 列表里看不出这条批注标的是哪段字 */}
                      {excerpt && (
                        <p className="text-[10px] text-gray-400 mt-0.5 ml-[18px] truncate">
                          锚定：「{excerpt}」
                        </p>
                      )}
                    </div>

                    {thread.status !== 'resolved' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onResolveThread?.(thread.id) }}
                        className="p-1 rounded hover:bg-green-50 text-gray-300 hover:text-green-600 shrink-0"
                        title="标记为已解决"
                      >
                        <Check size={14} />
                      </button>
                    )}
                  </div>

                  {thread.status === 'resolved' && (
                    <span className="inline-block mt-1 ml-[18px] text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded">
                      已解决
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
                            idx === 0 ? 'bg-amber-50' : 'bg-gray-50',
                          )}
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="font-medium text-gray-700">{entry.author}</span>
                            <span className="text-[10px] text-gray-400">
                              {formatTime(entry.createdAt)}
                            </span>
                          </div>
                          <p className="text-gray-600 leading-relaxed">{entry.content}</p>
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
                            placeholder="输入回复..."
                            className="flex-1 text-xs px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:border-blue-300"
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
                            className="p-1 rounded text-gray-400 hover:text-blue-600 disabled:opacity-30"
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
      <div className="px-4 py-2 border-t border-gray-100 text-[10px] text-gray-400">
        {counts.open} 条未解决 · {counts.all} 条总计
      </div>
    </div>
  )
}

// ---- 工具函数 ----

function formatTime(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin}分钟前`
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}小时前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}
