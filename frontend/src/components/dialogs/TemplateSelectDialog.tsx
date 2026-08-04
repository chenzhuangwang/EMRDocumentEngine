// ============================================================
// TemplateSelectDialog — 模板选择对话框 (Spec TASK-304)
// ============================================================

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  X, Search, FileText, Folder, Check, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export interface TemplateItem {
  id: string
  name: string
  description?: string
  category: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  templates: { name: string; items: { id: string; name: string; description?: string }[] }[]
  onSelect: (templateId: string) => void
}

export function TemplateSelectDialog({ open, onOpenChange, templates, onSelect }: Props) {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Flatten templates with category
  const allItems: TemplateItem[] = templates.flatMap(cat =>
    cat.items.map(item => ({ ...item, category: cat.name }))
  )

  const filtered = search.trim()
    ? allItems.filter(t =>
        t.name.includes(search) || t.category.includes(search) ||
        (t.description && t.description.includes(search))
      )
    : allItems

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50 animate-in fade-in" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                                     w-[520px] max-h-[520px] bg-white rounded-lg shadow-xl z-50
                                     flex flex-col animate-in zoom-in-95 fade-in">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <Dialog.Title className="text-base font-semibold text-gray-800">
              选择模板
            </Dialog.Title>
            <Dialog.Close className="p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600">
              <X size={18} />
            </Dialog.Close>
          </div>

          {/* Search */}
          <div className="px-5 py-3">
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-md border border-gray-200">
              <Search size={15} className="text-gray-400 flex-shrink-0" />
              <input
                className="bg-transparent border-none outline-none text-sm w-full placeholder:text-gray-400"
                placeholder="搜索模板名称..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2">
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-sm text-gray-400">
                <FileText size={36} className="mx-auto mb-2 text-gray-200" />
                没有匹配的模板
              </div>
            ) : (
              <div className="space-y-1">
                {filtered.map(item => (
                  <button
                    key={item.id}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-3 rounded-md text-left transition-colors',
                      selectedId === item.id
                        ? 'bg-blue-50 border border-blue-200'
                        : 'hover:bg-gray-50 border border-transparent'
                    )}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <div className={cn(
                      'w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0',
                      selectedId === item.id ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'
                    )}>
                      <FileText size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">{item.name}</div>
                      <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                        <Folder size={11} />
                        <span>{item.category}</span>
                        {item.description && (
                          <>
                            <span className="text-gray-300">|</span>
                            <span className="truncate">{item.description}</span>
                          </>
                        )}
                      </div>
                    </div>
                    {selectedId === item.id && <Check size={18} className="text-blue-500 flex-shrink-0" />}
                    {selectedId !== item.id && <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-100">
            <Dialog.Close className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md transition-colors">
              取消
            </Dialog.Close>
            <button
              className="px-5 py-2 text-sm font-medium text-white bg-blue-600
                         hover:bg-blue-700 rounded-md transition-colors
                         disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!selectedId}
              onClick={() => {
                if (selectedId) {
                  onSelect(selectedId)
                  onOpenChange(false)
                }
              }}
            >
              使用此模板
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
