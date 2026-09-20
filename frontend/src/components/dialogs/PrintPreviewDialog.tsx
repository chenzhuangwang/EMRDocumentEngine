// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// PrintPreviewDialog — 打印预览对话框 (Spec TASK-304)
// ============================================================

import * as Dialog from '@radix-ui/react-dialog'
import { X, Printer, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/useTranslation'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  pageCount: number
  currentPage: number
  onPageChange: (page: number) => void
  onPrint: () => void
  children: React.ReactNode
}

export function PrintPreviewDialog({
  open, onOpenChange, pageCount, currentPage, onPageChange, onPrint, children,
}: Props) {
  const { t } = useTranslation()
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 animate-in fade-in" />
        <Dialog.Content className="fixed inset-4 bg-chrome rounded-lg shadow-xl z-50
                                     flex flex-col animate-in zoom-in-95 fade-in">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-line-subtle flex-shrink-0">
            <Dialog.Title className="text-base font-semibold text-chrome-ink-strong">
              {t('dialog.title.printPreview')}
            </Dialog.Title>
            <div className="flex items-center gap-3">
              {/* Page navigation */}
              <div className="flex items-center gap-1 text-sm text-chrome-ink-secondary">
                <button
                  className="p-1 rounded hover:bg-chrome-muted disabled:opacity-30"
                  disabled={currentPage <= 1}
                  onClick={() => onPageChange(currentPage - 1)}
                  aria-label={t('common.previous')}
                >
                  <ChevronLeft size={18} />
                </button>
                <span className="min-w-[80px] text-center tabular-nums">
                  {t('statusBar.pageOf', { current: currentPage, total: pageCount })}
                </span>
                <button
                  className="p-1 rounded hover:bg-chrome-muted disabled:opacity-30"
                  disabled={currentPage >= pageCount}
                  onClick={() => onPageChange(currentPage + 1)}
                  aria-label={t('common.next')}
                >
                  <ChevronRight size={18} />
                </button>
              </div>

              <button
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white
                           bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
                onClick={onPrint}
              >
                <Printer size={15} />
                {t('file.print')}
              </button>

              <Dialog.Close className="p-1.5 rounded-md hover:bg-chrome-muted text-chrome-ink-muted hover:text-chrome-ink-secondary"
                           aria-label={t('common.close')}>
                <X size={20} />
              </Dialog.Close>
            </div>
          </div>

          {/* Preview area */}
          <div className="flex-1 overflow-auto bg-chrome-desk flex items-start justify-center p-6">
            <div className={cn(
              'bg-white shadow-lg', // retheme-keep: A4 纸面本体, 打印必须 WYSIWYG —— 深色外壳下纸仍是白的
              // Simulate A4 aspect ratio within available space
            )}>
              {children}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-line-subtle text-xs text-chrome-ink-muted flex-shrink-0">
            <span>{t('preview.paperFormat')}</span>
            <span>{t('preview.pageCount', { n: pageCount })}</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
