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

interface ControlChoiceDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  initial: ControlConfigData
  onClose: () => void
  onApply: (result: ControlConfigData) => void
}

const TABS = [
  { id: 'type', label: '控件类型' },
  { id: 'base', label: '基础属性' },
  { id: 'options', label: '选项设置' },
  { id: 'numeric', label: '数值属性' },
  { id: 'list', label: '项目列表' },
] as const
type TabId = (typeof TABS)[number]['id']

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

const THEAD = 'text-xs font-medium text-gray-500 border-b border-gray-100 px-1.5 py-1 text-left whitespace-nowrap'
const CELL = 'px-1.5 py-1 align-middle'

export function ControlChoiceDialog({
  open, mode, initial, onClose, onApply,
}: ControlChoiceDialogProps) {
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
        <Dialog.Content onCloseAutoFocus={(e) => e.preventDefault()} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 flex max-h-[85vh] w-[620px] flex-col overflow-hidden bg-white rounded-lg shadow-xl border border-gray-200">
          <div className="flex flex-shrink-0 items-center justify-between px-4 py-3 border-b border-gray-100">
            <Dialog.Title className="text-sm font-semibold text-gray-800">
              {mode === 'create' ? '新建单选/复选' : `控件配置 · ${initial.element.name || '单选复选'}`}
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
              {/* 控件类型 */}
              <Tabs.Content forceMount value="type" className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { key: false, label: '单选框', desc: '每次仅可选中一项' },
                    { key: true, label: '复选框', desc: '可同时选中多项' },
                  ] as const).map((o) => (
                    <button
                      key={String(o.key)} type="button"
                      onClick={() => patch({ multiple: o.key })}
                      className={cn('text-left px-3 py-2.5 rounded-md border transition-colors',
                        draft.multiple === o.key ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50')}
                    >
                      <div className={cn('text-sm font-medium', draft.multiple === o.key ? 'text-blue-700' : 'text-gray-700')}>{o.label}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{o.desc}</div>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400">单选/复选候选项取值均为文本；复选 = 多选枚举，单选 = 单选枚举。</p>
              </Tabs.Content>

              {/* 基础属性 */}
              <Tabs.Content forceMount value="base" className="space-y-3">
                <TextField label="数据元名称" value={draft.name} onChange={(v) => patch({ name: v })} placeholder="如 症状" />
                <CodeBadge element={initial.element} />
                <TextField label="控件标签 (旁注)" value={draft.label} onChange={(v) => patch({ label: v })} placeholder="如 症状：" />
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 pt-1">
                  <ToggleField label="必填" checked={draft.required} onChange={(v) => patch({ required: v })} />
                  <ToggleField label="只读" checked={draft.readonly} onChange={(v) => patch({ readonly: v })} />
                  <ToggleField label="可删除" checked={draft.deletable} onChange={(v) => patch({ deletable: v })} />
                  <ToggleField label="可填写" checked={draft.editable} onChange={(v) => patch({ editable: v })} />
                  <ToggleField label="单值 (数据元唯一)" checked={draft.single} onChange={(v) => patch({ single: v })} />
                </div>
                <div className="pt-1">
                  <ToggleField label="允许输入自定义值 (不在候选项内)" checked={draft.enumEditable === true} onChange={(v) => patch({ enumEditable: v ? true : undefined })} />
                </div>
              </Tabs.Content>

              {/* 选项设置 */}
              <Tabs.Content forceMount value="options" className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500">候选项</span>
                  <button type="button" onClick={addOpt} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
                    <Plus size={13} /> 新增选项
                  </button>
                </div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={THEAD}>名称</th>
                      <th className={THEAD}>值</th>
                      <th className={cn(THEAD, 'w-14 text-center')}>互斥</th>
                      <th className={cn(THEAD, 'w-8')}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.options.map((o, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className={CELL}>
                          <input className={inputCls} value={o.name} placeholder="名称" onChange={(e) => setOpt(i, { name: e.target.value })} />
                        </td>
                        <td className={CELL}>
                          <input className={inputCls} value={o.value} placeholder="值" onChange={(e) => setOpt(i, { value: e.target.value })} />
                        </td>
                        <td className={cn(CELL, 'text-center')}>
                          <input type="checkbox" checked={o.exclusive === true} onChange={(e) => setOpt(i, { exclusive: e.target.checked ? true : undefined })} />
                        </td>
                        <td className={cn(CELL, 'text-center')}>
                          <button type="button" aria-label={`删除选项 ${i + 1}`} onClick={() => removeOpt(i)} className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    ))}
                    {draft.options.length === 0 && (
                      <tr><td colSpan={4} className={cn(CELL, 'text-center text-xs text-gray-300 py-3')}>暂无候选项，点右上角新增</td></tr>
                    )}
                  </tbody>
                </table>
              </Tabs.Content>

              {/* 数值属性 */}
              <Tabs.Content forceMount value="numeric" className="space-y-3">
                <p className="text-xs text-gray-400">为每个候选项(项目)附加一个数值(如评分/权重)；不填表示无。</p>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={THEAD}>项目</th>
                      <th className={cn(THEAD, 'w-28')}>数值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.options.map((o, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className={CELL}>
                          <span className="text-sm text-gray-700">{o.name || o.value || '(空)'}</span>
                          {o.value !== o.name && o.name ? <span className="ml-1 text-xs text-gray-300">({o.value})</span> : null}
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
                    {draft.options.length === 0 && <tr><td colSpan={2} className={cn(CELL, 'text-center text-xs text-gray-300 py-3')}>暂无候选项</td></tr>}
                  </tbody>
                </table>
              </Tabs.Content>

              {/* 项目列表 */}
              <Tabs.Content forceMount value="list" className="space-y-3">
                <p className="text-xs text-gray-400">项目列表与选项/数值同源；可调序或快速删除。</p>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={cn(THEAD, 'w-8')}>#</th>
                      <th className={THEAD}>项目 (值)</th>
                      <th className={cn(THEAD, 'w-16 text-center')}>数值</th>
                      <th className={cn(THEAD, 'w-8')}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.options.map((o, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className={cn(CELL, 'text-center text-xs text-gray-400')}>{i + 1}</td>
                        <td className={CELL}>
                          <span className="text-sm text-gray-700">{o.name || '(空名)'}</span>
                          {o.value !== o.name && o.name ? <span className="ml-1 text-xs text-gray-300">({o.value})</span> : null}
                        </td>
                        <td className={cn(CELL, 'text-center text-xs text-gray-500')}>{o.numericValue ?? '—'}</td>
                        <td className={cn(CELL, 'whitespace-nowrap text-right')}>
                          <button type="button" aria-label="上移" disabled={i === 0} onClick={() => moveOpt(i, -1)} className="text-gray-400 hover:text-gray-600 disabled:opacity-30"><ArrowUp size={13} /></button>
                          <button type="button" aria-label="下移" disabled={i === draft.options.length - 1} onClick={() => moveOpt(i, 1)} className="ml-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"><ArrowDown size={13} /></button>
                          <button type="button" aria-label={`删除 ${rowRead(i)?.value || ''}`} onClick={() => removeOpt(i)} className="ml-1 text-gray-300 hover:text-red-500"><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    ))}
                    {draft.options.length === 0 && <tr><td colSpan={4} className={cn(CELL, 'text-center text-xs text-gray-300 py-3')}>暂无候选项</td></tr>}
                  </tbody>
                </table>
              </Tabs.Content>
            </div>
          </Tabs.Root>

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
