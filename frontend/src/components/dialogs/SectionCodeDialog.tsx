// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// SectionCodeDialog — 设置/清除节的 sectionCode (契约 §31.14)
//
// sectionCode 是 Section **唯一**可写的语义属性 (模型只有 id/children/sectionCode
// 三项)。它不参与排版, 只是节的外部标识: 结构化导出 (CDA) 与节级定位靠它引用
// 某一节。
//
// 空串 = 清除该字段 (真删键, 不是写空值) —— 由 Editor.setSectionCode 归一化。
// 本弹框只是单字段输入面, 不含任何节语义。
// ============================================================

import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Tag } from 'lucide-react'
import { useTranslation } from '@/i18n/useTranslation'

interface SectionCodeDialogProps {
  open: boolean
  onClose: () => void
  /** 当前节代码 (null/undefined 表示匿名节) */
  current?: string
  /** 确认回调; 传 undefined 表示清除 */
  onConfirm?: (code?: string) => void
}

export function SectionCodeDialog({ open, onClose, current, onConfirm }: SectionCodeDialogProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState(current ?? '')

  // 每次打开同步为当前值 —— 否则第二次打开会沿用上次的编辑残留
  useEffect(() => {
    if (open) setValue(current ?? '')
  }, [open, current])

  const confirm = () => {
    const trimmed = value.trim()
    onConfirm?.(trimmed === '' ? undefined : trimmed)
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content
          className="fixed top-1/4 left-1/2 -translate-x-1/2 z-50
                     w-[380px] bg-chrome rounded-lg shadow-xl border border-line"
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-line-subtle">
            <div className="flex items-center gap-2">
              <Tag size={16} className="text-chrome-ink-tertiary" />
              <Dialog.Title className="text-sm font-medium text-chrome-ink-strong">
                {t('dialog.title.sectionCode')}
              </Dialog.Title>
            </div>
            <button onClick={onClose} aria-label={t('common.close')}
                    className="p-1 rounded hover:bg-chrome-muted text-chrome-ink-muted hover:text-chrome-ink-secondary">
              <X size={14} />
            </button>
          </div>

          <div className="px-5 py-4 space-y-3">
            <div>
              <label className="text-xs font-medium text-chrome-ink-secondary block mb-1">
                {t('sectionCode.label')}
              </label>
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') confirm() }}
                placeholder={t('sectionCode.placeholder')}
                className="w-full text-sm px-3 py-2 border border-line rounded-md
                           focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                autoFocus
              />
            </div>
            <p className="text-xs text-chrome-ink-muted">{t('sectionCode.hint')}</p>
          </div>

          <div className="flex justify-end gap-2 px-5 py-3 border-t border-line-subtle">
            <button onClick={onClose}
                    className="px-3 py-1.5 text-xs rounded border border-line text-chrome-ink-secondary hover:bg-chrome-muted">
              {t('common.cancel')}
            </button>
            <button onClick={confirm}
                    className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700">
              {t('common.confirm')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
