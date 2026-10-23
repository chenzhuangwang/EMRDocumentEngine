// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// CommentBalloonOverlay — 页面右侧的批注气泡 (契约 §12.14)
//
// DCWriter 式呈现: 批注范围在画布上由 Draw 画虚线框, 本层在纸张右缘外
// 挂一个黄色气泡 (作者 · 时间 + 内容), 点击选中对应线程。
//
// 为什么是 DOM 叠加层而不是画进 Canvas:
//   - 气泡是旁注, 不参与文档回流/分页/命中测试;
//   - 文本换行、点击与可访问性交给 DOM, 不把排版职责塞进 Draw。
//
// 几何来源: Editor.getCommentClientRects —— 与画布虚线框共用
// Draw.forEachCommentRect, 所以气泡指向的位置与框完全同源。
// 画布虚线到页缘后断开, 本层用 SVG 从页缘端点**直接斜拉**到每条气泡的左缘,
// 气泡按实测高度紧凑堆叠 —— 与参考实现一致, 不再走页缘竖直通道。
//
// 显示门控与画布一致: 强调层关闭或已解决时不显示 (选中该线程时例外)。
// ================================================================

import { useEffect, useState } from 'react'
import { useEditorReady, useEditorRef, useEditorStoreSnapshot } from './EditorProvider'
import { locale } from '@emrde/document-engine'
import type { CommentClientRect, CommentEntry, CommentThread } from '@emrde/document-engine'
import { useTranslation } from '@/i18n/useTranslation'
import { cn } from '@/lib/utils'

interface CommentBalloonOverlayProps {
  /** 当前选中的线程 (来自 EditorPage 的 active 状态) */
  activeThreadId?: string
  /** 点击气泡 → 选中并定位线程 (复用面板的 revealLocation) */
  onSelectThread?: (threadId: string) => void
}

/** jsdom 无 rAF → setTimeout 兜底 (与 TableGrowOverlay / SectionStructureOverlay 同法) */
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

const BALLOON_WIDTH = 280
/** 页缘到气泡的左缘间距 (引线斜拉的横向跨度) */
const BALLOON_GAP = 18
const VIEWPORT_MARGIN = 8
const STACK_GAP = 4

/**
 * 气泡引线: 画布里的虚线到页缘 (rect.pageRight, rect.top+6) 后由本层接着画。
 * 直接斜拉到气泡左缘 —— 与参考实现一致; 不再沿页缘走竖直通道 (通道会把
 * 多条引线挤成一根贯穿整个页高的长竖线, 反而看不清各自从哪一行来)。
 */
export function balloonLeaderPoints(rect: CommentClientRect, left: number, top: number): string {
  return `${rect.pageRight},${rect.top + 6} ${left},${top + 22}`
}

/**
 * 气泡纵向堆叠: 以期望位置为起点, 只在下一条会盖住上一条时下推。
 * height 取已渲染气泡的实测高度 (首帧还没有 DOM 时由调用方给 fallback),
 * 因此短内容的气泡不会被固定占位拉开距离。
 */
export function stackBalloonTops(items: Array<{ top: number; height: number }>): number[] {
  let prevBottom: number | null = null
  return items.map(it => {
    const top = prevBottom === null ? it.top : Math.max(it.top, prevBottom + STACK_GAP)
    prevBottom = top + it.height
    return top
  })
}

/** 头像底色: 按作者名稳定取色 (同一作者在气泡/回复里颜色一致) */
const AVATAR_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-violet-500',
  'bg-rose-500', 'bg-cyan-600', 'bg-amber-500',
]

function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

function Avatar({ name, size = 20 }: { name: string; size?: number }) {
  const initial = [...(name || '?')][0] ?? '?'
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white',
        avatarColor(name),
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
      aria-hidden="true"
    >
      {initial}
    </span>
  )
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(locale.getLocale())
}

interface BalloonEntry {
  thread: CommentThread
  rect: CommentClientRect
  left: number
  top: number
}

function sameEntries(a: BalloonEntry[], b: BalloonEntry[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]; const y = b[i]
    if (x.thread.id !== y.thread.id || x.left !== y.left || x.top !== y.top) return false
    if (x.thread.status !== y.thread.status || x.thread.comments.length !== y.thread.comments.length) return false
  }
  return true
}

/** 气泡横向落点: 优先贴在纸张右缘外, 放不下时贴视口右缘 */
function balloonLeft(rect: CommentClientRect, viewportWidth: number): number {
  const outside = rect.pageRight + BALLOON_GAP
  return Math.max(VIEWPORT_MARGIN, Math.min(outside, viewportWidth - BALLOON_WIDTH - VIEWPORT_MARGIN))
}

export function CommentBalloonOverlay({ activeThreadId, onSelectThread }: CommentBalloonOverlayProps) {
  const editorRef = useEditorRef()
  // 必须等 ready: 子组件 mount effect 早于 EditorProvider 建 Editor
  const ready = useEditorReady()
  const { t } = useTranslation()
  const mode = useEditorStoreSnapshot((s) => s.runtime.view.mode)
  const showCommentMarks = useEditorStoreSnapshot((s) => s.runtime.view.showCommentMarks)

  const visibleMode = mode === 'edit' || mode === 'form' || mode === 'design'

  const [threads, setThreads] = useState<CommentThread[]>([])
  const [entries, setEntries] = useState<BalloonEntry[]>([])
  /** 每条线程的回复草稿 (气泡内输入, 不随 entries 重建丢失) */
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({})

  const submitReply = (threadId: string): void => {
    const text = (replyDraft[threadId] ?? '').trim()
    if (!text) return
    editorRef.current?.addCommentReply(threadId, text)
    setReplyDraft(prev => ({ ...prev, [threadId]: '' }))
  }

  // 线程内容: 跟随 contentChange 同步 (新建/删除/回复/解决都会触发)
  useEffect(() => {
    const ed = editorRef.current
    if (!ready || !ed) return
    const sync = () => setThreads(ed.getComments())
    sync()
    ed.on('contentChange', sync)
    return () => { ed.off('contentChange', sync) }
  }, [ready, editorRef])

  // 几何: 逐帧读; 后台标签页 rAF 被挂起 → 退回定时轮询 (仓库既有坑)
  useEffect(() => {
    if (!visibleMode || threads.length === 0) {
      setEntries(prev => (prev.length === 0 ? prev : []))
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
        const all = ed.getCommentClientRects()
        const viewportWidth = window.innerWidth
        const next: BalloonEntry[] = []
        for (const thread of threads) {
          const active = thread.id === activeThreadId
          // 强调层关闭 / 已解决 → 不挂气泡 (选中时例外)
          if (!active && (!showCommentMarks || thread.status === 'resolved')) continue
          const rects = all.get(thread.id)
          if (!rects || rects.length === 0) continue
          // 取该线程在第一页的并集框作气泡锚点
          const rect = rects[0]
          next.push({ thread, rect, left: balloonLeft(rect, viewportWidth), top: rect.top + 8 })
        }
        // 纵向堆叠: 以 top 排序, 用已渲染气泡的实测高度紧凑下推
        next.sort((a, b) => a.top - b.top)
        const heights = new Map<string, number>()
        for (const el of document.querySelectorAll('[data-comment-balloon]')) {
          const id = el.getAttribute('data-comment-balloon')
          if (id) heights.set(id, el.getBoundingClientRect().height)
        }
        const tops = stackBalloonTops(next.map(entry => ({
          top: entry.top,
          height: heights.get(entry.thread.id) ?? 120,
        })))
        next.forEach((entry, i) => { entry.top = tops[i] })
        setEntries(prev => (sameEntries(prev, next) ? prev : next))
      }
      schedule()
    }

    schedule()
    return () => { cancelled = true; cancelScheduled?.() }
  }, [visibleMode, threads, showCommentMarks, activeThreadId, editorRef])

  if (!visibleMode || entries.length === 0) return null

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 34 }}>
      {/* 引线: 接住画布虚线在页缘的终点, 连到每条气泡 (纯展示, 不挡事件) */}
      <svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
        aria-hidden="true"
      >
        {entries.map(({ thread, rect, left, top }) => (
          <polyline
            key={thread.id}
            data-comment-leader={thread.id}
            points={balloonLeaderPoints(rect, left, top)}
            fill="none"
            stroke="rgba(180, 83, 9, 0.75)"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        ))}
      </svg>
      {entries.map(({ thread, left, top }) => {
        const first = thread.comments[0]
        const replies = thread.comments.slice(1)
        const resolved = thread.status === 'resolved'
        const active = thread.id === activeThreadId
        return (
          <div
            key={thread.id}
            data-comment-balloon={thread.id}
            role="group"
            style={{ position: 'fixed', left, top, width: BALLOON_WIDTH, pointerEvents: 'auto' }}
            className={cn(
              'rounded-lg border bg-chrome text-left shadow-lg transition-shadow',
              active ? 'border-amber-500 ring-1 ring-amber-300' : 'border-amber-300',
            )}
            title={first?.content ?? ''}
            onClick={(e) => {
              e.stopPropagation()
              onSelectThread?.(thread.id)
            }}
          >
            {/* 头部: 头像 / 作者 / 时间 / 状态 */}
            <div className="flex items-start gap-2 px-2.5 pt-2">
              <Avatar name={thread.author} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-chrome-ink-strong">{thread.author}</div>
                <div className="text-[10px] text-chrome-ink-tertiary">{formatTime(thread.createdAt)}</div>
              </div>
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium',
                  resolved ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-600',
                )}
              >
                {resolved ? t('comment.resolvedBadge') : t('comment.filter.unresolved')}
              </span>
            </div>

            {/* 首条内容 */}
            <div className="px-2.5 pb-1 pt-1.5 text-xs leading-relaxed text-chrome-ink-body
                            whitespace-pre-wrap break-words">
              {first?.content ?? ''}
            </div>

            {/* 回复列表 (可滚动) */}
            {replies.length > 0 && (
              <div
                className="mx-2 mb-1 max-h-40 space-y-2 overflow-y-auto rounded border border-line/70
                           bg-chrome-subtle/50 p-1.5"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                {replies.map((reply: CommentEntry) => (
                  <div key={reply.id} className="flex gap-1.5">
                    <Avatar name={reply.author} size={16} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1.5">
                        <span className="truncate text-[10px] font-medium text-chrome-ink-body">
                          {reply.author}
                        </span>
                        <span className="shrink-0 text-[9px] text-chrome-ink-tertiary">
                          {formatTime(reply.createdAt)}
                        </span>
                      </div>
                      <div className="mt-0.5 rounded bg-chrome px-2 py-1 text-[11px] leading-relaxed
                                      text-chrome-ink-body whitespace-pre-wrap break-words">
                        {reply.content}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 回复输入 (已解决线程不再允许回复) */}
            {!resolved && (
              <div
                className="border-t border-line px-2 py-1.5"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <textarea
                  value={replyDraft[thread.id] ?? ''}
                  onChange={(e) => setReplyDraft(prev => ({ ...prev, [thread.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      submitReply(thread.id)
                    }
                  }}
                  placeholder={t('comment.replyPlaceholder')}
                  rows={2}
                  className="w-full resize-none rounded border border-line bg-chrome px-2 py-1 text-[11px]
                             text-chrome-ink-body focus:border-amber-400 focus:outline-none"
                />
                <div className="mt-1 flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setReplyDraft(prev => ({ ...prev, [thread.id]: '' }))}
                    className="rounded border border-line px-2 py-0.5 text-[11px] text-chrome-ink-muted
                               hover:bg-chrome-subtle"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    disabled={!(replyDraft[thread.id] ?? '').trim()}
                    onClick={() => submitReply(thread.id)}
                    className="rounded bg-primary-500 px-2.5 py-0.5 text-[11px] text-white
                               hover:bg-primary-600 disabled:opacity-40"
                  >
                    {t('comment.reply')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
