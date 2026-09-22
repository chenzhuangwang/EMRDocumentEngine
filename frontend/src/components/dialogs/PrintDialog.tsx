// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// PrintDialog — 打印对话框 (TASK-468, v5.0)
//
// 功能: 页码范围 (本应用按页切片, 真实生效) / 续打断点 (来自打印历史)
//
// ⚠ 打印机 / 份数 / 单双面 三项**由系统打印窗口生效**: JS 无法操控原生打印
// 对话框, 这里的控件只是把用户的选择带进打印历史。界面上有如实说明。
// ============================================================

import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Printer, FileText, Copy, ChevronDown, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PrintRecord } from '@/services/PrintHistoryService'
import { useTranslation } from '@/i18n/useTranslation'

// ---- 类型 ----

export interface PrintSettings {
  printer: string
  pageRange: { start: number; end: number }
  copies: number
  duplex: boolean
  resumeFromPage: number | null  // 续打断点页码 (null=从头打印)
}

interface PrintDialogProps {
  open: boolean
  onClose: () => void
  totalPages: number
  initialSettings?: Partial<PrintSettings>
  onPrint?: (settings: PrintSettings) => void
  /** 打开应用内打印预览 (可选; 不传则不显示预览入口) */
  onPreview?: () => void
  /** 该文档的历史打印记录 (最近在前) — 来自 PrintHistoryService */
  history?: PrintRecord[]
}

// ---- 组件 ----

export function PrintDialog({
  open, onClose, totalPages,
  initialSettings, onPrint, onPreview, history,
}: PrintDialogProps) {
  const { t } = useTranslation()
  const printerFallback = t('print.printerDefault')
  const [settings, setSettings] = useState<PrintSettings>({
    printer: printerFallback,
    pageRange: { start: 1, end: totalPages },
    copies: 1,
    duplex: false,
    resumeFromPage: null,
    ...initialSettings,
  })

  const update = (patch: Partial<PrintSettings>) => setSettings(v => ({ ...v, ...patch }))

  /**
   * 每次**打开**时按 initialSettings 重新起算。
   *
   * 对话框是常驻挂载的 (Radix 只切 `open`), `useState` 的初值只在首挂载生效 ——
   * 不重算的话, 续打断点/页码范围会一直带着上一次打开时的值。
   */
  useEffect(() => {
    if (!open) return
    const resume = initialSettings?.resumeFromPage ?? null
    setSettings({
      printer: printerFallback,
      pageRange: { start: resume ?? 1, end: totalPages },
      copies: 1,
      duplex: false,
      ...initialSettings,
      resumeFromPage: resume,
    })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // 页码范围预设
  const pagePresets: { labelKey: 'print.range.all' | 'print.range.current'; range: { start: number; end: number } }[] = [
    { labelKey: 'print.range.all',     range: { start: 1, end: totalPages } },
    { labelKey: 'print.range.current', range: { start: 1, end: 1 } },
  ]

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50
                     flex max-h-[85vh] w-[440px] flex-col overflow-hidden
                     bg-chrome rounded-lg shadow-xl border border-line"
        >
          {/* 标题栏 */}
          <div className="flex flex-shrink-0 items-center justify-between px-4 py-3 border-b border-line-subtle">
            <Dialog.Title className="text-sm font-semibold text-chrome-ink-strong flex items-center gap-2">
              <Printer size={16} className="text-chrome-ink-muted" />
              {t('file.print')}
            </Dialog.Title>
            <button className="text-chrome-ink-muted hover:text-chrome-ink-secondary" onClick={onClose} aria-label={t('common.close')}>
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
            {/* 打印机 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-chrome-ink-tertiary">{t('print.printer')}</label>
              <div className="flex items-center gap-2 px-3 py-2 border border-line rounded-md bg-chrome-subtle">
                <Printer size={14} className="text-chrome-ink-muted" />
                <span className="text-sm text-chrome-ink-body flex-1">{settings.printer}</span>
                <ChevronDown size={12} className="text-chrome-ink-muted" />
              </div>
            </div>

            {/* 页码范围 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-chrome-ink-tertiary">{t('print.range.label')}</label>
              <div className="flex gap-2">
                {pagePresets.map(p => (
                  <button
                    key={p.labelKey}
                    className={cn(
                      'px-3 py-1.5 text-xs rounded-md border transition-colors',
                      settings.pageRange.start === p.range.start &&
                      settings.pageRange.end === p.range.end
                        ? 'border-primary-400 bg-chrome-accent text-chrome-accent-ink'
                        : 'border-line hover:bg-chrome-subtle text-chrome-ink-secondary',
                    )}
                    onClick={() => update({ pageRange: p.range })}
                  >
                    {t(p.labelKey)}
                  </button>
                ))}
                <button
                  className={cn(
                    'px-3 py-1.5 text-xs rounded-md border transition-colors',
                    !pagePresets.some(p =>
                      p.range.start === settings.pageRange.start &&
                      p.range.end === settings.pageRange.end)
                      ? 'border-primary-400 bg-chrome-accent text-chrome-accent-ink'
                      : 'border-line hover:bg-chrome-subtle text-chrome-ink-secondary',
                  )}
                >
                  {t('print.range.custom')}
                </button>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="number"
                  className="w-16 px-2 py-1 text-xs border border-line rounded-md
                             focus:outline-none focus:border-primary-400"
                  min={1} max={totalPages}
                  value={settings.pageRange.start}
                  onChange={(e) => update({
                    pageRange: { ...settings.pageRange, start: Number(e.target.value) || 1 },
                  })}
                />
                <span className="text-xs text-chrome-ink-muted">{t('print.range.to')}</span>
                <input
                  type="number"
                  className="w-16 px-2 py-1 text-xs border border-line rounded-md
                             focus:outline-none focus:border-primary-400"
                  min={1} max={totalPages}
                  value={settings.pageRange.end}
                  onChange={(e) => update({
                    pageRange: { ...settings.pageRange, end: Number(e.target.value) || totalPages },
                  })}
                />
                <span className="text-xs text-chrome-ink-muted">{t('print.range.totalLabel', { n: totalPages })}</span>
              </div>
            </div>

            {/* 份数 + 双面 */}
            <div className="flex items-center gap-6">
              <div className="space-y-1.5 flex-1">
                <label className="text-xs font-medium text-chrome-ink-tertiary">{t('print.copies')}</label>
                <div className="flex items-center gap-1">
                  <Copy size={14} className="text-chrome-ink-muted" />
                  <input
                    type="number"
                    className="w-16 px-2 py-1.5 text-sm border border-line rounded-md
                               focus:outline-none focus:border-primary-400"
                    min={1} max={99}
                    value={settings.copies}
                    onChange={(e) => update({ copies: Number(e.target.value) || 1 })}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-chrome-ink-tertiary">{t('print.duplex.label')}</label>
                <button
                  className={cn(
                    'px-3 py-1.5 text-xs rounded-md border transition-colors',
                    settings.duplex
                      ? 'border-primary-400 bg-chrome-accent text-chrome-accent-ink'
                      : 'border-line hover:bg-chrome-subtle text-chrome-ink-secondary',
                  )}
                  onClick={() => update({ duplex: !settings.duplex })}
                >
                  {settings.duplex ? t('print.duplex.duplex') : t('print.duplex.simplex')}
                </button>
              </div>
            </div>

            {/* 续打断点 */}
            {settings.resumeFromPage !== null && (
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md">
                <FileText size={14} className="text-amber-500" />
                <span className="text-xs text-amber-700">
                  {t('print.resume', { n: settings.resumeFromPage })}
                </span>
                <button
                  className="ml-auto text-xs text-amber-600 hover:text-amber-800"
                  onClick={() => update({
                    resumeFromPage: null,
                    pageRange: { ...settings.pageRange, start: 1 },
                  })}
                >
                  {t('print.cancelResume')}
                </button>
              </div>
            )}

            {/* 页数信息 */}
            <div className="text-xs text-chrome-ink-muted text-center">
              {t('print.summary', {
                total: totalPages,
                printing: settings.pageRange.end - settings.pageRange.start + 1,
                copies: settings.copies,
                sides: settings.duplex ? t('print.duplex.duplexShort') : t('print.duplex.simplexShort'),
              })}
            </div>

            {/*
              如实说明分工: 打印机 / 份数 / 单双面 由**系统打印窗口**生效,
              应用侧改不了 (JS 无法操控原生打印对话框)。页码范围是真的由本应用
              切片生效的。不写这句, 用户会以为在这里选了份数就生效了。
            */}
            <div className="text-[11px] leading-relaxed text-chrome-ink-muted">
              {t('print.systemNote')}
            </div>

            {/* 最近打印 (PrintHistoryService) */}
            {history && history.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-chrome-ink-tertiary flex items-center gap-1">
                  <History size={12} />
                  {t('print.recent')}
                </label>
                <div className="space-y-1">
                  {history.slice(0, 3).map(h => (
                    <div
                      key={h.id}
                      className="flex items-center gap-2 px-2 py-1 rounded border border-line-subtle
                                 bg-chrome-subtle text-[11px] text-chrome-ink-secondary"
                    >
                      <span className="tabular-nums">
                        {t('print.range.fromTo', { from: h.pageRange.start, to: h.pageRange.end })}
                      </span>
                      <span className="text-chrome-ink-muted">
                        {t('print.historySubline', { copies: h.copies, sides: h.duplex ? t('print.duplex.duplexShort') : t('print.duplex.simplexShort') })}
                      </span>
                      <span className="ml-auto text-chrome-ink-muted tabular-nums">
                        {formatPrintedAt(h.printedAt, t)}
                      </span>
                      {!h.completed && (
                        <span className="text-warning-500">{t('print.unfinished')}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 底部按钮 */}
          <div className="flex flex-shrink-0 items-center justify-end gap-2 px-4 py-3 border-t border-line-subtle bg-chrome-subtle rounded-b-lg">
            <button
              className="px-4 py-1.5 text-xs text-chrome-ink-secondary hover:bg-chrome-strong rounded-md transition-colors"
              onClick={onClose}
            >
              {t('common.cancel')}
            </button>
            {/* 预览: 应用内看排版再决定打不打 (浏览器打印对话框只在 w.print() 后才出预览) */}
            {onPreview && (
              <button
                className="px-4 py-1.5 text-xs text-chrome-ink-body border border-line-strong hover:bg-chrome-muted
                           rounded-md transition-colors"
                onClick={onPreview}
              >
                {t('common.preview')}
              </button>
            )}
            <button
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white
                         bg-primary-600 hover:bg-primary-700 rounded-md transition-colors"
              onClick={() => { onPrint?.(settings); onClose() }}
            >
              <Printer size={12} />
              {t('file.print')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** 打印记录的时间戳 → 「今天 14:20」/「3 天前」这类一眼能读的形式 */
function formatPrintedAt(ts: number, t: (key: any, p?: any) => string): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (sameDay) return hm
  const days = Math.floor((now.getTime() - ts) / 86_400_000)
  if (days < 7) return t('print.relative.daysAgo', { n: days })
  return `${d.getMonth() + 1}/${d.getDate()}`
}