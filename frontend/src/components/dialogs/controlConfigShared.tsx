// ================================================================
// controlConfigShared — 控件配置弹框共享层 (契约 §12.7)
//
// 边界: 弹框只持有「临时 draft」, 不建第三套长期模型; Apply 时再组装成
// ElementMeta + TemplateDefinition (契约 §12.7: 不得引入第二份持久语义
// 事实源)。本文件放: 家族判别 / create 种子 / 深度克隆 / 小型表单控件。
//
// legacy 路由 (不回写): controlFamilyOf 决定该控件双击打开哪个弹框。
// controlType 仅在 create / 真实类型编辑 (输入域 dataType 变 / 单选复选
// multiple 变) 时由弹框显式落盘; 无类型编辑则保持原 def.controlType
// (undefined / select 等不动), 杜绝「打开即迁移」(VR-15)。
// ================================================================

import type { ReactNode } from 'react'
import { controlWidgetById } from '@/platform/data/controlLibrary'
import type {
  ElementFormat, ElementMeta, ElementEnumOption, TemplateDefinition,
} from '@/engine'

// ---- 家族 / 向导类型 ----

/** 弹框家族: 输入域 (文本/多行/数字/日期) vs 单选复选 (radio/checkbox) */
export type ControlFamily = 'input' | 'choice'
/** 工具栏 3 类向导种子 */
export type ControlKind = 'textInput' | 'radio' | 'checkbox'

/** 弹框产出 = 现有两层模型 (不引入第三套模型) */
export interface ControlConfigData {
  element: ElementMeta
  definition?: TemplateDefinition
}

/** 深克隆 (draft 初值 / 防污染 live element) — 纯数据 JSON 克隆 */
export function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 路由用家族判别 (绝不回写, 契约 §12.7 legacy):
 *   def.controlType ∈ 输入族 → input; radio/checkbox(/select) → choice;
 *   undefined → 有 enums/multiple 走 choice, 否则按 dataType 走 input。
 */
export function controlFamilyOf(element: ElementMeta, definition?: TemplateDefinition): ControlFamily {
  const ct = definition?.controlType
  if (ct === 'input' || ct === 'textarea' || ct === 'number' || ct === 'date') return 'input'
  if (ct === 'radio' || ct === 'checkbox' || ct === 'select') return 'choice'
  const fmt = element.format
  if (fmt !== undefined && fmt.enums !== undefined) return 'choice'
  return 'input'
}

/** create 向导种子: 复用通用控件目录既有 element+definition (仅作初值, 可再编辑) */
export function initialConfigForCreate(kind: ControlKind): ControlConfigData {
  const id = kind === 'textInput' ? 'input' : kind
  const entry = controlWidgetById(id)
  if (!entry) {
    // 兜底 (理论上不可达): 中性 input 种子
    return {
      element: { code: { internal: `CTL_${kind}`, dataElement: 'DE99.99.001' }, name: '', format: { dataType: 'S1' } },
      definition: { controlType: kind === 'checkbox' ? 'checkbox' : kind === 'radio' ? 'radio' : 'input', editable: true },
    }
  }
  // 库条目自带控制台默认 label (如 '文本输入：') — 不作为向导默认, 否则每次插入
  // 都附带一个用户并不想要的标签 (会渲染在控件左侧, 被认为是"多出来的文字")
  const definition = entry.definition ? cloneData(entry.definition) : undefined
  if (definition) delete definition.label
  return { element: cloneData(entry.element), definition }
}

/** 定义 clean (自 DesignControlProperties 迁来): 丢弃空串/undefined 键; 布尔保留 */
export function cleanDefinition(def: TemplateDefinition | undefined): TemplateDefinition | undefined {
  if (!def) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(def)) {
    if (v === undefined) continue
    if (typeof v === 'string' && v === '') continue
    out[k] = v
  }
  return Object.keys(out).length > 0 ? (out as TemplateDefinition) : undefined
}

// ---- 共享小型表单控件 (样式与 DocumentPropertiesDialog / PageSetupDialog 对齐) ----

export const inputCls =
  'w-full text-sm px-2.5 py-1.5 border border-gray-200 rounded-md focus:outline-none ' +
  'focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-white'
export const fieldLabelCls = 'text-xs font-medium text-gray-600 mb-1 flex items-center gap-1.5'

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className={fieldLabelCls}>{label}</span>
      {children}
    </label>
  )
}

export function TextField({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <Field label={label}>
      <input className={inputCls} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}

export function NumField({
  label, value, onChange, placeholder, min, max, step,
}: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string; min?: number; max?: number; step?: number }) {
  return (
    <Field label={label}>
      <input
        type="number"
        className={inputCls}
        value={value === undefined ? '' : String(value)}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const t = e.target.value.trim()
          onChange(t === '' ? undefined : Number(t))
        }}
      />
    </Field>
  )
}

export function ToggleField({
  label, checked, onChange,
}: { label: string; checked: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
      <input type="checkbox" checked={checked === true} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 rounded border-gray-300" />
      <span>{label}</span>
    </label>
  )
}

export function CodeBadge({ element }: { element: ElementMeta }) {
  const { internal, dataElement } = element.code
  return (
    <div className="rounded-md bg-gray-50 border border-gray-100 px-2.5 py-1.5 text-xs text-gray-500 space-y-0.5">
      <div>内部码：<span className="text-gray-700 font-mono">{internal}</span></div>
      <div>数据元编码：<span className="text-gray-700 font-mono">{dataElement}</span></div>
    </div>
  )
}

// 类型守卫 (用于选择控件是否显示某字段)
export function isTextDataType(dt: ElementFormat['dataType']): boolean {
  return dt === 'S1' || dt === 'S2' || dt === 'S3'
}
export function isMultiTextDataType(dt: ElementFormat['dataType']): boolean {
  return dt === 'S2' || dt === 'S3'
}

export type { ElementEnumOption }
