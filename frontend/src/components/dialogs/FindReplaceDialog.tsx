// ============================================================
// FindReplaceDialog — 查找替换对话框 (TASK-452, v5.0)
//
// Ctrl+F: 查找模式 | Ctrl+H: 替换模式
// 功能: 实时搜索、结果列表、替换/全部替换、大小写/全词匹配选项
// ============================================================

import { useState, useCallback, useRef, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  X, Search, ArrowDown, ArrowUp, Replace, ListFilter,
  CaseSensitive, WholeWord, Regex,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ---- 类型 ----

export interface FindResult {
  index: number
  text: string
  context: string
}

interface FindReplaceDialogProps {
  open: boolean
  onClose: () => void
  /** 初始模式: 'find' 或 'replace' */
  mode?: 'find' | 'replace'
  /** 当前匹配总数 */
  matchCount?: number
  /** 当前匹配索引 */
  currentMatchIndex?: number
  /** 查找回调 */
  onFind?: (query: string, options: FindOptions) => void
  /** 查找下一个 */
  onFindNext?: () => void
  /** 查找上一个 */
  onFindPrevious?: () => void
  /** 替换当前 */
  onReplace?: (replacement: string) => void
  /** 全部替换 */
  onReplaceAll?: (replacement: string) => void
}

export interface FindOptions {
  caseSensitive: boolean
  wholeWord: boolean
  useRegex: boolean
}

// ---- 组件 ----

export function FindReplaceDialog({
  open,
  onClose,
  mode: initialMode = 'find',
  matchCount = 0,
  currentMatchIndex = -1,
  onFind,
  onFindNext,
  onFindPrevious,
  onReplace,
  onReplaceAll,
}: FindReplaceDialogProps) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [showReplace, setShowReplace] = useState(initialMode === 'replace')
  const [options, setOptions] = useState<FindOptions>({
    caseSensitive: true,
    wholeWord: false,
    useRegex: false,
  })

  const inputRef = useRef<HTMLInputElement>(null)

  // 自动聚焦 + 自动查找
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const handleFind = useCallback(() => {
    if (query) onFind?.(query, options)
  }, [query, options, onFind])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (query) onFind?.(query, options)
    }
    if (e.key === 'Escape') onClose()
  }, [query, options, onFind, onClose])

  // 切换选项时即时搜索
  const toggleOption = useCallback((key: keyof FindOptions) => {
    setOptions(prev => {
      const next = { ...prev, [key]: !prev[key] }
      if (query) setTimeout(() => onFind?.(query, next), 0)
      return next
    })
  }, [query, onFind])

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content
          className="fixed top-1/4 left-1/2 -translate-x-1/2 z-50
                     w-[420px] bg-white rounded-lg shadow-xl border border-gray-200"
          onKeyDown={handleKeyDown}
        >
          {/* 标题栏 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <Dialog.Title className="text-sm font-semibold text-gray-800">
              {showReplace ? '查找和替换' : '查找'}
            </Dialog.Title>
            <button
              className="text-gray-400 hover:text-gray-600 transition-colors"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-4 space-y-3">
            {/* 查找输入 */}
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 border border-gray-200 rounded-md focus-within:border-primary-400 focus-within:ring-1 focus-within:ring-primary-200">
                <Search size={14} className="text-gray-400 flex-shrink-0" />
                <input
                  ref={inputRef}
                  className="flex-1 bg-transparent border-none outline-none text-sm text-gray-700 placeholder:text-gray-400"
                  placeholder="输入查找内容..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              {/* 结果计数 */}
              {matchCount > 0 && (
                <span className="text-xs text-gray-500 flex-shrink-0">
                  {currentMatchIndex >= 0 ? `${currentMatchIndex + 1}/` : ''}{matchCount}
                </span>
              )}
            </div>

            {/* 替换输入 */}
            {showReplace && (
              <div className="flex items-center gap-2 px-3 py-1.5 border border-gray-200 rounded-md focus-within:border-primary-400 focus-within:ring-1 focus-within:ring-primary-200">
                <Replace size={14} className="text-gray-400 flex-shrink-0" />
                <input
                  className="flex-1 bg-transparent border-none outline-none text-sm text-gray-700 placeholder:text-gray-400"
                  placeholder="替换为..."
                  value={replacement}
                  onChange={(e) => setReplacement(e.target.value)}
                />
              </div>
            )}

            {/* 选项行 */}
            <div className="flex items-center gap-1">
              <OptionToggle
                active={options.caseSensitive}
                onClick={() => toggleOption('caseSensitive')}
                icon={<CaseSensitive size={14} />}
                label="Aa"
              />
              <OptionToggle
                active={options.wholeWord}
                onClick={() => toggleOption('wholeWord')}
                icon={<WholeWord size={14} />}
                label="全词"
              />
              <OptionToggle
                active={options.useRegex}
                onClick={() => toggleOption('useRegex')}
                icon={<Regex size={14} />}
                label=".*"
              />

              <div className="flex-1" />

              <button
                className="text-xs text-gray-500 hover:text-primary-600 flex items-center gap-1 px-2 py-1 rounded transition-colors"
                onClick={() => setShowReplace(!showReplace)}
              >
                <ListFilter size={12} />
                {showReplace ? '收起替换' : '展开替换'}
              </button>
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center gap-2 pt-1">
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white
                           bg-primary-600 hover:bg-primary-700 rounded-md transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={!query}
                onClick={handleFind}
              >
                <Search size={12} />
                查找
              </button>

              <button
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-600
                           hover:bg-gray-100 rounded-md transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={matchCount === 0}
                onClick={onFindPrevious}
                title="上一个 (Shift+Enter)"
              >
                <ArrowUp size={12} />
              </button>

              <button
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-600
                           hover:bg-gray-100 rounded-md transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={matchCount === 0}
                onClick={onFindNext}
                title="下一个 (Enter)"
              >
                <ArrowDown size={12} />
              </button>

              {showReplace && (
                <>
                  <div className="w-px h-5 bg-gray-200" />

                  <button
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white
                               bg-amber-500 hover:bg-amber-600 rounded-md transition-colors
                               disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={matchCount === 0 || !replacement}
                    onClick={() => onReplace?.(replacement)}
                  >
                    替换
                  </button>

                  <button
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white
                               bg-red-500 hover:bg-red-600 rounded-md transition-colors
                               disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={matchCount === 0 || !replacement}
                    onClick={() => onReplaceAll?.(replacement)}
                  >
                    全部替换
                  </button>
                </>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ---- 子组件 ----

function OptionToggle({
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
        'flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors',
        active
          ? 'bg-primary-50 text-primary-700 border border-primary-200'
          : 'text-gray-500 hover:bg-gray-100 border border-transparent',
      )}
      onClick={onClick}
      title={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
