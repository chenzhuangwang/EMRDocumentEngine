// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// RevisionsPanel — 修订审阅面板 (契约 §12.13)
//
// 列出文档里的每一处修订, 支持逐处接受/拒绝与点击定位。
//
// 数据全部来自 `Editor.listRevisions()` (只读读模型); 面板本身不查文档、
// 不拼 mark、不改任何东西 —— 接受/拒绝经回调交给页面, 页面再交给
// Editor.acceptRevisions / rejectRevisions (命令, 可撤销)。
//
// 为什么需要它: 正文里的红色文字只能"看得到", 看不到"一共改了哪些、谁改的"。
// 逐处决定的入口此前只有右键菜单 —— 那时你已经在红色文字上了, 不需要列表;
// 需要列表的恰恰是"通读一遍再过"的场景。
// ============================================================

import { History, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RevisionListEntry } from '@emrde/document-engine'
import { useTranslation } from '@/i18n/useTranslation'

interface RevisionsPanelProps {
  revisions: RevisionListEntry[]
  /** 点击条目 → 定位到该处 */
  onSelect?: (entry: RevisionListEntry) => void
  onAccept?: (entry: RevisionListEntry) => void
  onReject?: (entry: RevisionListEntry) => void
}

/** 类型 → i18n 键 (标签与颜色都按类型, 与画布上的标记颜色同一语义) */
const TYPE_LABEL = {
  insert: 'revisions.insert',
  delete: 'revisions.delete',
  modify: 'revisions.modify',
} as const

/** 类型 → 徽标配色 (与 canvas token 的 revisionInsert/Delete/Modify 同意) */
const TYPE_CLASS = {
  insert: 'bg-green-50 text-green-700',
  delete: 'bg-red-50 text-red-700',
  modify: 'bg-blue-50 text-blue-700',
} as const

/** epoch ms → YYYY-MM-DD HH:mm (纯数字格式化, 不依赖 locale) */
function formatAt(at: number): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function RevisionsPanel({ revisions, onSelect, onAccept, onReject }: RevisionsPanelProps) {
  const { t } = useTranslation()

  if (revisions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-chrome-ink-muted">
        <History size={36} className="mb-2 opacity-30" />
        <span className="text-sm">{t('revisions.empty')}</span>
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-1 py-1">
      {revisions.map((entry) => (
        <li
          key={entry.nodeId}
          className="group rounded-md px-2 py-1.5 hover:bg-chrome-subtle"
        >
          <button
            type="button"
            onClick={() => onSelect?.(entry)}
            className="w-full text-left"
            title={entry.text}
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', TYPE_CLASS[entry.type])}>
                {t(TYPE_LABEL[entry.type])}
              </span>
              <span className="text-[10px] text-chrome-ink-muted truncate">
                {[entry.author, entry.at !== undefined ? formatAt(entry.at) : ''].filter(Boolean).join(' · ')}
              </span>
            </div>
            <div className="text-xs text-chrome-ink-body line-clamp-2 break-all">
              {entry.text || '—'}
            </div>
          </button>
          <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => onAccept?.(entry)}
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded text-green-700 hover:bg-green-50"
            >
              <Check size={11} /> {t('revisions.accept')}
            </button>
            <button
              type="button"
              onClick={() => onReject?.(entry)}
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded text-red-700 hover:bg-red-50"
            >
              <X size={11} /> {t('revisions.reject')}
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
