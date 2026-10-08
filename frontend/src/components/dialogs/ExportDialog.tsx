// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ExportDialog — 导出对话框 (Spec TASK-304)
// ============================================================

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, FileText, FileJson, FileCode, Download, Check, AlignLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/useTranslation'

interface ExportFormat {
  id: string
  labelKey: 'export.pdf' | 'export.word' | 'export.html' | 'export.txt' | 'export.json'
    | 'export.ofd' | 'export.cda' | 'export.elements'
  descKey: 'export.pdfDesc' | 'export.wordDesc' | 'export.htmlDesc' | 'export.txtDesc' | 'export.jsonDesc'
    | 'export.ofdDesc' | 'export.cdaDesc' | 'export.elementsDesc'
  icon: React.ReactNode
  available: boolean
}

const FORMATS: ExportFormat[] = [
  { id: 'pdf',  labelKey: 'export.pdf',   descKey: 'export.pdfDesc',   icon: <FileText size={22} />, available: false },
  { id: 'word', labelKey: 'export.word',  descKey: 'export.wordDesc',  icon: <FileText size={22} />, available: false },
  { id: 'ofd',  labelKey: 'export.ofd',   descKey: 'export.ofdDesc',   icon: <FileText size={22} />, available: true },
  { id: 'cda',  labelKey: 'export.cda',   descKey: 'export.cdaDesc',   icon: <FileCode size={22} />, available: true },
  { id: 'elements', labelKey: 'export.elements', descKey: 'export.elementsDesc', icon: <FileJson size={22} />, available: true },
  { id: 'html', labelKey: 'export.html',  descKey: 'export.htmlDesc',  icon: <FileCode size={22} />, available: true },
  { id: 'txt',  labelKey: 'export.txt',   descKey: 'export.txtDesc',   icon: <AlignLeft size={22} />, available: true },
  { id: 'json', labelKey: 'export.json',  descKey: 'export.jsonDesc',  icon: <FileJson size={22} />, available: true },
]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onExport: (format: string) => void
}

export function ExportDialog({ open, onOpenChange, onExport }: Props) {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = useState<string>('json')

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50 animate-in fade-in" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                                     w-[460px] bg-chrome rounded-lg shadow-xl z-50
                                     animate-in zoom-in-95 fade-in">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-line-subtle">
            <Dialog.Title className="text-base font-semibold text-chrome-ink-strong">
              {t('export.title')}
            </Dialog.Title>
            <Dialog.Close className="p-1 rounded-md hover:bg-chrome-muted text-chrome-ink-muted hover:text-chrome-ink-secondary"
                         aria-label={t('common.close')}>
              <X size={18} />
            </Dialog.Close>
          </div>

          {/* Format list — 格式变多后需要限高滚动, 否则小屏上按钮会被挤出视口 */}
          <div className="px-2 py-2 max-h-[60vh] overflow-y-auto">
            {FORMATS.map(fmt => (
              <button
                key={fmt.id}
                className={cn(
                  'w-full flex items-center gap-4 px-4 py-3.5 rounded-lg text-left transition-colors',
                  selectedId === fmt.id
                    ? 'bg-blue-50 border border-blue-200'
                    : 'hover:bg-chrome-subtle border border-transparent',
                  !fmt.available && 'opacity-60'
                )}
                onClick={() => fmt.available && setSelectedId(fmt.id)}
                disabled={!fmt.available}
              >
                <div className={cn(
                  'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
                  selectedId === fmt.id && fmt.available ? 'bg-blue-100 text-blue-600' : 'bg-chrome-muted text-chrome-ink-tertiary'
                )}>
                  {fmt.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-chrome-ink-strong">{t(fmt.labelKey)}</span>
                    {!fmt.available && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-chrome-strong text-chrome-ink-tertiary font-medium">
                        {t('export.comingSoon')}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-chrome-ink-muted mt-0.5">{t(fmt.descKey)}</div>
                </div>
                {selectedId === fmt.id && fmt.available && (
                  <Check size={18} className="text-blue-500 flex-shrink-0" />
                )}
              </button>
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-line-subtle">
            <Dialog.Close className="px-4 py-2 text-sm text-chrome-ink-secondary hover:bg-chrome-muted rounded-md transition-colors">
              {t('common.cancel')}
            </Dialog.Close>
            <button
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-blue-600
                         hover:bg-blue-700 rounded-md transition-colors"
              onClick={() => {
                onExport(selectedId)
                onOpenChange(false)
              }}
            >
              <Download size={15} />
              {t('file.export')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}