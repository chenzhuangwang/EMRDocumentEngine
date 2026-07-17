// ============================================================
// 编辑器整体布局
// ============================================================

import type { ReactNode } from 'react'
import { HeaderBar } from './HeaderBar'
import { Toolbar } from './Toolbar'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { PropertiesPanel } from './PropertiesPanel'
import { useEditorStore, useUIStore } from '@/store'

interface EditorLayoutProps {
  children: ReactNode
  documentTitle: string
  onTitleChange?: (title: string) => void
  onSave?: () => void
  onFormat?: (action: string, value?: unknown) => void
  onInsert?: (elementType: string) => void
}

export function EditorLayout({
  children,
  documentTitle,
  onTitleChange,
  onSave,
  onFormat,
  onInsert,
}: EditorLayoutProps) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const onlineUsers = useEditorStore((s) => s.onlineUsers)

  return (
    <div className="h-full flex flex-col">
      {/* 顶部导航栏 */}
      <HeaderBar
        documentTitle={documentTitle}
        onTitleChange={onTitleChange}
        onSave={onSave}
      />

      {/* 工具栏 */}
      <Toolbar
        onFormat={onFormat}
        onInsert={onInsert}
      />

      {/* 主体区域 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 侧边栏 */}
        {sidebarOpen && (
          <Sidebar
            templates={DEFAULT_TEMPLATES}
          />
        )}

        {/* 编辑器画布 */}
        <div className="flex-1 flex flex-col min-w-0">
          {children}
          <StatusBar
            pageIndex={1}
            pageCount={1}
            wordCount={0}
            onlineCount={onlineUsers}
          />
        </div>

        {/* 属性面板 */}
        <PropertiesPanel />
      </div>
    </div>
  )
}

// 默认模板数据（Mock）
const DEFAULT_TEMPLATES = [
  {
    name: '基本信息',
    items: [
      { id: 'tpl_blank', name: '空白文档', description: '从头开始创建文档' },
    ],
  },
  {
    name: '医疗文书',
    items: [
      { id: 'tpl_admission', name: '入院记录', description: '标准入院记录模板' },
      { id: 'tpl_progress', name: '病程记录', description: '日常病程记录模板' },
      { id: 'tpl_discharge', name: '出院小结', description: '出院小结模板' },
      { id: 'tpl_consultation', name: '会诊记录', description: '会诊记录模板' },
    ],
  },
  {
    name: '检查报告',
    items: [
      { id: 'tpl_lab', name: '检验报告', description: '实验室检验报告模板' },
      { id: 'tpl_imaging', name: '影像报告', description: '影像学检查报告模板' },
    ],
  },
]
