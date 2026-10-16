// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// CompletenessDialog — 保存前的必填未填确认框 (契约 §12.11)
//
// **不是硬拦**。引擎只回答「缺哪些」(Editor.validateRequired), 拦不拦是宿主
// 的策略; 这里的策略是**列出 + 可跳转 + 允许继续保存**。硬拦会在医生要中途
// 存草稿时丢掉工作 —— 那是比"存了一份不全的病历"更糟的失败。
//
// 三个出口 (与设计 §2.2.5 的产品决策一一对应):
//   跳到第一处 / 仍然保存 / 取消
//
// 本组件不自己算缺项: missing 由调用方从 Editor.validateRequired() 取,
// 跳转也是调用方的事 (EditorPage.revealLocation 已经把"跳转"这一件事
// 收敛到一处, 质控面板与批注共用同一条路径)。
// ============================================================

import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, ChevronRight, X } from 'lucide-react'
import type { MissingField } from '@emrde/document-engine'
import { useTranslation } from '@/i18n/useTranslation'

interface CompletenessDialogProps {
  open: boolean
  /** 按阅读顺序排列的未填项 (来自 Editor.validateRequired) */
  missing: MissingField[]
  /** 跳转到某一条 (调用方负责定位与滚动) */
  onJump: (field: MissingField) => void
  /** 明确选择"仍然保存" — 调用方据此跳过闸门执行真正的保存 */
  onSaveAnyway: () => void
  onClose: () => void
}

export function CompletenessDialog({
  open, missing, onJump, onSaveAnyway, onClose,
}: CompletenessDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content
          className="fixed top-1/4 left-1/2 -translate-x-1/2 z-50
                     w-[420px] bg-chrome rounded-lg shadow-xl border border-line flex flex-col max-h-[70vh]"
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-line-subtle flex-shrink-0">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" />
              <Dialog.Title className="text-sm font-medium text-chrome-ink-strong">
                {t('completeness.title')}
              </Dialog.Title>
            </div>
            <button onClick={onClose} aria-label={t('common.close')}
                    className="p-1 rounded hover:bg-chrome-muted text-chrome-ink-muted hover:text-chrome-ink-secondary">
              <X size={14} />
            </button>
          </div>

          <div className="px-5 pt-4 flex-shrink-0">
            <p className="text-xs text-chrome-ink-secondary">
              {t('completeness.intro', { n: missing.length })}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-2 mt-1 min-h-0">
            {missing.map((m) => (
              <button
                key={m.nodeId}
                onClick={() => onJump(m)}
                title={t('completeness.listHint')}
                className="w-full text-left px-3 py-2 rounded-md transition-colors
                           flex items-center gap-2 hover:bg-chrome-subtle"
              >
                <span className="flex-1 min-w-0 text-xs text-chrome-ink-body truncate">
                  {m.name || t('completeness.unnamedField')}
                </span>
                <ChevronRight size={12} className="text-chrome-ink-disabled flex-shrink-0" />
              </button>
            ))}
          </div>

          <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t bg-chrome-subtle px-4 py-3">
            <button
              onClick={() => { if (missing.length > 0) onJump(missing[0]) }}
              className="px-3 py-1.5 text-xs rounded-md text-blue-600 hover:bg-chrome-muted"
            >
              {t('completeness.jumpToFirst')}
            </button>
            <div className="flex gap-2">
              <button onClick={onClose}
                      className="px-3 py-1.5 text-sm rounded-md text-chrome-ink-secondary hover:bg-chrome-muted">
                {t('common.cancel')}
              </button>
              <button onClick={onSaveAnyway}
                      className="px-4 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700">
                {t('completeness.saveAnyway')}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
