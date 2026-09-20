// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// PasteSpecialDialog — 选择性粘贴对话框 (R44, v6.0)
//
// Ctrl+Shift+V 弹出: 保留源格式 / 匹配目标格式 / 纯文本
// 对齐 TASK-517, UIUX §5.4
// ============================================================

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Clipboard, FileText, AlignLeft, Type } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/useTranslation'

// ---- 类型 ----

export type PasteFormat = 'keep-source' | 'match-destination' | 'plain-text'

interface PasteSpecialDialogProps {
  open: boolean
  onClose: () => void
  onPaste?: (format: PasteFormat) => void
  /** 剪贴板预览文本 (前 100 字符) */
  previewText?: string
}

const FORMATS: { id: PasteFormat; labelKey: 'paste.keepSource' | 'paste.matchTarget' | 'paste.plainText'; descKey: 'paste.keepSourceDesc' | 'paste.matchTargetDesc' | 'paste.plainTextDesc'; icon: React.ReactNode }[] = [
  { id: 'keep-source',       labelKey: 'paste.keepSource',   descKey: 'paste.keepSourceDesc',   icon: <Clipboard size={20} /> },
  { id: 'match-destination', labelKey: 'paste.matchTarget',  descKey: 'paste.matchTargetDesc',  icon: <FileText size={20} /> },
  { id: 'plain-text',        labelKey: 'paste.plainText',    descKey: 'paste.plainTextDesc',    icon: <Type size={20} /> },
]

// ---- 组件 ----

export function PasteSpecialDialog({
  open, onClose, onPaste, previewText,
}: PasteSpecialDialogProps) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<PasteFormat>('match-destination')

  const handlePaste = () => {
    onPaste?.(selected)
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/20 z-50" />
        <Dialog.Content
          className="fixed top-1/3 left-1/2 -translate-x-1/2 z-50
                     w-[400px] bg-chrome rounded-lg shadow-xl border border-line"
        >
          {/* 头部 */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-line-subtle">
            <div className="flex items-center gap-2">
              <Clipboard size={16} className="text-chrome-ink-tertiary" />
              <Dialog.Title className="text-sm font-medium text-chrome-ink-strong">{t('paste.title')}</Dialog.Title>
            </div>
            <button onClick={onClose} aria-label={t('common.close')}
                    className="p-1 rounded hover:bg-chrome-muted text-chrome-ink-muted hover:text-chrome-ink-secondary">
              <X size={14} />
            </button>
          </div>

          {/* 格式选项 */}
          <div className="px-5 py-3 space-y-1">
            {FORMATS.map(f => (
              <button
                key={f.id}
                onClick={() => setSelected(f.id)}
                className={cn(
                  'w-full flex items-start gap-3 px-3 py-2.5 rounded-md text-left transition-colors border',
                  selected === f.id
                    ? 'border-blue-300 bg-blue-50 text-blue-800'
                    : 'border-transparent hover:bg-chrome-subtle text-chrome-ink-body',
                )}
              >
                <span className={cn(
                  'mt-0.5 flex-shrink-0',
                  selected === f.id ? 'text-blue-500' : 'text-chrome-ink-muted',
                )}>
                  {f.icon}
                </span>
                <div>
                  <div className="text-sm font-medium">{t(f.labelKey)}</div>
                  <div className="text-xs text-chrome-ink-tertiary mt-0.5">{t(f.descKey)}</div>
                </div>
              </button>
            ))}
          </div>

          {/* 预览 */}
          {previewText && (
            <div className="px-5 pb-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <AlignLeft size={12} className="text-chrome-ink-muted" />
                <span className="text-[10px] text-chrome-ink-muted uppercase tracking-wider">{t('paste.previewLabel')}</span>
              </div>
              <div className="text-xs text-chrome-ink-secondary bg-chrome-subtle border border-line-subtle rounded-md px-3 py-2 max-h-16 overflow-hidden">
                {previewText.length > 200 ? previewText.slice(0, 200) + '...' : previewText}
              </div>
            </div>
          )}

          {/* 底部 */}
          <div className="flex justify-between px-5 py-3 border-t border-line-subtle bg-chrome-subtle rounded-b-lg">
            <span className="text-[10px] text-chrome-ink-muted self-center">
              {t('paste.shortcut')}
            </span>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-chrome-ink-secondary hover:text-chrome-ink-strong"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handlePaste}
                className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                {t('paste.confirm')}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}