// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// 状态栏
// ============================================================

import { FileText, Type, Wifi, WifiOff, Minus, Plus, Pilcrow, Activity, AlertTriangle } from 'lucide-react'
import { useEditorStoreSnapshot } from '@/components/editor/EditorProvider'
import { useEditorStore } from '@/store'
import { cn, formatWordCount } from '@/lib/utils'
import { ModeSwitcher } from '@/components/views/ModeSwitcher'
import type { EditorMode, ScoreResult } from '@/engine'

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
  mode,
  onModeChange,
  scaleScore,
}: StatusBarProps) {
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
          title={showInvisible ? '隐藏格式标记' : '显示格式标记 (Ctrl+Shift+8)'}
        >
          <Pilcrow size={14} />
        </button>

        <div className="flex items-center gap-1.5">
          <FileText size={12} />
          <span>第 {pageIndex} 页 / 共 {pageCount} 页</span>
        </div>

        <div className="flex items-center gap-1.5">
          <Type size={12} />
          <span>{formatWordCount(wordCount)} 字</span>
        </div>

        {/* 控件量表评分 (§12.6.2 layer E) — 与质控合规分是两回事, 故独立标注 */}
        {scaleScore !== null && scaleScore !== undefined && scaleScore.counted > 0 && (
          <div
            className="flex items-center gap-1.5"
            title={
              `量表评分 ${scaleScore.total} 分（由 ${scaleScore.counted} 个控件的选项数值汇总，只读派生）\n` +
              `与「文书质控合规分」是两套独立口径，不互相换算。` +
              (scaleScore.uncounted > 0 ? `\n另有 ${scaleScore.uncounted} 个控件已填但候选项未配数值，未计入。` : '')
            }
          >
            <Activity size={12} />
            <span>{scaleScore.total} 分</span>
          </div>
        )}
      </div>

      {/* 中间: 缩放控制 */}
      <div className="flex items-center gap-1">
        <button
          className="p-0.5 text-chrome-ink-muted hover:text-chrome-ink-secondary rounded transition-colors disabled:opacity-30"
          disabled={scale <= 0.25}
          onClick={() => onScaleChange?.(Math.max(0.25, scale - 0.1))}
          title="缩小"
        >
          <Minus size={12} />
        </button>

        <input
          type="range"
          className="w-20 h-1 accent-primary-500 cursor-pointer"
          min={25} max={400} step={5}
          value={Math.round(scale * 100)}
          onChange={(e) => onScaleChange?.(Number(e.target.value) / 100)}
          title={`缩放: ${Math.round(scale * 100)}%`}
        />

        <button
          className="p-0.5 text-chrome-ink-muted hover:text-chrome-ink-secondary rounded transition-colors disabled:opacity-30"
          disabled={scale >= 4}
          onClick={() => onScaleChange?.(Math.min(4, scale + 0.1))}
          title="放大"
        >
          <Plus size={12} />
        </button>

        <span
          className="text-xs text-chrome-ink-tertiary w-10 text-center tabular-nums cursor-pointer hover:text-chrome-accent-ink"
          onClick={() => onScaleChange?.(1)}
          title="重置缩放"
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
              <span>{onlineCount} 人在线</span>
            </>
          ) : (
            <>
              <WifiOff size={12} className="text-chrome-ink-muted" />
              <span className="text-chrome-ink-muted">离线</span>
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
  const error = useEditorStore((s) => s.lastEngineError)
  const dismiss = useEditorStore((s) => s.dismissEngineError)
  if (!error) return null

  return (
    <button
      className="flex items-center gap-1 max-w-[280px] text-error-500
                 hover:text-error-500/80 transition-colors"
      onClick={dismiss}
      title={`${error.code}: ${error.message}（点击关闭）`}
      aria-label={`引擎错误：${error.message}（点击关闭）`}
    >
      <AlertTriangle size={12} className="flex-shrink-0" />
      <span className="truncate">{error.message}</span>
    </button>
  )
}

function SaveStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'saved':
      return (
        <span className="flex items-center gap-1 text-green-600">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          已保存
        </span>
      )
    case 'saving':
      return (
        <span className="flex items-center gap-1 text-chrome-accent-ink">
          <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse" />
          保存中...
        </span>
      )
    case 'unsaved':
      return (
        <span className="flex items-center gap-1 text-warning-500">
          <span className="w-1.5 h-1.5 rounded-full bg-warning-500" />
          未保存
        </span>
      )
    case 'error':
      return (
        <span className="flex items-center gap-1 text-error-500">
          <span className="w-1.5 h-1.5 rounded-full bg-error-500" />
          保存失败
        </span>
      )
    default:
      return null
  }
}
