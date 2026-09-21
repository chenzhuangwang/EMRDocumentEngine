// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// DesignControlProperties — 设计态控件属性编辑面板 (契约 §12.5)
//
// 仅在设计模式 + 有选中控件时渲染的浮动面板: 读取选中控件的
// TemplateDefinition (§12.1) 完整定义, 就地编辑 7 个可编辑字段
// (label/tips/prefix/suffix 文本; deletable/editable/single 布尔),
// 经 Editor.setControlDefinition 整体回写。controlType (§12.1 第 8 字段)
// 与语义身份 (ElementMeta) 为只读展示 (见 controlDisplay.ts); 完整语义层 /
// controlType 配置走右键「属性」→ Control Config Dialog (契约 §12.7,
// Editor.applyControlConfig)。本面板 round-trip 保持 controlType 不变 (§12.5)。
// 渲染 / 初始化路径不产生任何 setControlDefinition 回写。
//
// 只消费引擎公共 API (getControlDefinition / setControlDefinition),
// 不直接改 pool / store (§12.5)。文本字段 onBlur 提交、布尔字段即时
// 提交, 避免逐字污染 undo 栈。
// ============================================================

import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useEditorRef, useEditorStoreSnapshot } from '@/components/editor/EditorProvider'
import type { TemplateDefinition } from '@/engine/template/TemplateDefinition'
import { controlTypeDisplayName, semanticIdentityOf } from './controlDisplay'
import { useTranslation } from '@/i18n/useTranslation'
import type { LocaleMessages } from '@/engine'

type StringField = 'label' | 'tips' | 'prefix' | 'suffix'
type BoolField = 'deletable' | 'editable' | 'single'

const STRING_FIELDS: { key: StringField; labelKey: 'design.field.label' | 'design.field.tips' | 'design.field.prefix' | 'design.field.suffix' }[] = [
  { key: 'label', labelKey: 'design.field.label' },
  { key: 'tips', labelKey: 'design.field.tips' },
  { key: 'prefix', labelKey: 'design.field.prefix' },
  { key: 'suffix', labelKey: 'design.field.suffix' },
]

const BOOL_FIELDS: { key: BoolField; labelKey: 'design.field.deletable' | 'design.field.editable' | 'design.field.single' }[] = [
  { key: 'deletable', labelKey: 'design.field.deletable' },
  { key: 'editable', labelKey: 'design.field.editable' },
  { key: 'single', labelKey: 'design.field.single' },
]

const IDENTITY_ROWS: { key: 'dataElement' | 'dataType' | 'showType' | 'enums' | 'required' | 'readonly'; labelKey: keyof LocaleMessages }[] = [
  { key: 'dataElement', labelKey: 'design.identity.dataElement' },
  { key: 'dataType', labelKey: 'design.identity.dataType' },
  { key: 'showType', labelKey: 'design.identity.showType' },
  { key: 'enums', labelKey: 'design.identity.enums' },
  { key: 'required', labelKey: 'design.identity.required' },
  { key: 'readonly', labelKey: 'design.identity.readonly' },
]

/** 从完整 def 清洗出「有实际值的字段」; 空串视为清除该字段 */
function cleanDefinition(def: TemplateDefinition): TemplateDefinition | undefined {
  const cleaned: TemplateDefinition = {}
  for (const k of Object.keys(def) as (keyof TemplateDefinition)[]) {
    const v = def[k]
    if (typeof v === 'string' && v.trim() === '') continue
    if (v === undefined) continue
    cleaned[k] = v as never
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined
}

/** 只读语义身份行 (label + value), 无任何输入控件 → 无写入路径 */
function SemanticRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-[11px] text-chrome-ink-muted">{label}</span>
      <span className="text-chrome-ink-secondary">{value}</span>
    </div>
  )
}

export function DesignControlProperties() {
  const { t } = useTranslation()
  const editorRef = useEditorRef()
  const mode = useEditorStoreSnapshot((s) => s.runtime.view.mode)
  const selectedId = useEditorStoreSnapshot((s) => s.designSelectedControlId)
  const [draft, setDraft] = useState<TemplateDefinition>({})

  // 选中控件变化 → 载入其当前完整 def 到本地草稿
  useEffect(() => {
    const editor = editorRef.current
    if (mode !== 'design' || !selectedId || !editor) { setDraft({}); return }
    setDraft(editor.getControlDefinition(selectedId) ?? {})
  }, [mode, selectedId, editorRef])

  if (mode !== 'design' || !selectedId) return null

  const editor = editorRef.current
  if (!editor) return null

  // 选中控件语义 (element) — 供标题 + 只读语义身份卡
  const element = editor.getElement(selectedId)
  const title = element?.name ?? t('design.controlFallback')
  const identity = semanticIdentityOf(element, t)

  const commit = (next: TemplateDefinition) => {
    setDraft(next)
    editor.setControlDefinition(selectedId, cleanDefinition(next))
  }

  const setString = (key: StringField, value: string) => {
    setDraft(prev => ({ ...prev, [key]: value }))
  }
  const commitString = () => {
    commit(draft)
  }

  const toggleBool = (key: BoolField, value: boolean) => {
    commit({ ...draft, [key]: value })
  }

  const clearAll = () => {
    setDraft({})
    editor.setControlDefinition(selectedId, undefined)
  }

  return (
    <div className="fixed right-[17.5rem] top-16 z-40 w-64 flex flex-col rounded-lg border border-line bg-chrome shadow-lg">
      {/* 面板头 */}
      <div className="flex items-center justify-between border-b border-line-subtle px-3 py-2">
        <span className="text-xs font-medium text-chrome-ink-body truncate">{title}</span>
        <button
          className="p-1 rounded text-chrome-ink-muted hover:text-red-500 hover:bg-red-50"
          onClick={clearAll}
          title={t('design.clearAllTitle')}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* 字段编辑 */}
      <div className="max-h-[70vh] overflow-y-auto p-2.5 space-y-2">
        {/* 文本字段 */}
        {STRING_FIELDS.map(({ key, labelKey }) => (
          <div key={key} className="flex flex-col gap-1">
            <label className="text-[11px] text-chrome-ink-muted">{t(labelKey)}</label>
            <input
              className="w-full rounded border border-line px-2 py-1 text-xs text-chrome-ink-body
                         focus:outline-none focus:border-blue-400"
              value={(draft[key] as string | undefined) ?? ''}
              onChange={(e) => setString(key, e.target.value)}
              onBlur={commitString}
            />
          </div>
        ))}

        {/* 布尔字段 */}
        <div className="pt-1 space-y-1.5 border-t border-line-subtle">
          {BOOL_FIELDS.map(({ key, labelKey }) => (
            <label key={key} className="flex items-center justify-between text-xs text-chrome-ink-body">
              <span>{t(labelKey)}</span>
              <input
                type="checkbox"
                className="rounded text-blue-500"
                checked={(draft[key] as boolean | undefined) ?? false}
                onChange={(e) => toggleBool(key, e.target.checked)}
              />
            </label>
          ))}
        </div>

        {/* controlType 只读展示 (契约 §12.5: 插入时写定, 面板不可改) */}
        <div className="flex items-center justify-between pt-1.5 border-t border-line-subtle">
          <span className="text-[11px] text-chrome-ink-muted">{t('dialog.label.controlType')}</span>
          <span className="text-xs text-chrome-ink-secondary">{controlTypeDisplayName(draft.controlType, t)}</span>
        </div>

        {/* 语义身份只读区 (契约 §12.5: 只读, 不产生写入) */}
        {identity && (
          <div className="pt-2 border-t border-dashed border-line">
            <div className="text-[11px] text-chrome-ink-muted mb-1">{t('design.properties.semantic')}</div>
            <div className="space-y-1">
              {IDENTITY_ROWS.map(({ key, labelKey }) => (
                <SemanticRow key={key} label={t(labelKey)} value={identity[key]} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
