// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ControlChoiceDialog — 单选/复选控件配置弹框 (契约 §12.7)
//
// 5 tab: 控件类型(仅 radio/checkbox) / 基础属性 / 选项设置 /
// 数值属性(每候选项 numericValue) / 项目列表(排序·批量)。
// draft 内一份 options 数组是单一事实源, 三个选项类 tab 同源编辑。
// legacy (controlType select/undefined) 且未切换多选语义时保持原
// controlType, 不做「打开即迁移」; 单选↔复选切换才显式落 controlType。
// ================================================================

import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Tabs from '@radix-ui/react-tabs'
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ElementMeta, ElementEnumOption, TemplateDefinition } from '@/engine'
import { CodeBadge, TextField, ToggleField, cleanDefinition, cloneData, inputCls } from './controlConfigShared'
import type { ControlConfigData } from './controlConfigShared'
import { useTranslation } from '@/i18n/useTranslation'
import type { LocaleMessages } from '@/engine'

interface ControlChoiceDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  initial: ControlConfigData
  onClose: () => void
  onApply: (result: ControlConfigData) => void
}

type TabId = 'type' | 'base' | 'options' | 'numeric' | 'list'

const TAB_ORDER: readonly TabId[] = ['type', 'base', 'options', 'numeric', 'list']
const TAB_LABEL_KEYS: Record<TabId, keyof LocaleMessages> = {
  type: 'choice.tab.type',
  base: 'choice.tab.base',
  options: 'choice.tab.options',
  numeric: 'choice.tab.numeric',
  list: 'choice.tab.list',
}

interface OptionDraft extends ElementEnumOption { }

interface ChoiceDraft {
  name: string
  label: string
  tips: string
  prefix: string
  suffix: string
  required: boolean
  readonly: boolean
  deletable: boolean
  editable: boolean
  single: boolean
  multiple: boolean
  options: OptionDraft[]
  /** 枚举是否允许手输 (保留既有值, 默认 undefined=严格成员) */
  enumEditable: boolean | undefined
}

function draftFrom(initial: ControlConfigData): ChoiceDraft {
  const el = initial.element
  const def = initial.definition
  const fmt = el.format
  const enums = fmt?.enums
  const multiple = def?.controlType === 'checkbox' || enums?.multiple === true
  return {
    name: el.name ?? '',
    label: def?.label ?? '',
    tips: def?.tips ?? '',
    prefix: def?.prefix ?? '',
    suffix: def?.suffix ?? '',
    required: el.required === true,
    readonly: el.readonly === true,
    deletable: def?.deletable === true,
    editable: def?.editable === false ? false : true,
    single: def?.single === true,
    multiple: multiple === true,
    options: (enums?.data ?? []).map((o) => ({ ...o })),
    enumEditable: enums?.editable,
  }
}

const THEAD = 'text-xs font-medium text-chrome-ink-tertiary border-b border-line-subtle px-1.5 py-1 text-left whitespace-nowrap'
const CELL = 'px-1.5 py-1 align-middle'

export function ControlChoiceDialog({
  open, mode, initial, onClose, onApply,
}: ControlChoiceDialogProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<ChoiceDraft>(() => draftFrom(initial))
  const [tab, setTab] = useState<TabId>('type')

  useEffect(() => {
    if (open) { setDraft(draftFrom(initial)); setTab('type') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const patch = (p: Partial<ChoiceDraft>) => setDraft((d) => ({ ...d, ...p }))
  const setOpt = (i: number, p: Partial<OptionDraft>) =>
    setDraft((d) => { const opts = d.options.map((o, j) => (i === j ? { ...o, ...p } : o)); return { ...d, options: opts } })
  const addOpt = () => setDraft((d) => ({ ...d, options: [...d.options, { name: '', value: '' }] }))
  const removeOpt = (i: number) => setDraft((d) => ({ ...d, options: d.options.filter((_, j) => j !== i) }))
  const moveOpt = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const j = i + dir
      if (j < 0 || j >= d.options.length) return d
      const opts = d.options.slice()
      ;[opts[i], opts[j]] = [opts[j], opts[i]]
      return { ...d, options: opts }
    })

  const result = useMemo<ControlConfigData | null>(() => {
    const el = cloneData(initial.element)
    el.name = draft.name
    el.required = draft.required ? true : undefined
    el.readonly = draft.readonly ? true : undefined

    const fmt: NonNullable<ElementMeta['format']> = el.format ? cloneData(el.format) : {} as NonNullable<ElementMeta['format']>
    // 候选项只保留有效行 (name 或 value 非空)
    const data = draft.options
      .map((o) => ({ name: o.name.trim(), value: o.value.trim(), exclusive: o.exclusive, numericValue: o.numericValue }))
      .filter((o) => o.value !== '' || o.name !== '')
      .map((o) => {
        const opt: ElementEnumOption = { name: o.name || o.value, value: o.value || o.name }
        if (o.exclusive) opt.exclusive = true
        if (typeof o.numericValue === 'number' && Number.isFinite(o.numericValue)) opt.numericValue = o.numericValue
        return opt
      })
    const enums = cloneData(initial.element.format?.enums) ?? {}
    enums.multiple = draft.multiple
    if (draft.enumEditable === true || draft.enumEditable === false) enums.editable = draft.enumEditable
    delete (enums as { data?: unknown }).data
    enums.data = data.length > 0 ? data : undefined
    fmt.enums = enums
    el.format = fmt

    const initialMultiple =
      initial.definition?.controlType === 'checkbox' || initial.element.format?.enums?.multiple === true
    const multipleChanged = draft.multiple !== initialMultiple
    let controlType: TemplateDefinition['controlType']
    if (mode === 'create' || multipleChanged) {
      controlType = draft.multiple ? 'checkbox' : 'radio'
    } else {
      controlType = initial.definition?.controlType // legacy select/undefined + 未切换 → 保持
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

  const rowRead = (i: number) => draft.options[i]

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content onCloseAutoFocus={(e) => e.preventDefault()} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 flex max-h-[85vh] w-[620px] flex-col overflow-hidden bg-chrome rounded-lg shadow-xl border border-line">
          <div className="flex flex-shrink-0 items-center justify-between px-4 py-3 border-b border-line-subtle">
            <Dialog.Title className="text-sm font-semibold text-chrome-ink-strong">
              {mode === 'create' ? t('choice.create') : `${t('dialog.title.controlConfig')} · ${initial.element.name || t('choice.fallbackName')}`}
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
              {/* 控件类型 */}
              <Tabs.Content forceMount value="type" className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { key: false, labelKey: 'choice.radioLabel' as const, descKey: 'choice.radioDesc' as const },
                    { key: true, labelKey: 'choice.checkboxLabel' as const, descKey: 'choice.checkboxDesc' as const },
                  ] as const).map((o) => (
                    <button
                      key={String(o.key)} type="button"
                      onClick={() => patch({ multiple: o.key })}
                      className={cn('text-left px-3 py-2.5 rounded-md border transition-colors',
                        draft.multiple === o.key ? 'border-blue-500 bg-blue-50' : 'border-line hover:bg-chrome-subtle')}
                    >
                      <div className={cn('text-sm font-medium', draft.multiple === o.key ? 'text-blue-700' : 'text-chrome-ink-body')}>{t(o.labelKey)}</div>
                      <div className="text-xs text-chrome-ink-muted mt-0.5">{t(o.descKey)}</div>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-chrome-ink-muted">{t('choice.typeNote')}</p>
              </Tabs.Content>

              {/* 基础属性 */}
              <Tabs.Content forceMount value="base" className="space-y-3">
                <TextField label={t('dialog.label.dataElementName')} value={draft.name} onChange={(v) => patch({ name: v })} placeholder={t('choice.namePlaceholder')} />
                <CodeBadge element={initial.element} />
                <TextField label={t('controlConfig.labelField')} value={draft.label} onChange={(v) => patch({ label: v })} placeholder={t('choice.labelPlaceholder')} />
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 pt-1">
                  <ToggleField label={t('dialog.label.required')} checked={draft.required} onChange={(v) => patch({ required: v })} />
                  <ToggleField label={t('dialog.label.readonly')} checked={draft.readonly} onChange={(v) => patch({ readonly: v })} />
                  <ToggleField label={t('controlConfig.deletableLabel')} checked={draft.deletable} onChange={(v) => patch({ deletable: v })} />
                  <ToggleField label={t('controlConfig.editableLabel')} checked={draft.editable} onChange={(v) => patch({ editable: v })} />
                  <ToggleField label={t('controlConfig.singleLabel')} checked={draft.single} onChange={(v) => patch({ single: v })} />
                </div>
                <div className="pt-1">
                  <ToggleField label={t('choice.enumEditableLabel')} checked={draft.enumEditable === true} onChange={(v) => patch({ enumEditable: v ? true : undefined })} />
                </div>
              </Tabs.Content>

              {/* 选项设置 */}
              <Tabs.Content forceMount value="options" className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-chrome-ink-tertiary">{t('choice.optionsHeader')}</span>
                  <button type="button" onClick={addOpt} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
                    <Plus size={13} /> {t('choice.addOption')}
                  </button>
                </div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={THEAD}>{t('choice.col.name')}</th>
                      <th className={THEAD}>{t('choice.col.value')}</th>
                      <th className={cn(THEAD, 'w-14 text-center')}>{t('choice.col.exclusive')}</th>
                      <th className={cn(THEAD, 'w-8')}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.options.map((o, i) => (
                      <tr key={i} className="border-b border-line-subtle">
                        <td className={CELL}>
                          <input className={inputCls} value={o.name} placeholder={t('choice.col.name')} onChange={(e) => setOpt(i, { name: e.target.value })} />
                        </td>
                        <td className={CELL}>
                          <input className={inputCls} value={o.value} placeholder={t('choice.col.value')} onChange={(e) => setOpt(i, { value: e.target.value })} />
                        </td>
                        <td className={cn(CELL, 'text-center')}>
                          <input type="checkbox" checked={o.exclusive === true} onChange={(e) => setOpt(i, { exclusive: e.target.checked ? true : undefined })} />
                        </td>
                        <td className={cn(CELL, 'text-center')}>
                          <button type="button" aria-label={t('choice.removeOption', { n: i + 1 })} onClick={() => removeOpt(i)} className="text-chrome-ink-disabled hover:text-red-500"><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    ))}
                    {draft.options.length === 0 && (
                      <tr><td colSpan={4} className={cn(CELL, 'text-center text-xs text-chrome-ink-disabled py-3')}>{t('choice.optionsEmptyHint')}</td></tr>
                    )}
                  </tbody>
                </table>
              </Tabs.Content>

              {/* 数值属性 */}
              <Tabs.Content forceMount value="numeric" className="space-y-3">
                <p className="text-xs text-chrome-ink-muted">{t('choice.numericNote')}</p>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={THEAD}>{t('choice.col.item')}</th>
                      <th className={cn(THEAD, 'w-28')}>{t('choice.col.numeric')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.options.map((o, i) => (
                      <tr key={i} className="border-b border-line-subtle">
                        <td className={CELL}>
                          <span className="text-sm text-chrome-ink-body">{o.name || o.value || t('choice.emptyValue')}</span>
                          {o.value !== o.name && o.name ? <span className="ml-1 text-xs text-chrome-ink-disabled">({o.value})</span> : null}
                        </td>
                        <td className={CELL}>
                          <input
                            type="number" step="any" className={inputCls}
                            value={o.numericValue === undefined ? '' : String(o.numericValue)}
                            onChange={(e) => setOpt(i, { numericValue: e.target.value === '' ? undefined : Number(e.target.value) })}
                          />
                        </td>
                      </tr>
                    ))}
                    {draft.options.length === 0 && <tr><td colSpan={2} className={cn(CELL, 'text-center text-xs text-chrome-ink-disabled py-3')}>{t('choice.optionsEmpty')}</td></tr>}
                  </tbody>
                </table>
              </Tabs.Content>

              {/* 项目列表 */}
              <Tabs.Content forceMount value="list" className="space-y-3">
                <p className="text-xs text-chrome-ink-muted">{t('choice.listNote')}</p>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={cn(THEAD, 'w-8')}>#</th>
                      <th className={THEAD}>{t('choice.col.itemValue')}</th>
                      <th className={cn(THEAD, 'w-16 text-center')}>{t('choice.col.numeric')}</th>
                      <th className={cn(THEAD, 'w-8')}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.options.map((o, i) => (
                      <tr key={i} className="border-b border-line-subtle">
                        <td className={cn(CELL, 'text-center text-xs text-chrome-ink-muted')}>{i + 1}</td>
                        <td className={CELL}>
                          <span className="text-sm text-chrome-ink-body">{o.name || t('choice.emptyName')}</span>
                          {o.value !== o.name && o.name ? <span className="ml-1 text-xs text-chrome-ink-disabled">({o.value})</span> : null}
                        </td>
                        <td className={cn(CELL, 'text-center text-xs text-chrome-ink-tertiary')}>{o.numericValue ?? '—'}</td>
                        <td className={cn(CELL, 'whitespace-nowrap text-right')}>
                          <button type="button" aria-label={t('choice.moveUp')} disabled={i === 0} onClick={() => moveOpt(i, -1)} className="text-chrome-ink-muted hover:text-chrome-ink-secondary disabled:opacity-30"><ArrowUp size={13} /></button>
                          <button type="button" aria-label={t('choice.moveDown')} disabled={i === draft.options.length - 1} onClick={() => moveOpt(i, 1)} className="ml-1 text-chrome-ink-muted hover:text-chrome-ink-secondary disabled:opacity-30"><ArrowDown size={13} /></button>
                          <button type="button" aria-label={t('choice.removeByValue', { value: rowRead(i)?.value || '' })} onClick={() => removeOpt(i)} className="ml-1 text-chrome-ink-disabled hover:text-red-500"><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    ))}
                    {draft.options.length === 0 && <tr><td colSpan={4} className={cn(CELL, 'text-center text-xs text-chrome-ink-disabled py-3')}>{t('choice.optionsEmpty')}</td></tr>}
                  </tbody>
                </table>
              </Tabs.Content>
            </div>
          </Tabs.Root>

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
