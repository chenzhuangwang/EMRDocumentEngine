// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// OutlineNav — 大纲导航面板 (TASK-456, v5.0)
//
// 按 outlineLevel 提取树形大纲, 支持点击跳转 + 当前位置高亮
// ============================================================

import { ListTree, Heading1, Heading2, Heading3, Heading4, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/useTranslation'

// ---- 类型 ----

export interface OutlineItem {
  /** 段落 ID (节占位条目为 Section id) */
  id: string
  /** 段落路径 (ID 链路); 节占位条目为 [docId, sectionId] */
  paragraphPath: string[]
  /** 标题级别 (1-6); 节占位条目固定 1 */
  level: number
  /** 标题文本 (纯文本) */
  text: string
  /** 所在页面索引 (供跳转, -1 表示未知) */
  pageIndex: number
  /**
   * 条目种类 (契约 §31.10)。
   *
   *   'heading' (缺省) — 一个 outlineLevel > 0 的段落
   *   'section'        — 一个**没有标题段**的节 (含空节)
   *
   * 为什么需要: 大纲此前只认 outlineLevel > 0 的段落, 于是"既往史节存在但为空"
   * 在大纲里完全不可见 —— 用户看不出这一节还在。节占位条目把"节存在"这件事
   * 显示出来, 但**不冒充标题**: 图标与样式都不同, 点击跳到节内首段 (空节跳节容器)。
   */
  kind?: 'heading' | 'section'
  /** 节代码 (kind === 'section' 时的显示名, 缺失即匿名节) */
  sectionCode?: string
}

interface OutlineNavProps {
  items: OutlineItem[]
  /** 当前激活的标题 ID (光标附近) */
  activeId?: string | null
  /** 点击标题时回调 → 上层负责跳转光标/滚动 */
  onItemClick?: (item: OutlineItem) => void
  /** 标题为空时的提示 */
  emptyMessage?: string
}

// ---- 图标映射 ----

const LEVEL_ICONS: Record<number, React.ReactNode> = {
  1: <Heading1 size={14} className="text-chrome-accent-ink" />,
  2: <Heading2 size={14} className="text-chrome-accent-ink" />,
  3: <Heading3 size={14} className="text-chrome-ink-tertiary" />,
  4: <Heading4 size={14} className="text-chrome-ink-muted" />,
  5: <FileText size={14} className="text-chrome-ink-muted" />,
  6: <FileText size={14} className="text-chrome-ink-disabled" />,
}

// ---- 组件 ----

export function OutlineNav({
  items,
  activeId,
  onItemClick,
  emptyMessage,
}: OutlineNavProps) {
  const { t } = useTranslation()
  const empty = emptyMessage ?? t('outline.empty')
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <ListTree size={32} className="text-chrome-ink-disabled mb-3" />
        <p className="text-sm text-chrome-ink-muted leading-relaxed">{empty}</p>
      </div>
    )
  }

  return (
    <nav className="py-1" aria-label={t('outline.title')}>
      {items.map((item) => (
        <button
          key={item.id}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
            'hover:bg-chrome-subtle rounded-sm',
            activeId === item.id
              ? 'bg-chrome-accent text-chrome-accent-ink font-medium border-l-2 border-primary-500'
              : 'text-chrome-ink-secondary border-l-2 border-transparent',
          )}
          style={{ paddingLeft: `${8 + (item.level - 1) * 16}px` }}
          onClick={() => onItemClick?.(item)}
          title={item.kind === 'section'
            ? t('outline.sectionTitle', { text: item.text })
            : t('outline.headingTitle', { level: item.level, text: item.text })}
        >
          <span className="flex-shrink-0">
            {item.kind === 'section'
              ? <ListTree size={14} className="text-chrome-ink-muted" />
              : (LEVEL_ICONS[item.level] ?? <FileText size={14} className="text-chrome-ink-muted" />)}
          </span>
          <span className={cn('truncate flex-1 min-w-0', item.kind === 'section' && 'italic')}>
            {item.text}
          </span>
          {item.pageIndex >= 0 && (
            <span className="text-xs text-chrome-ink-muted flex-shrink-0 tabular-nums">
              p{item.pageIndex + 1}
            </span>
          )}
        </button>
      ))}
    </nav>
  )
}
