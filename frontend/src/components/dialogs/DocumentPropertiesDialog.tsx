// ============================================================
// DocumentPropertiesDialog — 文档属性对话框 (R42, v6.0)
//
// 编辑 DocumentTree.metadata: 标题/作者/关键词/科室/日期
// ============================================================

import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, FileText, User, Tag, Building2, Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'

// ---- 类型 ----

export interface DocumentMeta {
  title: string
  author?: string
  keywords?: string
  department?: string
  category?: string
  createdDate?: string
  modifiedDate?: string
}

interface DocumentPropertiesDialogProps {
  open: boolean
  onClose: () => void
  initialValues?: Partial<DocumentMeta>
  onApply?: (values: DocumentMeta) => void
}

const DEFAULTS: DocumentMeta = {
  title: '未命名文档',
  author: '',
  keywords: '',
  department: '',
  category: '',
  createdDate: new Date().toISOString().split('T')[0],
  modifiedDate: new Date().toISOString().split('T')[0],
}

// ---- 组件 ----

export function DocumentPropertiesDialog({
  open, onClose, initialValues, onApply,
}: DocumentPropertiesDialogProps) {
  const [values, setValues] = useState<DocumentMeta>({ ...DEFAULTS, ...initialValues })

  useEffect(() => {
    if (open) setValues({ ...DEFAULTS, ...initialValues })
  }, [open, initialValues])

  const update = (patch: Partial<DocumentMeta>) => setValues(v => ({ ...v, ...patch }))

  const fields: {
    key: keyof DocumentMeta
    label: string
    icon: React.ReactNode
    placeholder?: string
    readOnly?: boolean
  }[] = [
    { key: 'title', label: '标题', icon: <FileText size={14} />, placeholder: '文档标题' },
    { key: 'author', label: '作者', icon: <User size={14} />, placeholder: '作者姓名' },
    { key: 'keywords', label: '关键词', icon: <Tag size={14} />, placeholder: '关键词1, 关键词2' },
    { key: 'department', label: '科室', icon: <Building2 size={14} />, placeholder: '所属科室' },
    { key: 'category', label: '分类', icon: <Tag size={14} />, placeholder: '文档分类' },
    { key: 'createdDate', label: '创建日期', icon: <Calendar size={14} />, readOnly: true },
    { key: 'modifiedDate', label: '修改日期', icon: <Calendar size={14} />, readOnly: true },
  ]

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content
          className="fixed top-1/4 left-1/2 -translate-x-1/2 z-50
                     w-[400px] bg-white rounded-lg shadow-xl border border-gray-200"
        >
          {/* 头部 */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <FileText size={16} className="text-gray-500" />
              <Dialog.Title className="text-sm font-medium text-gray-800">文档属性</Dialog.Title>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          </div>

          {/* 表单 */}
          <div className="px-5 py-4 space-y-3">
            {fields.map(f => (
              <div key={f.key}>
                <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1">
                  {f.icon}
                  {f.label}
                </label>
                <input
                  type="text"
                  value={values[f.key] || ''}
                  onChange={(e) => update({ [f.key]: e.target.value })}
                  readOnly={f.readOnly}
                  placeholder={f.placeholder}
                  className={cn(
                    'w-full text-sm px-3 py-2 border rounded-md',
                    'focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100',
                    f.readOnly
                      ? 'bg-gray-50 text-gray-500 border-gray-100 cursor-default'
                      : 'border-gray-200',
                  )}
                />
              </div>
            ))}
          </div>

          {/* 底部 */}
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-lg">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800"
            >
              取消
            </button>
            <button
              onClick={() => { onApply?.(values); onClose() }}
              className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              应用
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
