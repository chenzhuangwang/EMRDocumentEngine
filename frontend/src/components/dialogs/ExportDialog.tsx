// ============================================================
// ExportDialog — 导出对话框 (Spec TASK-304)
// ============================================================

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, FileText, FileJson, FileCode, Download, Check, AlignLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ExportFormat {
  id: string
  label: string
  description: string
  icon: React.ReactNode
  available: boolean
}

const FORMATS: ExportFormat[] = [
  {
    id: 'pdf',
    label: 'PDF 文档',
    description: '适合打印和分享，保留完整排版格式',
    icon: <FileText size={22} />,
    available: false,
  },
  {
    id: 'word',
    label: 'Word 文档',
    description: '.docx 格式，可在 Microsoft Word 中编辑',
    icon: <FileText size={22} />,
    available: false,
  },
  {
    id: 'html',
    label: 'HTML 页面',
    description: '纯静态网页，可在浏览器中直接查看',
    icon: <FileCode size={22} />,
    available: true,
  },
  {
    id: 'txt',
    label: '纯文本',
    description: '仅导出文字内容，不含样式和格式',
    icon: <AlignLeft size={22} />,
    available: true,
  },
  {
    id: 'json',
    label: 'JSON 数据',
    description: '结构化数据格式，适合程序处理和数据迁移',
    icon: <FileJson size={22} />,
    available: true,
  },
]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onExport: (format: string) => void
}

export function ExportDialog({ open, onOpenChange, onExport }: Props) {
  const [selectedId, setSelectedId] = useState<string>('json')

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50 animate-in fade-in" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                                     w-[460px] bg-white rounded-lg shadow-xl z-50
                                     animate-in zoom-in-95 fade-in">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <Dialog.Title className="text-base font-semibold text-gray-800">
              导出文档
            </Dialog.Title>
            <Dialog.Close className="p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600">
              <X size={18} />
            </Dialog.Close>
          </div>

          {/* Format list */}
          <div className="px-2 py-2">
            {FORMATS.map(fmt => (
              <button
                key={fmt.id}
                className={cn(
                  'w-full flex items-center gap-4 px-4 py-3.5 rounded-lg text-left transition-colors',
                  selectedId === fmt.id
                    ? 'bg-blue-50 border border-blue-200'
                    : 'hover:bg-gray-50 border border-transparent',
                  !fmt.available && 'opacity-60'
                )}
                onClick={() => fmt.available && setSelectedId(fmt.id)}
                disabled={!fmt.available}
              >
                <div className={cn(
                  'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
                  selectedId === fmt.id && fmt.available ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'
                )}>
                  {fmt.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800">{fmt.label}</span>
                    {!fmt.available && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-500 font-medium">
                        即将推出
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{fmt.description}</div>
                </div>
                {selectedId === fmt.id && fmt.available && (
                  <Check size={18} className="text-blue-500 flex-shrink-0" />
                )}
              </button>
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-100">
            <Dialog.Close className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md transition-colors">
              取消
            </Dialog.Close>
            <button
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-blue-600
                         hover:bg-blue-700 rounded-md transition-colors"
              onClick={() => {
                onExport(selectedId)
                onOpenChange(false)
              }}
            >
              <Download size={15} />
              导出
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
