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
import type { HeaderFooterConfig } from '@/engine'
import type { HeaderFooterVariant } from '@/engine'

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

const VARIANT_LABEL: Record<HeaderFooterVariant, string> = {
  default: '', first: '首页', even: '偶数页',
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
  const label = section === 'header' ? '页眉' : '页脚'
  const variantLabel = variant ? VARIANT_LABEL[variant] : ''
  const scope = `${variantLabel}${label}${pageNumber ? ` · 第 ${pageNumber} 页` : ''}`

  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-gray-50 border-b border-gray-200">
      {/* 首页不同 */}
      <button
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 text-xs rounded-md h-7 transition-colors',
          config.differentFirstPage
            ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
            : 'text-gray-600 hover:bg-gray-100',
        )}
        title="首页不同"
        onClick={() => onConfigChange({ differentFirstPage: !config.differentFirstPage })}
      >
        {config.differentFirstPage ? <CheckSquare size={14} /> : <Square size={14} />}
        <span className="hidden sm:inline">首页不同</span>
      </button>

      {/* 奇偶页不同 */}
      <button
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 text-xs rounded-md h-7 transition-colors',
          config.differentOddEven
            ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
            : 'text-gray-600 hover:bg-gray-100',
        )}
        title="奇偶页不同"
        onClick={() => onConfigChange({ differentOddEven: !config.differentOddEven })}
      >
        {config.differentOddEven ? <CheckSquare size={14} /> : <Square size={14} />}
        <span className="hidden sm:inline">奇偶页不同</span>
      </button>

      {/* 分隔线 */}
      <div className="w-px h-5 bg-gray-200 mx-1" />

      {/* 插入页码 */}
      <button
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded-md h-7 transition-colors"
        title="插入页码"
        onClick={onInsertPageNumber}
      >
        <Hash size={14} />
        <span className="hidden sm:inline">页码</span>
      </button>

      {/* 插入日期 */}
      <button
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded-md h-7 transition-colors"
        title="插入日期"
        onClick={onInsertDate}
      >
        <Calendar size={14} />
        <span className="hidden sm:inline">日期</span>
      </button>

      {/* 分隔线 */}
      <div className="w-px h-5 bg-gray-200 mx-1" />

      {/* 区域标签 */}
      <span className="text-xs text-gray-400 px-1">{scope}</span>

      <div className="flex-1" />

      {/* 关闭 */}
      <button
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500 hover:bg-gray-200 rounded-md h-7 transition-colors"
        title={`关闭${label}编辑`}
        onClick={onClose}
      >
        <X size={14} />
        <span className="hidden sm:inline">关闭</span>
      </button>
    </div>
  )
}
