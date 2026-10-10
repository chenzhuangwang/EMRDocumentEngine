// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// HeaderFooterToolbar — 页眉页脚上下文工具栏 (TASK-470-471)
//
// 在页眉/页脚编辑模式下显示, 提供:
// - 首页不同 / 奇偶页不同 切换
// - 插入页码 / 日期
// - 关闭页眉页脚编辑
//
// 契约 §7.9: 两个开关决定逐页生效的页眉/页脚变体 (首页 / 偶数页),
// 经 onConfigChange → EditorPage 'headerFooterConfig' → SetHeaderFooterConfigCommand。
// ============================================================

import {
  Hash, Calendar, X, CheckSquare, Square,
} from 'lucide-react'
import { cn } from '@/lib/utils'
// canonical 类型唯一来源 = 文档域 (契约 §7.3); 本组件不得再定义一份
import type { HeaderFooterConfig } from '@emrde/document-engine'
import type { HeaderFooterVariant } from '@emrde/document-engine'
import { useTranslation } from '@/i18n/useTranslation'
import type { LocaleMessages } from '@emrde/document-engine'

interface HeaderFooterToolbarProps {
  /** 当前编辑的是 header 还是 footer */
  section: 'header' | 'footer'
  /** 当前配置 */
  config: HeaderFooterConfig
  /** 配置变更 */
  onConfigChange: (patch: Partial<HeaderFooterConfig>) => void
  /** 插入页码域 */
  onInsertPageNumber: () => void
  /** 插入日期域 */
  onInsertDate: () => void
  /** 关闭编辑模式 */
  onClose: () => void
  /** 当前编辑目标页页码 (1-based) + 生效变体 — 仅用于区域标签 */
  pageNumber?: number
  variant?: HeaderFooterVariant
}

/** 变体 → i18n 标签键 (default 变体无前缀标签) */
const VARIANT_LABEL_KEYS: Record<HeaderFooterVariant, keyof LocaleMessages | null> = {
  default: null,
  first: 'editor.hf.variantFirst',
  even: 'editor.hf.variantEven',
}

export function HeaderFooterToolbar({
  section,
  config,
  onConfigChange,
  onInsertPageNumber,
  onInsertDate,
  onClose,
  pageNumber,
  variant,
}: HeaderFooterToolbarProps) {
  const { t } = useTranslation()
  const label = section === 'header' ? t('editor.hf.header') : t('editor.hf.footer')
  const variantKey = variant ? VARIANT_LABEL_KEYS[variant] : null
  const variantLabel = variantKey ? t(variantKey) : ''
  const scope = variantLabel + label + (pageNumber ? t('editor.hf.scopePage', { n: pageNumber }) : '')
  const closeTitle = section === 'header' ? t('editor.hf.closeHeaderTitle') : t('editor.hf.closeFooterTitle')

  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-chrome-subtle border-b border-line">
      {/* 首页不同 */}
      <button
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 text-xs rounded-md h-7 transition-colors',
          config.differentFirstPage
            ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
            : 'text-chrome-ink-secondary hover:bg-chrome-muted',
        )}
        title={t('editor.hf.differentFirstPage')}
        onClick={() => onConfigChange({ differentFirstPage: !config.differentFirstPage })}
      >
        {config.differentFirstPage ? <CheckSquare size={14} /> : <Square size={14} />}
        <span className="hidden sm:inline">{t('editor.hf.differentFirstPage')}</span>
      </button>

      {/* 奇偶页不同 */}
      <button
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 text-xs rounded-md h-7 transition-colors',
          config.differentOddEven
            ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
            : 'text-chrome-ink-secondary hover:bg-chrome-muted',
        )}
        title={t('editor.hf.differentOddEven')}
        onClick={() => onConfigChange({ differentOddEven: !config.differentOddEven })}
      >
        {config.differentOddEven ? <CheckSquare size={14} /> : <Square size={14} />}
        <span className="hidden sm:inline">{t('editor.hf.differentOddEven')}</span>
      </button>

      {/* 分隔线 */}
      <div className="w-px h-5 bg-chrome-strong mx-1" />

      {/* 插入页码 */}
      <button
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-chrome-ink-secondary hover:bg-chrome-muted rounded-md h-7 transition-colors"
        title={t('editor.hf.insertPageNumber')}
        onClick={onInsertPageNumber}
      >
        <Hash size={14} />
        <span className="hidden sm:inline">{t('editor.field.pageNumber')}</span>
      </button>

      {/* 插入日期 */}
      <button
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-chrome-ink-secondary hover:bg-chrome-muted rounded-md h-7 transition-colors"
        title={t('editor.hf.insertDate')}
        onClick={onInsertDate}
      >
        <Calendar size={14} />
        <span className="hidden sm:inline">{t('editor.hf.date')}</span>
      </button>

      {/* 分隔线 */}
      <div className="w-px h-5 bg-chrome-strong mx-1" />

      {/* 区域标签 */}
      <span className="text-xs text-chrome-ink-muted px-1">{scope}</span>

      <div className="flex-1" />

      {/* 关闭 */}
      <button
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-chrome-ink-tertiary hover:bg-chrome-strong rounded-md h-7 transition-colors"
        title={closeTitle}
        onClick={onClose}
      >
        <X size={14} />
        <span className="hidden sm:inline">{t('common.close')}</span>
      </button>
    </div>
  )
}
