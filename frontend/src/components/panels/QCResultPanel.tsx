// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// QCResultPanel — 质控结果面板 (R52, v6.0)
//
// 显示 QC 检查结果: 评分+等级+问题列表
// 错误/警告/信息 三级 + 点击定位
// ============================================================

import { AlertTriangle, AlertCircle, Info, Shield, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { QCResult, QCIssue, QCGrade } from '@/engine/qc/QCEngine'
import { useTranslation } from '@/i18n/useTranslation'
import { locale as localeManager } from '@/engine'

// ---- 组件 ----

interface QCResultPanelProps {
  result: QCResult | null
  onIssueClick?: (issue: QCIssue) => void
  onRecheck?: () => void
}

export function QCResultPanel({ result, onIssueClick, onRecheck }: QCResultPanelProps) {
  const { t } = useTranslation()
  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-chrome-ink-muted">
        <Shield size={36} className="mb-2 opacity-30" />
        <span className="text-sm">{t('qc.empty')}</span>
        {onRecheck && (
          <button
            onClick={onRecheck}
            className="mt-3 px-3 py-1.5 text-xs bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100"
          >
            {t('qc.start')}
          </button>
        )}
      </div>
    )
  }

  const { score, grade, issues, stats } = result

  return (
    <div className="flex flex-col h-full">
      {/* 评分卡片 */}
      <div className="px-4 py-3 border-b border-line-subtle">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-chrome-ink-secondary">{t('qc.score')}</span>
          <span className="text-[10px] text-chrome-ink-muted">
            {new Date(result.checkedAt).toLocaleTimeString(localeManager.getLocale())}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold',
            GRADE_STYLE[grade].bg,
            GRADE_STYLE[grade].text,
          )}>
            {grade}
          </div>
          <div>
            <div className="text-2xl font-bold text-chrome-ink-strong">{score}</div>
            <div className="text-[10px] text-chrome-ink-muted">{t('qc.maxScore')}</div>
          </div>
        </div>
      </div>

      {/* 统计条 */}
      <div className="flex gap-3 px-4 py-2 border-b border-line-subtle text-[10px]">
        <span className="flex items-center gap-1 text-red-600">
          <AlertCircle size={10} />
          {t('qc.errorCount', { n: stats.errors })}
        </span>
        <span className="flex items-center gap-1 text-amber-600">
          <AlertTriangle size={10} />
          {t('qc.warningCount', { n: stats.warnings })}
        </span>
        <span className="flex items-center gap-1 text-blue-600">
          <Info size={10} />
          {t('qc.infoCount', { n: stats.infos })}
        </span>
      </div>

      {/* 问题列表 */}
      <div className="flex-1 overflow-y-auto divide-y divide-line-subtle">
        {issues.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-chrome-ink-muted">
            <Shield size={28} className="mb-1 opacity-40" />
            <span className="text-xs">{t('qc.passed')}</span>
          </div>
        ) : (
          issues.map((issue, idx) => {
            // 只有带定位的问题才能跳转 (契约 §12.2: 文档级规则无具体位置)。
            // 无定位的条目不做成按钮 —— 点了没反应的控件比没有控件更误导。
            const locatable = (issue.paragraphPath?.length ?? 0) > 0
            return (
              <button
                key={`${issue.ruleId}-${idx}`}
                onClick={() => { if (locatable) onIssueClick?.(issue) }}
                disabled={!locatable}
                title={locatable ? t('qc.jumpToIssue') : t('qc.docLevelIssue')}
                className={cn(
                  'w-full text-left px-4 py-2.5 transition-colors flex items-start gap-2',
                  locatable ? 'hover:bg-chrome-subtle' : 'cursor-default',
                )}
              >
                <span className={cn('mt-0.5 flex-shrink-0', SEVERITY_ICON[issue.severity].color)}>
                  {SEVERITY_ICON[issue.severity].icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-chrome-ink-body truncate">{issue.ruleName}</div>
                  <div className="text-[10px] text-chrome-ink-tertiary mt-0.5">{issue.message}</div>
                </div>
                {locatable && <ChevronRight size={12} className="text-chrome-ink-disabled flex-shrink-0 mt-0.5" />}
              </button>
            )
          })
        )}
      </div>

      {/* 重新检查 */}
      {onRecheck && (
        <div className="px-4 py-2 border-t border-line-subtle">
          <button
            onClick={onRecheck}
            className="w-full text-xs py-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
          >
            {t('qc.recheck')}
          </button>
        </div>
      )}
    </div>
  )
}

// ---- 样式常量 ----

const GRADE_STYLE: Record<QCGrade, { bg: string; text: string }> = {
  A: { bg: 'bg-green-100', text: 'text-green-700' },
  B: { bg: 'bg-blue-100', text: 'text-blue-700' },
  C: { bg: 'bg-amber-100', text: 'text-amber-700' },
  D: { bg: 'bg-red-100', text: 'text-red-700' },
}

const SEVERITY_ICON = {
  error: { icon: <AlertCircle size={14} />, color: 'text-red-500' },
  warning: { icon: <AlertTriangle size={14} />, color: 'text-amber-500' },
  info: { icon: <Info size={14} />, color: 'text-blue-500' },
}