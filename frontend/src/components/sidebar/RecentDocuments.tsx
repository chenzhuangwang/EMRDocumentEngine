// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// RecentDocuments — 最近文档 (R41, v6.0)
//
// localStorage 存储最近 10 份文档, 显示在侧栏快速打开
// ============================================================

import { FileText, Clock, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/useTranslation'
import { locale as localeManager, type LocaleParams, type LocaleMessages } from '@emrde/document-engine'

// ---- 类型 ----

export interface RecentDocument {
  id: string
  title: string
  lastOpenedAt: number
  wordCount?: number
}

// ---- localStorage 持久化 ----

const STORAGE_KEY = 'emr-recent-docs'
const MAX_ITEMS = 10

export function getRecentDocuments(): RecentDocument[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function addRecentDocument(doc: RecentDocument): void {
  const docs = getRecentDocuments().filter(d => d.id !== doc.id)
  docs.unshift(doc)
  if (docs.length > MAX_ITEMS) docs.length = MAX_ITEMS
  localStorage.setItem(STORAGE_KEY, JSON.stringify(docs))
}

export function removeRecentDocument(id: string): void {
  const docs = getRecentDocuments().filter(d => d.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(docs))
}

// ---- 组件 ----

interface RecentDocumentsProps {
  onOpenDocument?: (doc: RecentDocument) => void
  activeDocId?: string
}

export function RecentDocuments({ onOpenDocument, activeDocId }: RecentDocumentsProps) {
  const { t } = useTranslation()
  const docs = getRecentDocuments()

  if (docs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-chrome-ink-muted">
        <Clock size={28} className="mb-2 opacity-40" />
        <span className="text-xs">{t('recentDoc.empty')}</span>
      </div>
    )
  }

  return (
    <div className="space-y-0.5">
      {docs.map(doc => (
        <button
          key={doc.id}
          onClick={() => onOpenDocument?.(doc)}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 text-left rounded-md transition-colors',
            activeDocId === doc.id
              ? 'bg-blue-50 text-blue-700'
              : 'hover:bg-chrome-subtle text-chrome-ink-body',
          )}
        >
          <FileText size={14} className="text-chrome-ink-muted flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate">{doc.title}</div>
            <div className="text-[10px] text-chrome-ink-muted">
              {formatRelativeTime(doc.lastOpenedAt, t)}
              {doc.wordCount ? t('recentDoc.separator', { n: doc.wordCount }) : ''}
            </div>
          </div>
          <ExternalLink size={12} className="text-chrome-ink-disabled flex-shrink-0" />
        </button>
      ))}
    </div>
  )
}

// ---- 工具 ----

function formatRelativeTime(
  ts: number,
  t: (key: keyof LocaleMessages, params?: LocaleParams) => string,
): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return t('recentDoc.justNow')
  if (min < 60) return t('recentDoc.minutesAgo', { n: min })
  const hours = Math.floor(min / 60)
  if (hours < 24) return t('recentDoc.hoursAgo', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return t('recentDoc.daysAgo', { n: days })
  return new Date(ts).toLocaleDateString(localeManager.getLocale(), { month: 'short', day: 'numeric' })
}
