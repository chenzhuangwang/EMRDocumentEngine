// ============================================================
// BookmarkDialog — 书签与交叉引用对话框 (R38, v6.0)
//
// 功能: 插入书签 (命名+位置) / 插入交叉引用 (选择类型+目标)
// ============================================================

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Bookmark, Link, Hash } from 'lucide-react'
import { cn } from '@/lib/utils'

// ---- 类型 ----

export interface BookmarkTarget {
  id: string
  label: string
  type: 'heading' | 'bookmark' | 'footnote'
  pageHint?: number
}

interface BookmarkDialogProps {
  open: boolean
  onClose: () => void
  /** 可用书签/标题/脚注列表 */
  targets?: BookmarkTarget[]
  onInsertBookmark?: (name: string) => void
  onInsertCrossReference?: (targetId: string, refType: string, displayText: string) => void
}

type TabId = 'bookmark' | 'crossref'

// ---- 组件 ----

export function BookmarkDialog({
  open, onClose, targets = [],
  onInsertBookmark, onInsertCrossReference,
}: BookmarkDialogProps) {
  const [tab, setTab] = useState<TabId>('bookmark')
  const [name, setName] = useState('')
  const [filter, setFilter] = useState('')
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null)

  const filtered = filter
    ? targets.filter(t => t.label.includes(filter) || t.id.includes(filter))
    : targets

  const handleInsertBookmark = () => {
    if (!name.trim()) return
    onInsertBookmark?.(name.trim())
    setName('')
    onClose()
  }

  const handleInsertCrossRef = () => {
    if (!selectedTarget) return
    const target = targets.find(t => t.id === selectedTarget)
    if (!target) return
    onInsertCrossReference?.(target.id, target.type, target.label)
    setSelectedTarget(null)
    onClose()
  }

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'bookmark', label: '书签', icon: <Bookmark size={14} /> },
    { id: 'crossref', label: '交叉引用', icon: <Link size={14} /> },
  ]

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content
          className="fixed top-1/4 left-1/2 -translate-x-1/2 z-50
                     w-[420px] bg-white rounded-lg shadow-xl border border-gray-200"
        >
          {/* 头部 */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Bookmark size={16} className="text-gray-500" />
              <Dialog.Title className="text-sm font-medium text-gray-800">书签与引用</Dialog.Title>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          </div>

          {/* Tab */}
          <div className="flex border-b border-gray-100 px-5">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px',
                  tab === t.id
                    ? 'border-blue-500 text-blue-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700',
                )}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          {/* 内容 */}
          <div className="px-5 py-4">
            {tab === 'bookmark' ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">书签名称</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleInsertBookmark() }}
                    placeholder="例如: 实验室检查结果"
                    className="w-full text-sm px-3 py-2 border border-gray-200 rounded-md
                               focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                    autoFocus
                  />
                </div>
                <p className="text-xs text-gray-400">
                  书签用于标记文档中的重要位置，方便后续定位和交叉引用。
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* 搜索过滤 */}
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="搜索书签/标题/脚注..."
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded-md
                             focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                />

                {/* 目标列表 */}
                <div className="max-h-48 overflow-y-auto border border-gray-100 rounded-md divide-y divide-gray-50">
                  {filtered.length === 0 ? (
                    <div className="px-3 py-6 text-center text-xs text-gray-400">
                      暂无可用目标
                    </div>
                  ) : (
                    filtered.map(target => (
                      <button
                        key={target.id}
                        onClick={() => setSelectedTarget(target.id)}
                        className={cn(
                          'w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors',
                          selectedTarget === target.id
                            ? 'bg-blue-50 text-blue-700'
                            : 'hover:bg-gray-50 text-gray-700',
                        )}
                      >
                        {target.type === 'heading' && <Hash size={14} className="text-gray-400 flex-shrink-0" />}
                        {target.type === 'bookmark' && <Bookmark size={14} className="text-gray-400 flex-shrink-0" />}
                        {target.type === 'footnote' && <Link size={14} className="text-gray-400 flex-shrink-0" />}
                        <span className="truncate flex-1">{target.label}</span>
                        {target.pageHint && (
                          <span className="text-xs text-gray-400 flex-shrink-0">p.{target.pageHint}</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 底部 */}
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-lg">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800"
            >
              取消
            </button>
            {tab === 'bookmark' ? (
              <button
                onClick={handleInsertBookmark}
                disabled={!name.trim()}
                className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded-md
                           hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                插入书签
              </button>
            ) : (
              <button
                onClick={handleInsertCrossRef}
                disabled={!selectedTarget}
                className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded-md
                           hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                插入引用
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
