// ============================================================
// OutlineNav — 大纲导航面板 (TASK-456, v5.0)
//
// 按 outlineLevel 提取树形大纲, 支持点击跳转 + 当前位置高亮
// ============================================================

import { ListTree, Heading1, Heading2, Heading3, Heading4, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

// ---- 类型 ----

export interface OutlineItem {
  /** 段落 ID */
  id: string
  /** 段落路径 (ID 链路) */
  paragraphPath: string[]
  /** 标题级别 (1-6) */
  level: number
  /** 标题文本 (纯文本) */
  text: string
  /** 所在页面索引 (供跳转, -1 表示未知) */
  pageIndex: number
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
  1: <Heading1 size={14} className="text-primary-600" />,
  2: <Heading2 size={14} className="text-primary-500" />,
  3: <Heading3 size={14} className="text-gray-500" />,
  4: <Heading4 size={14} className="text-gray-400" />,
  5: <FileText size={14} className="text-gray-400" />,
  6: <FileText size={14} className="text-gray-300" />,
}

// ---- 组件 ----

export function OutlineNav({
  items,
  activeId,
  onItemClick,
  emptyMessage = '暂无标题 — 使用 Heading 1-6 样式创建大纲',
}: OutlineNavProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <ListTree size={32} className="text-gray-300 mb-3" />
        <p className="text-sm text-gray-400 leading-relaxed">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <nav className="py-1" aria-label="文档大纲">
      {items.map((item) => (
        <button
          key={item.id}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
            'hover:bg-gray-50 rounded-sm',
            activeId === item.id
              ? 'bg-primary-50 text-primary-700 font-medium border-l-2 border-primary-500'
              : 'text-gray-600 border-l-2 border-transparent',
          )}
          style={{ paddingLeft: `${8 + (item.level - 1) * 16}px` }}
          onClick={() => onItemClick?.(item)}
          title={`Heading ${item.level}: ${item.text}`}
        >
          <span className="flex-shrink-0">
            {LEVEL_ICONS[item.level] ?? <FileText size={14} className="text-gray-400" />}
          </span>
          <span className="truncate flex-1 min-w-0">{item.text}</span>
          {item.pageIndex >= 0 && (
            <span className="text-xs text-gray-400 flex-shrink-0 tabular-nums">
              p{item.pageIndex + 1}
            </span>
          )}
        </button>
      ))}
    </nav>
  )
}
