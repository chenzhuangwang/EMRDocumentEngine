// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ControlInputDialog — 输入域控件配置弹框 (契约 §12.7)
//
// 覆盖输入域家族: 纯文本(S1/input)、数字(N/number)、日期(D/date)、
// 下拉(select, S1+enums)。「格式」tab 的形态(kind)联动 controlType。
// 弹框只持有本地 draft, Apply 才组装 ElementMeta + TemplateDefinition
// 交给 onApply (§12.7), 不直改引擎。
// legacy (def.controlType undefined) 且未改形态时保持 undefined 不迁移。
//
// v6.1: 全部文案走 i18n。形态按钮复用 dialog.controlType.* (与
// controlDisplay 的属性面板展示名分开, 后者是目录名)。
// ================================================================

import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Tabs from '@radix-ui/react-tabs'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { controlTypeForDataType } from '@/engine'
import type { ElementMeta, ElementEnumOption, TemplateDefinition } from '@/engine'
import { cleanDefinition, cloneData, CodeBadge, DictionaryField, Field, NumField, TextField, ToggleField, inputCls } from './controlConfigShared'
import type { ControlConfigData } from './controlConfigShared'
import { useTranslation } from '@/i18n/useTranslation'
import type { LocaleMessages } from '@/engine'

/** 输入域形态: 纯文本/数字/日期/日期时间/下拉 (下拉=select; 日期时间=DT) */
export type InputKind = 'S1' | 'N' | 'D' | 'DT' | 'select'

interface ControlInputDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  initial: ControlConfigData
  onClose: () => void
  onApply: (result: ControlConfigData) => void
}

type TabId = 'general' | 'format' | 'validate' | 'binding' | 'other'

/** 形态按钮文案 → i18n 键 (与 dialog.controlType.* 一致) */
const KIND_LABEL_KEYS: Record<InputKind, keyof LocaleMessages> = {
  S1: 'dialog.controlType.input',
  N: 'dialog.controlType.number',
  D: 'dialog.controlType.date',
  DT: 'dialog.controlType.datetime',
  select: 'dialog.controlType.select',
}

const TAB_LABEL_KEYS: Record<TabId, keyof LocaleMessages> = {
  general: 'controlConfig.tab.basic',
  format: 'controlConfig.tab.format',
  validate: 'controlConfig.tab.advanced',
  binding: 'controlConfig.dataBindingTab',
  other: 'controlConfig.internal',
}

const TAB_ORDER: readonly TabId[] = ['general', 'format', 'validate', 'binding', 'other']

interface OptionDraft { name: string; value: string; numericValue?: number }

interface Draft {
  name: string
  label: string
  tips: string
  prefix: string
  suffix: string
  kind: InputKind
  showType: 'AN' | 'N' | undefined
  minLength: number | undefined
  maxLength: number | undefined
  scale: number | undefined
  required: boolean
  readonly: boolean
  deletable: boolean
  editable: boolean
  single: boolean
  options: OptionDraft[]
  multiple: boolean
  /** 外部码表引用 (ElementFormat.dictionary, 契约 §12.6.4) — 仅下拉形态可绑 */
  dictionary: string
}

function kindFrom(el: ElementMeta | undefined, def: TemplateDefinition | undefined): InputKind {
  if (def?.controlType === 'select') return 'select'
  const dt = el?.format?.dataType
  if (dt === 'DT') return 'DT'
  if (dt === 'N' || dt === 'D') return dt
  if (def?.controlType === 'datetime') return 'DT'
  return 'S1'
}

function draftFrom(initial: ControlConfigData): Draft {
  const el = initial.element
  const def = initial.definition
  const fmt = el.format
  const opts: OptionDraft[] = (fmt?.enums?.data ?? []).map((o) => ({
    name: o.name, value: o.value, numericValue: o.numericValue,
  }))
  return {
    name: el.name ?? '',
    label: def?.label ?? '',
    tips: def?.tips ?? '',
    prefix: def?.prefix ?? '',
    suffix: def?.suffix ?? '',
    kind: kindFrom(el, def),
    showType: fmt?.showType,
    minLength: fmt?.minLength,
    maxLength: fmt?.maxLength,
    scale: fmt?.scale,
    required: el.required === true,
    readonly: el.readonly === true,
    deletable: def?.deletable === true,
    editable: def?.editable === false ? false : true,
    single: def?.single === true,
    options: opts,
    multiple: fmt?.enums?.multiple === true,
    dictionary: fmt?.dictionary ?? '',
  }
}

export function ControlInputDialog({
  open, mode, initial, onClose, onApply,
}: ControlInputDialogProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<Draft>(() => draftFrom(initial))
  const [tab, setTab] = useState<TabId>('general')

  // open 翻转时以最新 initial 重置 draft (现各 Dialog 惯例)
  useEffect(() => {
    if (open) { setDraft(draftFrom(initial)); setTab('general') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))
  const patchOption = (i: number, p: Partial<OptionDraft>) =>
    setDraft((d) => ({ ...d, options: d.options.map((o, j) => (j === i ? { ...o, ...p } : o)) }))
  const addOption = () => setDraft((d) => ({ ...d, options: [...d.options, { name: '', value: '' }] }))
  const removeOption = (i: number) => setDraft((d) => ({ ...d, options: d.options.filter((_, j) => j !== i) }))

  // 组装产物 (仅 Apply 调用)
  const result = useMemo<ControlConfigData | null>(() => {
    const el = cloneData(initial.element)
    el.name = draft.name
    el.required = draft.required ? true : undefined
    el.readonly = draft.readonly ? true : undefined

    const fmt: NonNullable<ElementMeta['format']> = el.format ? cloneData(el.format) : {} as NonNullable<ElementMeta['format']>

    const typeChanged = draft.kind !== kindFrom(initial.element, initial.definition)

    if (draft.kind === 'select') {
      fmt.dataType = 'S1'
      const data: ElementEnumOption[] = draft.options
        .filter((o) => o.value !== '' || o.name !== '')
        .map((o) => {
          const value = o.value !== '' ? o.value : o.name
          const opt: ElementEnumOption = { name: o.name !== '' ? o.name : value, value }
          if (typeof o.numericValue === 'number' && Number.isFinite(o.numericValue)) opt.numericValue = o.numericValue
          return opt
        })
      // 外部码表引用 (契约 §12.6.4) —— 空串 = 不绑定 (不写空键)
      const dictionaryId = draft.dictionary.trim()
      fmt.dictionary = dictionaryId || undefined
      // 候选来源判定看 enums 键**是否存在**, 不看内容 (ControlValue.ts:117
      // `enums !== undefined ? enums.data : dictionaryCandidates`)。所以
      // 「未填 inline 候选 + 已绑码表」时必须**不写** enums —— 写一个空
      // enums 对象会让码表永远走不到, 即绑定静默失效。
      if (data.length === 0 && dictionaryId !== '') {
        delete fmt.enums
      } else {
        fmt.enums = { multiple: draft.multiple ? true : undefined, data }
      }
      delete fmt.showType
      delete fmt.scale
      delete fmt.minLength
      delete fmt.maxLength
    } else {
      fmt.dataType = draft.kind
      delete fmt.enums
      // 仅在**显式改过形态**时清除码表绑定: 否则打开一份带 dictionary 的旧文档
      // (legacy controlType undefined, kindFrom 推回 S1) 点「应用」会静默丢引用。
      if (typeChanged) delete fmt.dictionary
      fmt.showType = draft.kind === 'N' ? draft.showType : undefined
      fmt.scale = draft.kind === 'N' ? draft.scale : undefined
      fmt.minLength = draft.kind === 'S1' ? draft.minLength : undefined
      fmt.maxLength = draft.kind === 'S1' ? draft.maxLength : undefined
    }
    el.format = fmt

    const initialFamily = initial.definition?.controlType
    const initialFamilyIsInput =
      initialFamily === 'input' || initialFamily === 'number' || initialFamily === 'date' ||
      initialFamily === 'datetime' || initialFamily === 'select'
    let controlType: TemplateDefinition['controlType']
    if (draft.kind === 'select') {
      controlType = 'select'
    } else if (mode === 'create' || initialFamilyIsInput || typeChanged) {
      controlType = controlTypeForDataType(draft.kind)
    } else {
      controlType = initialFamily // legacy undefined + 未改类型 → 保持 undefined
    }

    const def = cleanDefinition({
      controlType,
      label: draft.label || undefined,
      tips: draft.tips || undefined,
      prefix: draft.prefix || undefined,
      suffix: draft.suffix || undefined,
      deletable: draft.deletable ? true : undefined,
      editable: draft.editable === false ? false : undefined,
      single: draft.single ? true : undefined,
    })
    return { element: el, definition: def }
  }, [draft, mode, initial])

  const kindLabel = t(KIND_LABEL_KEYS[draft.kind])

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content onCloseAutoFocus={(e) => e.preventDefault()} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 flex max-h-[85vh] w-[520px] flex-col overflow-hidden bg-chrome rounded-lg shadow-xl border border-line">
          <div className="flex flex-shrink-0 items-center justify-between px-4 py-3 border-b border-line-subtle">
            <Dialog.Title className="text-sm font-semibold text-chrome-ink-strong">
              {mode === 'create' ? t('controlConfig.create') : `${t('dialog.title.controlConfig')} · ${initial.element.name || t('controlConfig.fallbackName')}`}
            </Dialog.Title>
            <button className="text-chrome-ink-muted hover:text-chrome-ink-secondary" onClick={onClose} aria-label={t('common.close')}><X size={16} /></button>
          </div>

          <Tabs.Root value={tab} onValueChange={(v) => setTab(v as TabId)} className="flex flex-1 min-h-0 flex-col overflow-hidden">
            <Tabs.List className="flex flex-shrink-0 border-b border-line-subtle px-4">
              {TAB_ORDER.map((id) => (
                <Tabs.Trigger
                  key={id} value={id}
                  className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px',
                    tab === id ? 'border-primary-500 text-chrome-accent-ink' : 'border-transparent text-chrome-ink-tertiary hover:text-chrome-ink-body')}
                >
                  {t(TAB_LABEL_KEYS[id])}
                </Tabs.Trigger>
              ))}
            </Tabs.List>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
              {/* 常规 */}
              <Tabs.Content forceMount value="general" className="space-y-3">
                <TextField label={t('dialog.label.dataElementName')} value={draft.name} onChange={(v) => patch({ name: v })} placeholder={t('controlConfig.namePlaceholder')} />
                <CodeBadge element={initial.element} />
                <TextField label={t('controlConfig.labelField')} value={draft.label} onChange={(v) => patch({ label: v })} placeholder={t('controlConfig.labelPlaceholder')} />
                <div className="flex flex-wrap gap-x-6 gap-y-1 pt-1">
                  <ToggleField label={t('dialog.label.required')} checked={draft.required} onChange={(v) => patch({ required: v })} />
                  <ToggleField label={t('dialog.label.readonly')} checked={draft.readonly} onChange={(v) => patch({ readonly: v })} />
                </div>
              </Tabs.Content>

              {/* 格式 */}
              <Tabs.Content forceMount value="format" className="space-y-3">
                <Field label={t('controlConfig.kindLabel')}>
                  <div className="flex flex-wrap gap-2">
                    {(['S1', 'N', 'D', 'DT', 'select'] as InputKind[]).map((k) => (
                      <button
                        key={k} type="button"
                        onClick={() => patch({ kind: k })}
                        className={cn('px-3 py-1.5 text-xs rounded-md border transition-colors',
                          draft.kind === k ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-line text-chrome-ink-secondary hover:bg-chrome-subtle')}
                      >
                        {t(KIND_LABEL_KEYS[k])}
                      </button>
                    ))}
                  </div>
                </Field>
                <p className="text-xs text-chrome-ink-muted">{t('controlConfig.styleHint', { kind: kindLabel })}</p>

                {draft.kind === 'N' && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t('controlConfig.numberDisplay')}>
                      <select
                        className={inputCls}
                        value={draft.showType ?? ''}
                        onChange={(e) => patch({ showType: e.target.value === '' ? undefined : e.target.value as 'AN' | 'N' })}
                      >
                        <option value="">{t('controlConfig.defaultOption')}</option>
                        <option value="N">{t('controlConfig.numberDisplayN')}</option>
                        <option value="AN">{t('controlConfig.numberDisplayAN')}</option>
                      </select>
                    </Field>
                  </div>
                )}

                {draft.kind === 'select' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-chrome-ink-secondary">{t('dialog.label.options')}</span>
                      <button type="button" onClick={addOption} className="text-xs text-blue-600 hover:text-blue-700">{t('controlConfig.addOptionAction')}</button>
                    </div>
                    {draft.options.map((o, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input className={inputCls} placeholder={t('controlConfig.optionName')} value={o.name} onChange={(e) => patchOption(i, { name: e.target.value })} />
                        <input className={inputCls} placeholder={t('controlConfig.optionValue')} value={o.value} onChange={(e) => patchOption(i, { value: e.target.value })} />
                        <input
                          className={inputCls} placeholder={t('controlConfig.numericValuePlaceholder')}
                          value={o.numericValue ?? ''}
                          onChange={(e) => {
                            const s = e.target.value.trim()
                            patchOption(i, { numericValue: s === '' ? undefined : (Number.isFinite(Number(s)) ? Number(s) : o.numericValue) })
                          }}
                        />
                        <button type="button" onClick={() => removeOption(i)} className="text-chrome-ink-muted hover:text-red-500" aria-label={t('controlConfig.removeOption')}>×</button>
                      </div>
                    ))}
                    <ToggleField label={t('dialog.label.allowMultiple')} checked={draft.multiple} onChange={(v) => patch({ multiple: v })} />
                  </div>
                )}
              </Tabs.Content>

              {/* 校验 */}
              <Tabs.Content forceMount value="validate" className="space-y-3">
                {draft.kind === 'S1' && (
                  <div className="grid grid-cols-2 gap-3">
                    <NumField label={t('dialog.label.minLength')} value={draft.minLength} min={0} onChange={(v) => patch({ minLength: v })} placeholder={t('controlConfig.unlimited')} />
                    <NumField label={t('dialog.label.maxLength')} value={draft.maxLength} min={0} onChange={(v) => patch({ maxLength: v })} placeholder={t('controlConfig.unlimited')} />
                  </div>
                )}
                {draft.kind === 'N' && (
                  <NumField label={t('dialog.label.scale')} value={draft.scale} min={0} max={6} onChange={(v) => patch({ scale: v })} placeholder={t('controlConfig.unlimited')} />
                )}
                {draft.kind === 'D' && (
                  <p className="text-xs text-chrome-ink-muted">{t('controlConfig.dateFormatHint')}</p>
                )}
                {draft.kind === 'DT' && (
                  <p className="text-xs text-chrome-ink-muted">{t('controlConfig.dateTimeFormatHint')}</p>
                )}
              </Tabs.Content>

              {/* 数据绑定 */}
              <Tabs.Content forceMount value="binding" className="space-y-3">
                {draft.kind === 'select' ? (
                  <DictionaryField
                    value={draft.dictionary}
                    onChange={(v) => patch({ dictionary: v })}
                    inlineEnumsPresent={draft.options.some((o) => o.value !== '' || o.name !== '')}
                  />
                ) : (
                  <p className="text-xs text-chrome-ink-muted">
                    {t('controlConfig.bindingHint', { kind: kindLabel })}
                  </p>
                )}
              </Tabs.Content>

              {/* 其他 */}
              <Tabs.Content forceMount value="other" className="space-y-3">
                <TextField label={t('controlConfig.prefixLabel')} value={draft.prefix} onChange={(v) => patch({ prefix: v })} placeholder={t('controlConfig.prefixPlaceholder')} />
                <TextField label={t('controlConfig.suffixLabel')} value={draft.suffix} onChange={(v) => patch({ suffix: v })} placeholder={t('controlConfig.suffixPlaceholder')} />
                <TextField label={t('controlConfig.tipsLabel')} value={draft.tips} onChange={(v) => patch({ tips: v })} placeholder={t('controlConfig.tipsPlaceholder')} />
                <div className="flex flex-wrap gap-x-6 gap-y-1 pt-1">
                  <ToggleField label={t('controlConfig.deletableLabel')} checked={draft.deletable} onChange={(v) => patch({ deletable: v })} />
                  <ToggleField label={t('controlConfig.editableLabel')} checked={draft.editable} onChange={(v) => patch({ editable: v })} />
                  <ToggleField label={t('controlConfig.singleLabel')} checked={draft.single} onChange={(v) => patch({ single: v })} />
                </div>
              </Tabs.Content>
            </div>
          </Tabs.Root>

          {/* Footer */}
          <div className="flex flex-shrink-0 justify-end gap-2 border-t bg-chrome-subtle px-4 py-3">
            <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md text-chrome-ink-secondary hover:bg-chrome-muted">{t('common.cancel')}</button>
            <button
              onClick={() => { if (result) onApply(result) }}
              className="px-4 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"
            >
              {mode === 'create' ? t('common.insert') : t('common.apply')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}