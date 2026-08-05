// ============================================================
// 侧边栏
// ============================================================

import {
  FileText,
  Puzzle,
  Search,
  FolderOpen,
  FilePlus,
  ChevronRight,
  Folder,
  Type,
  Calendar,
  CheckSquare,
  Circle,
  Hash,
  Table,
  Image,
  ListTree,
  MessageSquare,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store'
import { OutlineNav, type OutlineItem } from '@/components/sidebar/OutlineNav'
import { CommentPanel } from '@/components/panels/CommentPanel'
import type { CommentThread } from '@/engine/document/DocumentModel'

interface SidebarProps {
  templates?: TemplateCategory[]
  onTemplateSelect?: (templateId: string) => void
  onNewTemplate?: () => void
  onElementClick?: (type: string) => void
  /** 大纲条目 (TASK-456) */
  outlineItems?: OutlineItem[]
  /** 当前激活的标题 ID */
  activeOutlineId?: string | null
  /** 点击大纲条目 */
  onOutlineClick?: (item: OutlineItem) => void
  /** 批注线程 (R32) */
  commentThreads?: CommentThread[]
  /** 批注回调 */
  onSelectCommentThread?: (threadId: string) => void
  onResolveCommentThread?: (threadId: string) => void
  onAddCommentReply?: (threadId: string, content: string) => void
}

interface TemplateCategory {
  name: string
  items: { id: string; name: string; description?: string }[]
}

export function Sidebar({
  templates = [], onTemplateSelect, onNewTemplate, onElementClick,
  outlineItems = [], activeOutlineId, onOutlineClick,
  commentThreads = [], onSelectCommentThread, onResolveCommentThread, onAddCommentReply,
}: SidebarProps) {
  const sidebarTab = useUIStore((s) => s.sidebarTab)
  const setSidebarTab = useUIStore((s) => s.setSidebarTab)

  return (
    <aside className="w-sidebar bg-white border-r border-gray-200 flex flex-col flex-shrink-0 select-none">
      {/* Tab 切换 */}
      <div className="flex border-b border-gray-200">
        <SidebarTab
          active={sidebarTab === 'templates'}
          onClick={() => setSidebarTab('templates')}
          icon={<FileText size={14} />}
          label="模板"
        />
        <SidebarTab
          active={sidebarTab === 'elements'}
          onClick={() => setSidebarTab('elements')}
          icon={<Puzzle size={14} />}
          label="元素"
        />
        <SidebarTab
          active={sidebarTab === 'pages'}
          onClick={() => setSidebarTab('pages')}
          icon={<ListTree size={14} />}
          label="大纲"
        />
        <SidebarTab
          active={sidebarTab === 'comments'}
          onClick={() => setSidebarTab('comments')}
          icon={<MessageSquare size={14} />}
          label="批注"
        />
      </div>

      {/* 搜索 */}
      <div className="p-3">
        <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 rounded-md border border-gray-200">
          <Search size={14} className="text-gray-400 flex-shrink-0" />
          <input
            className="bg-transparent border-none outline-none text-sm text-gray-700 w-full
                       placeholder:text-gray-400"
            placeholder={sidebarTab === 'templates' ? '搜索模板...' : '搜索元素...'}
          />
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin px-2 pb-4">
        {sidebarTab === 'templates' && (
          <TemplateList
            templates={templates}
            onTemplateSelect={onTemplateSelect}
            onNewTemplate={onNewTemplate}
          />
        )}
        {sidebarTab === 'elements' && <ElementPalette onClick={onElementClick} />}
        {sidebarTab === 'pages' && (
          <OutlineNav
            items={outlineItems}
            activeId={activeOutlineId}
            onItemClick={onOutlineClick}
          />
        )}
        {sidebarTab === 'comments' && (
          <CommentPanel
            threads={commentThreads}
            onSelectThread={onSelectCommentThread}
            onResolveThread={onResolveCommentThread}
            onAddReply={onAddCommentReply}
          />
        )}
      </div>
    </aside>
  )
}

// ---- Tab 按钮 ----

function SidebarTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      className={cn(
        'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors',
        active
          ? 'text-primary-700 border-b-2 border-primary-500 bg-primary-50/50'
          : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
}

// ---- 模板列表 ----

function TemplateList({
  templates,
  onTemplateSelect,
  onNewTemplate,
}: {
  templates: TemplateCategory[]
  onTemplateSelect?: (id: string) => void
  onNewTemplate?: () => void
}) {
  return (
    <div className="space-y-3">
      {/* 新建模板按钮 */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-primary-600
                   bg-primary-50 hover:bg-primary-100 rounded-md transition-colors"
        onClick={onNewTemplate}
      >
        <FilePlus size={14} />
        新建模板
      </button>

      {/* 模板分类 */}
      {templates.length > 0 ? (
        templates.map((category) => (
          <div key={category.name}>
            <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-gray-500 uppercase tracking-wider">
              <Folder size={12} />
              {category.name}
            </div>
            <div className="mt-1 space-y-0.5">
              {category.items.map((item) => (
                <button
                  key={item.id}
                  className="sidebar-item w-full text-left"
                  onClick={() => onTemplateSelect?.(item.id)}
                >
                  <FileText size={14} className="text-gray-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{item.name}</div>
                    {item.description && (
                      <div className="text-xs text-gray-400 truncate">{item.description}</div>
                    )}
                  </div>
                  <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="text-center py-8 text-sm text-gray-400">
          <FolderOpen size={32} className="mx-auto mb-2 text-gray-300" />
          暂无模板
        </div>
      )}
    </div>
  )
}

// ---- 元素面板 ----

function ElementPalette({ onClick }: { onClick?: (type: string) => void }) {
  const elements = [
    { type: 'control-input', label: '文本输入', icon: <Type size={16} /> },
    { type: 'control-select', label: '下拉选择', icon: <ChevronRight size={16} /> },
    { type: 'control-date', label: '日期选择', icon: <Calendar size={16} /> },
    { type: 'control-checkbox', label: '复选框', icon: <CheckSquare size={16} /> },
    { type: 'control-radio', label: '单选框', icon: <Circle size={16} /> },
    { type: 'control-number', label: '数字输入', icon: <Hash size={16} /> },
    { type: 'table', label: '表格', icon: <Table size={16} /> },
    { type: 'image', label: '图片', icon: <Image size={16} /> },
  ]

  return (
    <div className="space-y-0.5">
      {elements.map((el) => (
        <div
          key={el.type}
          className="sidebar-item cursor-grab active:cursor-grabbing"
          draggable
          onClick={() => onClick?.(el.type)}
        >
          <span className="text-gray-400">{el.icon}</span>
          <span className="text-sm">{el.label}</span>
        </div>
      ))}
    </div>
  )
}
