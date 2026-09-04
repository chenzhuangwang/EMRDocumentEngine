// ============================================================
// DocumentPropertiesDialog — 文档属性对话框 (契约 §7.7 / §7.8)
//
// 编辑 DocumentTree.metadata (DocumentMetadata): 作者/创建人/审核人/
// 科室/分类/关键词。createdAt/updatedAt 为系统生命周期字段 (只读)。
//
// 边界 (§7.8): 本组件只产出「规范化后的合法 DocumentMetadata」交给
// onApply, 由父组件经 Editor.setDocumentMetadata (UpdateDocumentPropertiesCommand)
// 写入 —— 对话框绝不直改 DocumentModel。
//
// keywords 规范形为 string[]: 输入框用逗号串展示/编辑, 提交时拆分。
// ============================================================

import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, FileText, User, BadgeCheck, Building2, Tag, Calendar } from 'lucide-react'
import type { DocumentMetadata } from '@/engine/document/core/DocumentModel'
import { normalizeDocumentMetadata } from '@/engine/document/core/DocumentModel'

interface DocumentPropertiesDialogProps {
  open: boolean
  onClose: () => void
  initialValues?: DocumentMetadata
  /** 提交规范化后的完整 DocumentMetadata; undefined 表示清空 metadata */
  onApply?: (values: DocumentMetadata | undefined) => void
}

/** 关键词: 逗号串 → string[] (拆分 + trim + 去空; 去重由 normalizeDocumentMetadata 完成) */
function splitKeywords(s: string): string[] {
  return s.split(/[,，]/).map(t => t.trim()).filter(Boolean)
}

function joinKeywords(kw: string[] | undefined): string {
  return kw?.join(', ') ?? ''
}

// ---- 组件 ----

export function DocumentPropertiesDialog({
  open, onClose, initialValues, onApply,
}: DocumentPropertiesDialogProps) {
  const [values, setValues] = useState<DocumentMetadata>({ ...initialValues })
  const [keywordsText, setKeywordsText] = useState(joinKeywords(initialValues?.keywords))

  useEffect(() => {
    if (open) {
      setValues({ ...initialValues })
      setKeywordsText(joinKeywords(initialValues?.keywords))
    }
  }, [open, initialValues])

  const update = (patch: Partial<DocumentMetadata>) => setValues(v => ({ ...v, ...patch }))

  const apply = () => {
    const next = normalizeDocumentMetadata({
      ...values,
      keywords: splitKeywords(keywordsText),
    })
    onApply?.(next)
    onClose()
  }

  // 可编辑字段 (字符串型)
  const textFields: {
    key: 'author' | 'creator' | 'reviewer' | 'department' | 'category'
    label: string
    icon: React.ReactNode
    placeholder?: string
  }[] = [
    { key: 'author', label: '作者', icon: <User size={14} />, placeholder: '作者姓名' },
    { key: 'creator', label: '创建人', icon: <BadgeCheck size={14} />, placeholder: '创建人' },
    { key: 'reviewer', label: '审核人', icon: <User size={14} />, placeholder: '审核人' },
    { key: 'department', label: '科室', icon: <Building2 size={14} />, placeholder: '所属科室' },
    { key: 'category', label: '分类', icon: <Tag size={14} />, placeholder: '文档分类' },
  ]

  // 只读字段 (系统生命周期)
  const readonlyFields: { key: 'createdAt' | 'updatedAt'; label: string }[] = [
    { key: 'createdAt', label: '创建时间' },
    { key: 'updatedAt', label: '更新时间' },
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
            {textFields.map(f => (
              <div key={f.key}>
                <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1">
                  {f.icon}
                  {f.label}
                </label>
                <input
                  type="text"
                  value={values[f.key] || ''}
                  onChange={(e) => update({ [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded-md
                             focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                />
              </div>
            ))}

            {/* 关键词: 逗号串输入, 提交时拆分为 string[] */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1">
                <Tag size={14} />
                关键词
              </label>
              <input
                type="text"
                value={keywordsText}
                onChange={(e) => setKeywordsText(e.target.value)}
                placeholder="关键词1, 关键词2"
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-md
                           focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
              />
            </div>

            {readonlyFields.map(f => (
              <div key={f.key}>
                <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1">
                  <Calendar size={14} />
                  {f.label}
                </label>
                <input
                  type="text"
                  value={values[f.key] || ''}
                  readOnly
                  className="w-full text-sm px-3 py-2 border border-gray-100 rounded-md
                             bg-gray-50 text-gray-500 cursor-default"
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
              onClick={apply}
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
