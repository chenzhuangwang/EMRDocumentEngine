// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// 状态栏
// ============================================================

import { FileText, Type, Wifi, WifiOff, Minus, Plus, Pilcrow, Activity, AlertTriangle, ListTree, History, CheckCheck, X } from 'lucide-react'
import { useEditorStoreSnapshot } from '@/components/editor/EditorProvider'
import { useEditorStore } from '@/store'
import { cn, formatWordCount } from '@/lib/utils'
import { ModeSwitcher } from '@/components/views/ModeSwitcher'
import type { EditorMode, ScoreResult } from '@emrde/document-engine'
import { useTranslation } from '@/i18n/useTranslation'

interface StatusBarProps {
  pageIndex?: number
  pageCount?: number
  wordCount?: number
  onlineCount?: number
  /** 缩放比例 (0.25-4.0) */
  scale?: number
  /** 缩放变更回调 */
  onScaleChange?: (scale: number) => void
  /** 不可见字符显示 */
  showInvisible?: boolean
  /** 不可见字符切换回调 */
  onToggleInvisible?: () => void
  /** 节结构显示 (契约 §31.14) */
  showSectionStructure?: boolean
  /** 节结构显示切换回调 */
  onToggleSectionStructure?: () => void
  /** 修订留痕显示 (契约 §12.13) — 纯视图开关 */
  showRevisionMarks?: boolean
  onToggleRevisionMarks?: () => void
  /** 修订追踪开关 (契约 §12.13) */
  trackChanges?: boolean
  onToggleTrackChanges?: () => void
  /** 接受 / 拒绝全部修订 (契约 §12.13) — 无修订时是空操作 */
  onAcceptAllRevisions?: () => void
  onRejectAllRevisions?: () => void
  /** 当前编辑模式 */
  mode?: EditorMode
  /** 模式切换回调 */
  onModeChange?: (mode: EditorMode) => void
  /**
   * 控件量表评分 (契约 §12.6.2 layer E) — 只读派生。
   * 无控件携带 numericValue 时不渲染, 现有文档不受影响。
   */
  scaleScore?: ScoreResult | null
}

export function StatusBar({
  pageIndex = 1,
  pageCount = 1,
  wordCount = 0,
  onlineCount = 0,
  scale = 1,
  onScaleChange,
  showInvisible = false,
  onToggleInvisible,
  showSectionStructure = true,
  onToggleSectionStructure,
  showRevisionMarks = true,
  onToggleRevisionMarks,
  trackChanges = false,
  onToggleTrackChanges,
  onAcceptAllRevisions,
  onRejectAllRevisions,
  mode,
  onModeChange,
  scaleScore,
}: StatusBarProps) {
  const { t } = useTranslation()
  const saveStatus = useEditorStoreSnapshot((s) => s.saveStatus)

  return (
    <footer className="h-statusbar bg-chrome-subtle border-t border-line flex items-center justify-between px-4 text-xs text-chrome-ink-tertiary flex-shrink-0 select-none">
      {/* 左侧：页面信息 */}
      <div className="flex items-center gap-4">
        {/* 不可见字符切换 (TASK-475) */}
        <button
          className={cn(
            'p-0.5 rounded transition-colors',
            showInvisible
              ? 'text-blue-600 bg-blue-50 hover:bg-blue-100'
              : 'text-chrome-ink-muted hover:text-chrome-ink-secondary hover:bg-chrome-muted',
          )}
          onClick={onToggleInvisible}
          title={showInvisible ? t('statusBar.hideInvisible') : t('statusBar.showInvisible')}
        >
          <Pilcrow size={14} />
        </button>

        {/* 节结构显示切换 (契约 §31.14) — 纯 UI 叠加层开关, 不影响分页 */}
        <button
          className={cn(
            'p-0.5 rounded transition-colors',
            showSectionStructure
              ? 'text-blue-600 bg-blue-50 hover:bg-blue-100'
              : 'text-chrome-ink-muted hover:text-chrome-ink-secondary hover:bg-chrome-muted',
          )}
          onClick={onToggleSectionStructure}
          title={showSectionStructure ? t('statusBar.hideStructure') : t('statusBar.showStructure')}
        >
          <ListTree size={14} />
        </button>

        {/* 修订留痕 (契约 §12.13):
            - History 图标 = 视图开关 (显示/隐藏标记, 与不可见字符开关同形);
            - 录制态按钮 = 修订追踪 (关闭时是描边, 打开时高亮 + 左侧红点);
            - ✓/✕ = 接受/拒绝全部 (有修订时才渲染 —— 无修订时点了也没事, 但
              两个永远置灰的按钮只会让人以为坏了)。 */}
        <button
          className={cn(
            'p-0.5 rounded transition-colors',
            showRevisionMarks
              ? 'text-blue-600 bg-blue-50 hover:bg-blue-100'
              : 'text-chrome-ink-muted hover:text-chrome-ink-secondary hover:bg-chrome-muted',
          )}
          onClick={onToggleRevisionMarks}
          title={showRevisionMarks ? t('statusBar.hideRevision') : t('statusBar.showRevision')}
        >
          <History size={14} />
        </button>
        <button
          className={cn(
            'p-0.5 rounded transition-colors flex items-center gap-1',
            trackChanges
              ? 'text-red-600 bg-red-50 hover:bg-red-100'
              : 'text-chrome-ink-muted hover:text-chrome-ink-secondary hover:bg-chrome-muted',
          )}
          onClick={onToggleTrackChanges}
          title={t('statusBar.trackChanges')}
        >
          <span className={cn('w-1.5 h-1.5 rounded-full', trackChanges ? 'bg-red-600' : 'bg-transparent')} />
          <Type size={14} />
        </button>
        <button
          className="p-0.5 rounded transition-colors text-chrome-ink-muted hover:text-green-700 hover:bg-chrome-muted"
          onClick={onAcceptAllRevisions}
          title={t('statusBar.acceptAllRevisions')}
        >
          <CheckCheck size={14} />
        </button>
        <button
          className="p-0.5 rounded transition-colors text-chrome-ink-muted hover:text-red-700 hover:bg-chrome-muted"
          onClick={onRejectAllRevisions}
          title={t('statusBar.rejectAllRevisions')}
        >
          <X size={14} />
        </button>

        <div className="flex items-center gap-1.5">
          <FileText size={12} />
          <span>{t('statusBar.pageOf', { current: pageIndex, total: pageCount })}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <Type size={12} />
          <span>{t('statusBar.wordCount', { n: formatWordCount(wordCount) })}</span>
        </div>

        {/* 控件量表评分 (§12.6.2 layer E) — 与质控合规分是两回事, 故独立标注 */}
        {scaleScore !== null && scaleScore !== undefined && scaleScore.counted > 0 && (
          <div
            className="flex items-center gap-1.5"
            title={t('statusBar.scale.tooltip', {
              total: scaleScore.total,
              counted: scaleScore.counted,
              uncounted: scaleScore.uncounted > 0
                ? t('statusBar.scale.uncountedNote', { n: scaleScore.uncounted })
                : '',
            })}
          >
            <Activity size={12} />
            <span>{t('statusBar.scale.value', { total: scaleScore.total })}</span>
          </div>
        )}
      </div>

      {/* 中间: 缩放控制 */}
      <div className="flex items-center gap-1">
        <button
          className="p-0.5 text-chrome-ink-muted hover:text-chrome-ink-secondary rounded transition-colors disabled:opacity-30"
          disabled={scale <= 0.25}
          onClick={() => onScaleChange?.(Math.max(0.25, scale - 0.1))}
          title={t('statusBar.zoomIn')}
        >
          <Minus size={12} />
        </button>

        <input
          type="range"
          className="w-20 h-1 accent-primary-500 cursor-pointer"
          min={25} max={400} step={5}
          value={Math.round(scale * 100)}
          onChange={(e) => onScaleChange?.(Number(e.target.value) / 100)}
          title={t('statusBar.zoom', { pct: Math.round(scale * 100) })}
        />

        <button
          className="p-0.5 text-chrome-ink-muted hover:text-chrome-ink-secondary rounded transition-colors disabled:opacity-30"
          disabled={scale >= 4}
          onClick={() => onScaleChange?.(Math.min(4, scale + 0.1))}
          title={t('statusBar.zoomOut')}
        >
          <Plus size={12} />
        </button>

        <span
          className="text-xs text-chrome-ink-tertiary w-10 text-center tabular-nums cursor-pointer hover:text-chrome-accent-ink"
          onClick={() => onScaleChange?.(1)}
          title={t('statusBar.zoomReset')}
        >
          {Math.round(scale * 100)}%
        </span>
      </div>
      <div className="flex items-center gap-4">
        {/* 引擎错误 (ErrorRecovery Level 2/3 上报) — 点击关闭 */}
        <EngineErrorChip />

        {/* 保存状态 */}
        <SaveStatusIcon status={saveStatus} />

        {/* 模式切换 */}
        {mode && onModeChange && (
          <ModeSwitcher mode={mode} onModeChange={onModeChange} />
        )}

        {/* 在线状态 */}
        <div className="flex items-center gap-1.5">
          {onlineCount > 0 ? (
            <>
              <Wifi size={12} className="text-green-500" />
              <span>{t('statusBar.online', { n: onlineCount })}</span>
            </>
          ) : (
            <>
              <WifiOff size={12} className="text-chrome-ink-muted" />
              <span className="text-chrome-ink-muted">{t('statusBar.offline')}</span>
            </>
          )}
        </div>
      </div>
    </footer>
  )
}

/**
 * 引擎错误提示 (ErrorRecovery 上报)。
 *
 * 在此之前引擎的 Level 2/3 容错只 console.error: 某一页渲染失败时画布上只有
 * 一张红色占位图, 用户看不到任何原因; 导入损坏文档更是**什么都没发生**。
 * 这里把那条链路的终点接上, 点击即关闭。
 */
function EngineErrorChip() {
  const { t } = useTranslation()
  const error = useEditorStore((s) => s.lastEngineError)
  const dismiss = useEditorStore((s) => s.dismissEngineError)
  if (!error) return null

  // 有键 → 现读语言包重译 (切语言立刻跟着变); 无键 → 用上报时的 message 快照
  // (UI 自造的文案, 没有可重译的键)。
  const msg = error.key ? t(error.key, error.params) : error.message

  return (
    <button
      className="flex items-center gap-1 max-w-[280px] text-error-500
                 hover:text-error-500/80 transition-colors"
      onClick={dismiss}
      title={t('statusBar.errorChipTitle', { code: error.code, msg })}
      aria-label={t('statusBar.errorChipAria', { msg })}
    >
      <AlertTriangle size={12} className="flex-shrink-0" />
      <span className="truncate">{msg}</span>
    </button>
  )
}

function SaveStatusIcon({ status }: { status: string }) {
  const { t } = useTranslation()
  switch (status) {
    case 'saved':
      return (
        <span className="flex items-center gap-1 text-green-600">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          {t('headerBar.saveStatus.saved')}
        </span>
      )
    case 'saving':
      return (
        <span className="flex items-center gap-1 text-chrome-accent-ink">
          <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse" />
          {t('headerBar.saveStatus.saving')}
        </span>
      )
    case 'unsaved':
      return (
        <span className="flex items-center gap-1 text-warning-500">
          <span className="w-1.5 h-1.5 rounded-full bg-warning-500" />
          {t('headerBar.saveStatus.unsaved')}
        </span>
      )
    case 'error':
      return (
        <span className="flex items-center gap-1 text-error-500">
          <span className="w-1.5 h-1.5 rounded-full bg-error-500" />
          {t('headerBar.saveStatus.error')}
        </span>
      )
    default:
      return null
  }
}