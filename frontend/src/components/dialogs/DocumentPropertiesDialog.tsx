// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// DocumentPropertiesDialog — 文档属性对话框 (契约 §7.7 / §7.8)
//
// 编辑文档级属性: 标题 (DocumentTree.title, 顶级必填) + 元数据
// (DocumentMetadata: 作者/创建人/审核人/科室/分类/关键词)。
// createdAt/updatedAt/externalId/categoryId 为系统/外部生命周期字段 (只读)。
//
// 边界 (§7.8): 本组件只产出「规范化后的合法值」交给 onApply({ title, metadata }),
// 由父组件经 Editor.applyDocumentProperties (UpdateDocumentTitleCommand +
// UpdateDocumentPropertiesCommand) 写入 —— 对话框绝不直改 DocumentModel。
//
// 保存语义: 本地草稿 (title / values / keywordsText); onChange 只改草稿,
// 「应用」是唯一提交点; metadata 经 normalizeDocumentMetadata 规范化后再提交。
// keywords 规范形为 string[]: 输入框用逗号串展示/编辑, 提交时拆分 (去重由
// normalizeDocumentMetadata 完成, 不在 UI 二次规范化)。
//
// 取消/关闭语义: 无更改 → 直接关闭; 有更改 → 二次确认 (放弃草稿); 关闭不自动保存。
// ============================================================

import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, FileText, User, BadgeCheck, Building2, Tag, Calendar, Heading, Link, Hash } from 'lucide-react'
import type { DocumentMetadata } from '@/engine/document/core/DocumentModel'
import { normalizeDocumentMetadata } from '@/engine/document/core/DocumentModel'

export interface DocumentPropertiesResult {
  /** 文档标题 (DocumentTree.title) */
  title: string
  /** 规范化后的完整 DocumentMetadata; undefined 表示清空 metadata */
  metadata: DocumentMetadata | undefined
}

interface DocumentPropertiesDialogProps {
  open: boolean
  onClose: () => void
  initialTitle?: string
  initialValues?: DocumentMetadata
  /** 提交 { title, metadata } (已规范化); 父组件负责经命令写入 */
  onApply?: (result: DocumentPropertiesResult) => void
}

/** 关键词: 逗号串 → string[] (拆分 + trim + 去空; 去重由 normalizeDocumentMetadata 完成) */
function splitKeywords(s: string): string[] {
  return s.split(/[,，]/).map(t => t.trim()).filter(Boolean)
}

function joinKeywords(kw: string[] | undefined): string {
  return kw?.join(', ') ?? ''
}

/** 可编辑的元数据字符串字段 (title 单独处理; externalId/categoryId/createdAt/updatedAt 只读) */
type EditableKey = 'author' | 'creator' | 'reviewer' | 'department' | 'category'
const EDITABLE_KEYS: readonly EditableKey[] = ['author', 'creator', 'reviewer', 'department', 'category']

// ---- 组件 ----

export function DocumentPropertiesDialog({
  open, onClose, initialTitle, initialValues, onApply,
}: DocumentPropertiesDialogProps) {
  const [title, setTitle] = useState(initialTitle ?? '')
  const [values, setValues] = useState<DocumentMetadata>({ ...initialValues })
  const [keywordsText, setKeywordsText] = useState(joinKeywords(initialValues?.keywords))
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    if (open) {
      setTitle(initialTitle ?? '')
      setValues({ ...initialValues })
      setKeywordsText(joinKeywords(initialValues?.keywords))
      setConfirmOpen(false)
    }
  }, [open, initialTitle, initialValues])

  const update = (patch: Partial<DocumentMetadata>) => setValues(v => ({ ...v, ...patch }))

  // 脏判定: 标题 + 可编辑元数据字段 + 关键词串, 与初始值逐项比较 (只读字段不可变, 不参与)
  const original = initialValues
  const fieldsDirty = EDITABLE_KEYS.some(k => (values[k] ?? '') !== (original?.[k] ?? ''))
  const dirty = title !== (initialTitle ?? '') || fieldsDirty || keywordsText !== joinKeywords(original?.keywords)

  const apply = () => {
    const metadata = normalizeDocumentMetadata({ ...values, keywords: splitKeywords(keywordsText) })
    onApply?.({ title, metadata })
    onClose()
  }

  const requestClose = () => {
    if (dirty) setConfirmOpen(true)
    else onClose()
  }

  const discardAndClose = () => {
    setConfirmOpen(false)
    onClose()
  }

  // 可编辑字段 (字符串型)
  const textFields: {
    key: EditableKey
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

  // 只读字段 (系统生命周期 / 外部 importer)
  const readonlyFields: { key: 'externalId' | 'categoryId' | 'createdAt' | 'updatedAt'; label: string; icon: React.ReactNode }[] = [
    { key: 'externalId', label: '外部模板 ID', icon: <Link size={14} /> },
    { key: 'categoryId', label: '外部分类 ID', icon: <Hash size={14} /> },
    { key: 'createdAt', label: '创建时间', icon: <Calendar size={14} /> },
    { key: 'updatedAt', label: '更新时间', icon: <Calendar size={14} /> },
  ]

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) requestClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50
                     flex max-h-[85vh] w-[400px] flex-col overflow-hidden
                     bg-white rounded-lg shadow-xl border border-gray-200"
        >
          {/* 头部 */}
          <div className="flex flex-shrink-0 items-center justify-between px-5 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <FileText size={16} className="text-gray-500" />
              <Dialog.Title className="text-sm font-medium text-gray-800">文档属性</Dialog.Title>
            </div>
            <button onClick={requestClose} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600" aria-label="关闭">
              <X size={14} />
            </button>
          </div>

          {/* 表单 (可滚动, 超出时内部滚动, 不顶出 footer) */}
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
            {/* 标题 (DocumentTree.title, 可编辑) */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1">
                <Heading size={14} />
                标题
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="文档标题"
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-md
                           focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
              />
            </div>

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
                  {f.icon}
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
          <div className="flex flex-shrink-0 justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-lg">
            <button
              onClick={requestClose}
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

          {/* 脏态二次确认 */}
          {confirmOpen && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20">
              <div className="w-72 rounded-lg bg-white p-4 shadow-xl border border-gray-200">
                <div className="text-sm text-gray-800 mb-3">有未保存的更改，确定放弃吗？</div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setConfirmOpen(false)}
                    className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800"
                  >
                    继续编辑
                  </button>
                  <button
                    onClick={discardAndClose}
                    className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-md hover:bg-red-700"
                  >
                    放弃更改
                  </button>
                </div>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
