// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// DocumentCompareView — 文档比较视图 (R47, v6.0)
//
// 双栏对比: 左(旧文档) | 右(新文档) + 差异高亮
// 对齐 TASK-516, UIUX §5.6
// ============================================================

import { useMemo } from 'react'
import { Equal, Plus, Minus, Edit3, X, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DocumentTree } from '@/engine/document/core/DocumentModel'
import { DocumentDiffer, type DiffResult } from '@/engine/DocumentDiffer'
import { NodePool } from '@/engine/document/core/NodePool'
import { useTranslation } from '@/i18n/useTranslation'
import type { LocaleMessages } from '@/engine'

// ---- 类型 ----

interface DocumentCompareViewProps {
  oldDoc: DocumentTree
  oldPool: NodePool
  newDoc: DocumentTree
  newPool: NodePool
  onAcceptChange?: (diff: DiffResult) => void
  onRejectChange?: (diff: DiffResult) => void
  onAcceptAll?: () => void
  onRejectAll?: () => void
}

/** DiffOp → i18n 标签键 (单一映射, 不重复三份) */
const DIFF_LABEL_KEYS: Record<DiffResult['op'], keyof LocaleMessages> = {
  insert: 'compare.label.insert',
  delete: 'compare.label.delete',
  modify: 'compare.label.modify',
  equal: 'compare.label.equal',
}

// ---- 组件 ----

export function DocumentCompareView({
  oldDoc, oldPool, newDoc, newPool,
  onAcceptChange, onRejectChange,
  onAcceptAll, onRejectAll,
}: DocumentCompareViewProps) {
  const { t } = useTranslation()
  const diffs = useMemo(() => {
    return new DocumentDiffer().compare(oldDoc, oldPool, newDoc, newPool)
  }, [oldDoc, oldPool, newDoc, newPool])

  const stats = useMemo(() => {
    let insertions = 0, deletions = 0, modifications = 0, equal = 0
    for (const d of diffs) {
      if (d.op === 'insert') insertions++
      else if (d.op === 'delete') deletions++
      else if (d.op === 'modify') modifications++
      else equal++
    }
    return { insertions, deletions, modifications, equal }
  }, [diffs])

  return (
    <div className="flex flex-col h-full bg-chrome">
      {/* 统计栏 */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-line-subtle bg-chrome-subtle text-xs">
        <span className="font-medium text-chrome-ink-body">{t('compare.title')}</span>
        <span className="flex items-center gap-1 text-green-600">
          <Plus size={12} /> {t('compare.count.insert', { n: stats.insertions })}
        </span>
        <span className="flex items-center gap-1 text-red-600">
          <Minus size={12} /> {t('compare.count.delete', { n: stats.deletions })}
        </span>
        <span className="flex items-center gap-1 text-amber-600">
          <Edit3 size={12} /> {t('compare.count.modify', { n: stats.modifications })}
        </span>
        <span className="flex items-center gap-1 text-chrome-ink-muted">
          <Equal size={12} /> {t('compare.count.equal', { n: stats.equal })}
        </span>

        <div className="flex-1" />

        <button
          onClick={onAcceptAll}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-green-50 text-green-700
                     rounded hover:bg-green-100 transition-colors"
        >
          <Check size={12} /> {t('compare.acceptAll')}
        </button>
        <button
          onClick={onRejectAll}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-red-50 text-red-700
                     rounded hover:bg-red-100 transition-colors"
        >
          <X size={12} /> {t('compare.rejectAll')}
        </button>
      </div>

      {/* 差异列表 */}
      <div className="flex-1 overflow-y-auto divide-y divide-line-subtle">
        {diffs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-chrome-ink-muted">
            <Equal size={36} className="mb-2 opacity-30" />
            <span className="text-sm">{t('compare.identical')}</span>
          </div>
        ) : (
          diffs.map((diff, idx) => (
            <DiffRow
              key={`${diff.paraId}-${idx}`}
              diff={diff}
              oldPool={oldPool}
              newPool={newPool}
              onAccept={() => onAcceptChange?.(diff)}
              onReject={() => onRejectChange?.(diff)}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ---- 单行差异 ----

function DiffRow({
  diff, oldPool, newPool,
  onAccept, onReject,
}: {
  diff: DiffResult
  oldPool: NodePool
  newPool: NodePool
  onAccept?: () => void
  onReject?: () => void
}) {
  const { t } = useTranslation()
  const config = DIFF_CONFIG[diff.op]
  const text = getDiffText(diff, oldPool, newPool, t)

  return (
    <div className={cn('px-4 py-2.5 flex items-start gap-3', config.bg)}>
      {/* 操作图标 */}
      <span className={cn('mt-0.5 flex-shrink-0', config.iconColor)}>
        {config.icon}
      </span>

      {/* 内容 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={cn('text-xs font-medium', config.labelColor)}>
            {t(DIFF_LABEL_KEYS[diff.op])}
          </span>
          {diff.op === 'modify' && diff.textChanges && (
            <span className="text-[10px] text-chrome-ink-muted">
              {t('compare.textChangeCount', { n: diff.textChanges.filter(c => c.op !== 'equal').length })}
            </span>
          )}
        </div>

        {/* 段落文本 */}
        <div className={cn(
          'text-sm leading-relaxed rounded px-2 py-1',
          config.textBg,
        )}>
          {diff.op === 'modify' && diff.textChanges ? (
            <span>
              {diff.textChanges.map((tc, i) => (
                <span
                  key={i}
                  className={cn(
                    tc.op === 'insert' && 'bg-green-200 text-green-900',
                    tc.op === 'delete' && 'bg-red-200 text-red-900 line-through',
                    tc.op === 'equal' && 'text-chrome-ink-secondary',
                  )}
                >
                  {tc.text}
                </span>
              ))}
            </span>
          ) : (
            <span className={cn(
              diff.op === 'delete' && 'line-through',
              diff.op === 'insert' && 'text-green-800',
              diff.op === 'equal' && 'text-chrome-ink-tertiary',
            )}>
              {text}
            </span>
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      {diff.op !== 'equal' && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onAccept}
            title={t('compare.accept')}
            className="p-1 rounded hover:bg-green-100 text-chrome-ink-disabled hover:text-green-600"
          >
            <Check size={14} />
          </button>
          <button
            onClick={onReject}
            title={t('compare.reject')}
            className="p-1 rounded hover:bg-red-100 text-chrome-ink-disabled hover:text-red-600"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

// ---- 差异配置 (仅样式; 标签走 i18n) ----

const DIFF_CONFIG: Record<DiffResult['op'], {
  bg: string
  labelColor: string
  icon: React.ReactNode
  iconColor: string
  textBg: string
}> = {
  insert: {
    bg: 'bg-green-50/60',
    labelColor: 'text-green-700',
    icon: <Plus size={14} />,
    iconColor: 'text-green-500',
    textBg: 'bg-green-50',
  },
  delete: {
    bg: 'bg-red-50/60',
    labelColor: 'text-red-700',
    icon: <Minus size={14} />,
    iconColor: 'text-red-500',
    textBg: 'bg-red-50',
  },
  modify: {
    bg: 'bg-amber-50/60',
    labelColor: 'text-amber-700',
    icon: <Edit3 size={14} />,
    iconColor: 'text-amber-500',
    textBg: 'bg-amber-50',
  },
  equal: {
    bg: '',
    labelColor: 'text-chrome-ink-muted',
    icon: <Equal size={14} />,
    iconColor: 'text-chrome-ink-muted',
    textBg: '',
  },
}

// ---- 工具 ----

function getDiffText(
  diff: DiffResult,
  oldPool: NodePool,
  newPool: NodePool,
  t: (key: keyof LocaleMessages, params?: import('@/engine').LocaleParams) => string,
): string {
  const pool = diff.op === 'delete' ? oldPool : newPool
  const targetId = diff.op === 'delete' ? diff.oldParaId : diff.newParaId || diff.paraId
  if (!targetId) return t('compare.noContent')

  const para = pool.nodes.get(targetId) as { children?: readonly string[] } | undefined
  if (!para?.children) return t('compare.noContent')

  const parts: string[] = []
  for (const cid of para.children) {
    const n = pool.nodes.get(cid) as { type?: string; text?: string } | undefined
    if (n?.type === 'text' || n?.type === 'field') parts.push(n.text || '')
    else if (n?.type === 'image') parts.push(t('compare.imagePlaceholder'))
    else if (n?.type === 'footnote_ref') parts.push(t('compare.footnotePlaceholder'))
  }
  return parts.join('') || t('compare.emptyParagraph')
}

// 移除旧的 findNodeById / findNodeRecursive / findInChildren / buildNodePoolFromDoc