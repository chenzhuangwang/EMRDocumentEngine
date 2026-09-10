// ================================================================
// ControlInputDialog — 输入域控件配置弹框 (契约 §12.7)
//
// 覆盖输入域家族: 纯文本(S1/input)、数字(N/number)、日期(D/date)、
// 下拉(select, S1+enums)。「格式」tab 的形态(kind)联动 controlType。
// 弹框只持有本地 draft, Apply 才组装 ElementMeta + TemplateDefinition
// 交给 onApply (§12.7), 不直改引擎。
// legacy (def.controlType undefined) 且未改形态时保持 undefined 不迁移。
// ================================================================

import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Tabs from '@radix-ui/react-tabs'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { controlTypeForDataType } from '@/engine'
import type { ElementMeta, ElementEnumOption, TemplateDefinition } from '@/engine'
import { cleanDefinition, cloneData, CodeBadge, Field, NumField, TextField, ToggleField, inputCls } from './controlConfigShared'
import type { ControlConfigData } from './controlConfigShared'

/** 输入域形态: 纯文本/数字/日期/下拉 (下拉不是 dataType, 是 S1+enums+select) */
export type InputKind = 'S1' | 'N' | 'D' | 'select'

interface ControlInputDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  initial: ControlConfigData
  onClose: () => void
  onApply: (result: ControlConfigData) => void
}

const KIND_OPTIONS: { value: InputKind; label: string }[] = [
  { value: 'S1', label: '纯文本' },
  { value: 'N', label: '数字' },
  { value: 'D', label: '日期' },
  { value: 'select', label: '下拉' },
]

const TABS = [
  { id: 'general', label: '常规' },
  { id: 'format', label: '格式' },
  { id: 'validate', label: '校验' },
  { id: 'other', label: '其他' },
] as const
type TabId = (typeof TABS)[number]['id']

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
}

function kindFrom(el: ElementMeta | undefined, def: TemplateDefinition | undefined): InputKind {
  if (def?.controlType === 'select') return 'select'
  const dt = el?.format?.dataType
  if (dt === 'N' || dt === 'D') return dt
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
  }
}

export function ControlInputDialog({
  open, mode, initial, onClose, onApply,
}: ControlInputDialogProps) {
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
      fmt.enums = { multiple: draft.multiple ? true : undefined, data }
      delete fmt.showType
      delete fmt.scale
      delete fmt.minLength
      delete fmt.maxLength
    } else {
      fmt.dataType = draft.kind
      delete fmt.enums
      fmt.showType = draft.kind === 'N' ? draft.showType : undefined
      fmt.scale = draft.kind === 'N' ? draft.scale : undefined
      fmt.minLength = draft.kind === 'S1' ? draft.minLength : undefined
      fmt.maxLength = draft.kind === 'S1' ? draft.maxLength : undefined
    }
    el.format = fmt

    const initialFamily = initial.definition?.controlType
    const initialFamilyIsInput =
      initialFamily === 'input' || initialFamily === 'number' || initialFamily === 'date' || initialFamily === 'select'
    const typeChanged = draft.kind !== kindFrom(initial.element, initial.definition)
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

  const kindLabel = KIND_OPTIONS.find((o) => o.value === draft.kind)?.label

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content onCloseAutoFocus={(e) => e.preventDefault()} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 flex max-h-[85vh] w-[520px] flex-col overflow-hidden bg-white rounded-lg shadow-xl border border-gray-200">
          <div className="flex flex-shrink-0 items-center justify-between px-4 py-3 border-b border-gray-100">
            <Dialog.Title className="text-sm font-semibold text-gray-800">
              {mode === 'create' ? '新建输入域' : `控件配置 · ${initial.element.name || '输入域'}`}
            </Dialog.Title>
            <button className="text-gray-400 hover:text-gray-600" onClick={onClose} aria-label="关闭"><X size={16} /></button>
          </div>

          <Tabs.Root value={tab} onValueChange={(v) => setTab(v as TabId)} className="flex flex-1 min-h-0 flex-col overflow-hidden">
            <Tabs.List className="flex flex-shrink-0 border-b border-gray-100 px-4">
              {TABS.map((t) => (
                <Tabs.Trigger
                  key={t.id} value={t.id}
                  className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px',
                    tab === t.id ? 'border-primary-500 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700')}
                >
                  {t.label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
              {/* 常规 */}
              <Tabs.Content forceMount value="general" className="space-y-3">
                <TextField label="数据元名称" value={draft.name} onChange={(v) => patch({ name: v })} placeholder="如 主诉" />
                <CodeBadge element={initial.element} />
                <TextField label="控件标签 (旁注)" value={draft.label} onChange={(v) => patch({ label: v })} placeholder="如 主诉：" />
                <div className="flex flex-wrap gap-x-6 gap-y-1 pt-1">
                  <ToggleField label="必填" checked={draft.required} onChange={(v) => patch({ required: v })} />
                  <ToggleField label="只读" checked={draft.readonly} onChange={(v) => patch({ readonly: v })} />
                </div>
              </Tabs.Content>

              {/* 格式 */}
              <Tabs.Content forceMount value="format" className="space-y-3">
                <Field label="控件形态 (决定控件类型)">
                  <div className="flex flex-wrap gap-2">
                    {KIND_OPTIONS.map((o) => (
                      <button
                        key={o.value} type="button"
                        onClick={() => patch({ kind: o.value })}
                        className={cn('px-3 py-1.5 text-xs rounded-md border transition-colors',
                          draft.kind === o.value ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </Field>
                <p className="text-xs text-gray-400">控件样式：{kindLabel}</p>

                {draft.kind === 'N' && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="数字展示">
                      <select
                        className={inputCls}
                        value={draft.showType ?? ''}
                        onChange={(e) => patch({ showType: e.target.value === '' ? undefined : e.target.value as 'AN' | 'N' })}
                      >
                        <option value="">默认</option>
                        <option value="N">数值 (右对齐)</option>
                        <option value="AN">文本数字</option>
                      </select>
                    </Field>
                  </div>
                )}

                {draft.kind === 'select' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-600">候选项</span>
                      <button type="button" onClick={addOption} className="text-xs text-blue-600 hover:text-blue-700">+ 添加选项</button>
                    </div>
                    {draft.options.map((o, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input className={inputCls} placeholder="名称" value={o.name} onChange={(e) => patchOption(i, { name: e.target.value })} />
                        <input className={inputCls} placeholder="值" value={o.value} onChange={(e) => patchOption(i, { value: e.target.value })} />
                        <input
                          className={inputCls} placeholder="数值(可选)"
                          value={o.numericValue ?? ''}
                          onChange={(e) => {
                            const s = e.target.value.trim()
                            patchOption(i, { numericValue: s === '' ? undefined : (Number.isFinite(Number(s)) ? Number(s) : o.numericValue) })
                          }}
                        />
                        <button type="button" onClick={() => removeOption(i)} className="text-gray-400 hover:text-red-500" aria-label="删除选项">×</button>
                      </div>
                    ))}
                    <ToggleField label="允许多选" checked={draft.multiple} onChange={(v) => patch({ multiple: v })} />
                  </div>
                )}
              </Tabs.Content>

              {/* 校验 */}
              <Tabs.Content forceMount value="validate" className="space-y-3">
                {draft.kind === 'S1' && (
                  <div className="grid grid-cols-2 gap-3">
                    <NumField label="最小长度" value={draft.minLength} min={0} onChange={(v) => patch({ minLength: v })} placeholder="不限" />
                    <NumField label="最大长度" value={draft.maxLength} min={0} onChange={(v) => patch({ maxLength: v })} placeholder="不限" />
                  </div>
                )}
                {draft.kind === 'N' && (
                  <NumField label="小数位数 (scale)" value={draft.scale} min={0} max={6} onChange={(v) => patch({ scale: v })} placeholder="不限" />
                )}
                {draft.kind === 'D' && (
                  <p className="text-xs text-gray-400">日期按 YYYY-MM-DD 存储与校验。</p>
                )}
              </Tabs.Content>

              {/* 其他 */}
              <Tabs.Content forceMount value="other" className="space-y-3">
                <TextField label="前缀" value={draft.prefix} onChange={(v) => patch({ prefix: v })} placeholder="框前字面量" />
                <TextField label="后缀" value={draft.suffix} onChange={(v) => patch({ suffix: v })} placeholder="框后字面量" />
                <TextField label="提示 (tips)" value={draft.tips} onChange={(v) => patch({ tips: v })} placeholder="悬浮提示" />
                <div className="flex flex-wrap gap-x-6 gap-y-1 pt-1">
                  <ToggleField label="可删除" checked={draft.deletable} onChange={(v) => patch({ deletable: v })} />
                  <ToggleField label="可填写" checked={draft.editable} onChange={(v) => patch({ editable: v })} />
                  <ToggleField label="单值 (数据元唯一)" checked={draft.single} onChange={(v) => patch({ single: v })} />
                </div>
              </Tabs.Content>
            </div>
          </Tabs.Root>

          {/* Footer */}
          <div className="flex flex-shrink-0 justify-end gap-2 border-t bg-gray-50 px-4 py-3">
            <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md text-gray-600 hover:bg-gray-100">取消</button>
            <button
              onClick={() => { if (result) onApply(result) }}
              className="px-4 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"
            >
              {mode === 'create' ? '插入' : '应用'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
