// ============================================================
// 顶部导航栏
// ============================================================

import { useEffect, useRef, useState } from 'react'
import {
  Save,
  Undo2,
  Redo2,
  Users,
  ChevronDown,
  User,
  FileText,
  FolderOpen,
  PanelLeftClose,
  PanelLeft,
  Settings,
} from 'lucide-react'
import { useEditorStore, useUserStore, useUIStore } from '@/store'
import { useEditor, useEditorStoreSnapshot } from '@/components/editor/EditorProvider'
import { GiteeRepoLink } from '@/components/common/GiteeRepoLink'

interface HeaderBarProps {
  onSave?: () => void
  onImportDocument?: () => void
  onFormat?: (action: string) => void
  onDocumentProperties?: () => void
}

export function HeaderBar({ onSave, onImportDocument, onFormat, onDocumentProperties }: HeaderBarProps) {
  const saveStatus = useEditorStoreSnapshot((s) => s.saveStatus)
  const onlineUsers = useEditorStore((s) => s.onlineUsers)
  const user = useUserStore((s) => s.user)
  const isDirty = useEditorStoreSnapshot((s) => s.isDirty)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)

  return (
    <header className="h-header bg-white border-b border-gray-200 flex items-center justify-between px-4 flex-shrink-0 select-none">
      {/* 左侧：Logo + 标题 */}
      <div className="flex items-center gap-3">
        {/* Sidebar toggle */}
        <button
          className="toolbar-btn"
          onClick={toggleSidebar}
          title={sidebarOpen ? '关闭侧边栏' : '打开侧边栏'}
        >
          {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
        </button>

        <div className="flex items-center gap-2 text-primary-600">
          <FileText size={22} />
          <span className="font-semibold text-base hidden sm:inline">EMR Editor</span>
        </div>

        <div className="h-6 w-px bg-gray-200" />

        <DocumentTitleInput />

        {/* 保存状态 */}
        <SaveIndicator status={saveStatus} isDirty={isDirty} />
      </div>

      {/* 中间：快捷操作 */}
      <div className="flex items-center gap-1">
        <button
          className="toolbar-btn"
          onClick={() => onFormat?.('undo')}
          title="撤销 (Ctrl+Z)"
        >
          <Undo2 size={16} />
        </button>
        <button
          className="toolbar-btn"
          onClick={() => onFormat?.('redo')}
          title="重做 (Ctrl+Y)"
        >
          <Redo2 size={16} />
        </button>

        <div className="h-6 w-px bg-gray-200 mx-1" />

        <button
          className="toolbar-btn"
          onClick={onSave}
          title="保存 (Ctrl+S)"
        >
          <Save size={16} />
        </button>

        <button
          className="toolbar-btn"
          onClick={onImportDocument}
          title="导入文档/模板 (JSON/HTML/Markdown)"
        >
          <FolderOpen size={16} />
        </button>

        <button
          className="toolbar-btn"
          onClick={onDocumentProperties}
          title="文档属性"
        >
          <Settings size={16} />
        </button>
      </div>

      {/* 右侧：协作 + 用户 */}
      <div className="flex items-center gap-2">
        {/* 在线协作人数 */}
        {onlineUsers > 0 && (
          <div className="flex items-center gap-1 text-sm text-gray-500">
            <Users size={14} />
            <span>{onlineUsers}</span>
          </div>
        )}

        <GiteeRepoLink />

        {/* 用户头像/菜单 */}
        {user ? (
          <div className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer
                          hover:bg-gray-100 rounded-md px-2 py-1">
            <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-700
                            flex items-center justify-center text-xs font-medium">
              {user.realName?.charAt(0) || user.username.charAt(0)}
            </div>
            <span className="hidden sm:inline">{user.realName || user.username}</span>
            <ChevronDown size={14} />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <User size={16} />
            <span>未登录</span>
          </div>
        )}
      </div>
    </header>
  )
}

// ---- 文档标题输入 (P2-C) ----

/**
 * 文档标题内联输入 — engine `doc.title` 为唯一 canonical (契约 §7.7/§7.8)。
 *
 * 本地草稿 + 失焦/回车提交: 编辑过程只改草稿 (不产命令), blur/Enter 时经
 * Editor.setDocumentTitle (UpdateDocumentTitleCommand) 一次提交, 避免逐键污染
 * undo 栈 (与 P2-A DesignControlProperties 文本 onBlur 提交约定一致)。Esc 撤销
 * 草稿回 canonical。外部变更 (文档属性对话框/撤销/加载) 经 store.documentTitle
 * 投影回同步到草稿。
 */
function DocumentTitleInput() {
  const editor = useEditor()
  const canonicalTitle = useEditorStoreSnapshot((s) => s.documentTitle)
  const [draft, setDraft] = useState(canonicalTitle)
  // 草稿副本供 commit/Esc 同步读取, 避免闭包过期 (Esc 置回 canonical 后 blur 不误提交)
  const draftRef = useRef(draft)

  // canonical (外部: 对话框/撤销/加载) 变化 → 回同步草稿
  useEffect(() => {
    draftRef.current = canonicalTitle
    setDraft(canonicalTitle)
  }, [canonicalTitle])

  const commit = () => {
    const next = draftRef.current
    if (next !== canonicalTitle) editor?.setDocumentTitle(next)
  }

  return (
    <input
      className="text-sm font-medium text-gray-800 bg-transparent border-none outline-none
                 hover:bg-gray-50 rounded px-2 py-1 max-w-[240px] truncate
                 focus:bg-gray-50 focus:ring-1 focus:ring-primary-300"
      value={draft}
      onChange={(e) => { const v = e.target.value; draftRef.current = v; setDraft(v) }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          draftRef.current = canonicalTitle
          setDraft(canonicalTitle)
          e.currentTarget.blur()
        }
      }}
      placeholder="未命名文档"
      aria-label="文档标题"
    />
  )
}

// ---- 保存状态指示器 ----

function SaveIndicator({ status, isDirty }: { status: string; isDirty: boolean }) {
  if (!isDirty && status === 'saved') {
    return (
      <span className="text-xs text-gray-400 flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
        已保存
      </span>
    )
  }

  if (status === 'saving') {
    return (
      <span className="text-xs text-primary-500 flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse" />
        保存中...
      </span>
    )
  }

  if (status === 'unsaved') {
    return (
      <span className="text-xs text-warning-500 flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-warning-500" />
        未保存
      </span>
    )
  }

  if (status === 'error') {
    return (
      <span className="text-xs text-error-500 flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-error-500" />
        保存失败
      </span>
    )
  }

  return null
}
