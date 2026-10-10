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
import type { DocumentMetadata } from '@emrde/document-engine'
import { normalizeDocumentMetadata } from '@emrde/document-engine'
import { useTranslation } from '@/i18n/useTranslation'

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
  const { t } = useTranslation()
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
    labelKey: 'dialog.label.author' | 'docProps.creator' | 'dialog.label.reviewer' | 'dialog.label.department' | 'dialog.label.category'
    icon: React.ReactNode
    placeholderKey?: 'docProps.placeholderAuthor' | 'docProps.placeholderCreator' | 'docProps.placeholderReviewer' | 'docProps.placeholderDepartment' | 'docProps.placeholderCategory'
  }[] = [
    { key: 'author',     labelKey: 'dialog.label.author',     icon: <User size={14} />,      placeholderKey: 'docProps.placeholderAuthor' },
    { key: 'creator',    labelKey: 'docProps.creator',        icon: <BadgeCheck size={14} />, placeholderKey: 'docProps.placeholderCreator' },
    { key: 'reviewer',   labelKey: 'dialog.label.reviewer',   icon: <User size={14} />,      placeholderKey: 'docProps.placeholderReviewer' },
    { key: 'department', labelKey: 'dialog.label.department', icon: <Building2 size={14} />, placeholderKey: 'docProps.placeholderDepartment' },
    { key: 'category',   labelKey: 'dialog.label.category',   icon: <Tag size={14} />,       placeholderKey: 'docProps.placeholderCategory' },
  ]

  // 只读字段 (系统生命周期 / 外部 importer)
  const readonlyFields: { key: 'externalId' | 'categoryId' | 'createdAt' | 'updatedAt'; labelKey: 'docProps.externalId' | 'docProps.categoryId' | 'dialog.label.createdAt' | 'dialog.label.updatedAt'; icon: React.ReactNode }[] = [
    { key: 'externalId', labelKey: 'docProps.externalId', icon: <Link size={14} /> },
    { key: 'categoryId', labelKey: 'docProps.categoryId', icon: <Hash size={14} /> },
    { key: 'createdAt',  labelKey: 'dialog.label.createdAt', icon: <Calendar size={14} /> },
    { key: 'updatedAt',  labelKey: 'dialog.label.updatedAt', icon: <Calendar size={14} /> },
  ]

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) requestClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50
                     flex max-h-[85vh] w-[400px] flex-col overflow-hidden
                     bg-chrome rounded-lg shadow-xl border border-line"
        >
          {/* 头部 */}
          <div className="flex flex-shrink-0 items-center justify-between px-5 py-3 border-b border-line-subtle">
            <div className="flex items-center gap-2">
              <FileText size={16} className="text-chrome-ink-tertiary" />
              <Dialog.Title className="text-sm font-medium text-chrome-ink-strong">{t('dialog.title.documentProperties')}</Dialog.Title>
            </div>
            <button onClick={requestClose} className="p-1 rounded hover:bg-chrome-muted text-chrome-ink-muted hover:text-chrome-ink-secondary"
                    aria-label={t('common.close')}>
              <X size={14} />
            </button>
          </div>

          {/* 表单 (可滚动, 超出时内部滚动, 不顶出 footer) */}
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
            {/* 标题 (DocumentTree.title, 可编辑) */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-chrome-ink-secondary mb-1">
                <Heading size={14} />
                {t('dialog.label.title')}
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('docProps.titlePlaceholder')}
                className="w-full text-sm px-3 py-2 border border-line rounded-md
                           focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
              />
            </div>

            {textFields.map(f => (
              <div key={f.key}>
                <label className="flex items-center gap-1.5 text-xs font-medium text-chrome-ink-secondary mb-1">
                  {f.icon}
                  {t(f.labelKey)}
                </label>
                <input
                  type="text"
                  value={values[f.key] || ''}
                  onChange={(e) => update({ [f.key]: e.target.value })}
                  placeholder={f.placeholderKey ? t(f.placeholderKey) : undefined}
                  className="w-full text-sm px-3 py-2 border border-line rounded-md
                             focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                />
              </div>
            ))}

            {/* 关键词: 逗号串输入, 提交时拆分为 string[] */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-chrome-ink-secondary mb-1">
                <Tag size={14} />
                {t('dialog.label.keywords')}
              </label>
              <input
                type="text"
                value={keywordsText}
                onChange={(e) => setKeywordsText(e.target.value)}
                placeholder={t('docProps.keywordsPlaceholder')}
                className="w-full text-sm px-3 py-2 border border-line rounded-md
                           focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
              />
            </div>

            {readonlyFields.map(f => (
              <div key={f.key}>
                <label className="flex items-center gap-1.5 text-xs font-medium text-chrome-ink-secondary mb-1">
                  {f.icon}
                  {t(f.labelKey)}
                </label>
                <input
                  type="text"
                  value={values[f.key] || ''}
                  readOnly
                  className="w-full text-sm px-3 py-2 border border-line-subtle rounded-md
                             bg-chrome-subtle text-chrome-ink-tertiary cursor-default"
                />
              </div>
            ))}
          </div>

          {/* 底部 */}
          <div className="flex flex-shrink-0 justify-end gap-2 px-5 py-3 border-t border-line-subtle bg-chrome-subtle rounded-b-lg">
            <button
              onClick={requestClose}
              className="px-3 py-1.5 text-xs text-chrome-ink-secondary hover:text-chrome-ink-strong"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={apply}
              className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              {t('common.apply')}
            </button>
          </div>

          {/* 脏态二次确认 */}
          {confirmOpen && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20">
              <div className="w-72 rounded-lg bg-chrome p-4 shadow-xl border border-line">
                <div className="text-sm text-chrome-ink-strong mb-3">{t('docProps.discardConfirm')}</div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setConfirmOpen(false)}
                    className="px-3 py-1.5 text-xs text-chrome-ink-secondary hover:text-chrome-ink-strong"
                  >
                    {t('docProps.continueEditing')}
                  </button>
                  <button
                    onClick={discardAndClose}
                    className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-md hover:bg-red-700"
                  >
                    {t('dialog.label.discardChanges')}
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
