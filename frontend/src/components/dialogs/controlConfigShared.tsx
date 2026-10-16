// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

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

import { useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { controlWidgetById } from '@/platform/data/controlLibrary'
import { DICTIONARY_CATALOG } from '@/platform/data/dictionaryCatalog'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/useTranslation'
import type {
  CalcErrorCode, CalcResult, ElementMeta, ElementEnumOption, LocaleMessages, TemplateDefinition,
} from '@emrde/document-engine'

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
  // 输入族含 select/datetime (输入域弹框已覆盖 纯文本/数字/日期/日期时间/下拉)
  if (ct === 'input' || ct === 'textarea' || ct === 'number' || ct === 'date' ||
      ct === 'datetime' || ct === 'select') return 'input'
  if (ct === 'radio' || ct === 'checkbox') return 'choice'
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
  'w-full text-sm px-2.5 py-1.5 border border-line rounded-md focus:outline-none ' +
  'focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-chrome'
export const fieldLabelCls = 'text-xs font-medium text-chrome-ink-secondary mb-1 flex items-center gap-1.5'

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
    <label className="flex cursor-pointer items-center gap-2 text-sm text-chrome-ink-body">
      <input type="checkbox" checked={checked === true} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 rounded border-line-strong" />
      <span>{label}</span>
    </label>
  )
}

export function CodeBadge({ element }: { element: ElementMeta }) {
  const { t } = useTranslation()
  const { internal, dataElement } = element.code
  return (
    <div className="rounded-md bg-chrome-subtle border border-line-subtle px-2.5 py-1.5 text-xs text-chrome-ink-tertiary space-y-0.5">
      <div>{t('controlConfig.codeBadge.internal')}<span className="text-chrome-ink-body font-mono">{internal}</span></div>
      <div>{t('controlConfig.codeBadge.dataElement')}<span className="text-chrome-ink-body font-mono">{dataElement}</span></div>
    </div>
  )
}

// ---- 语义身份可编辑 (契约 §12.5 / §12.10.1) ----

/**
 * 把 draft 里的两个身份键写回 element.code。
 *
 * 两键**都 trim**: `elementIdentity` 判身份时也 trim, 留着首尾空格会让"看着一样的
 * 两个键"算成不同键 —— 于是绑定撞不上、single 守卫也认不出重复。
 *
 * 不新增命令: `applyControlConfig` 的 elementEquals 走 stableStringify 全字段比较,
 * `code` 本就在 payload 里, 改它天然触发 UpdateControlElementCommand (契约 §12.5)。
 */
export function semanticCodeOf(internal: string, dataElement: string): ElementMeta['code'] {
  return { internal: internal.trim(), dataElement: dataElement.trim() }
}

/**
 * 生效的绑定键 (契约 §12.10.1): dataElement 优先, 空回退 internal —— 与
 * `elementIdentity` 同一顺序, 不另立一套。空串 = 该控件无规范身份。
 */
export function effectiveBindingKeyOf(internal: string, dataElement: string): string {
  return dataElement.trim() || internal.trim()
}

/**
 * 语义身份的两个输入框 + 撞键提示 (契约 §12.5)。
 *
 * 抽出来是因为**两个**控件配置弹框都要它 (输入域 / 单选复选), 而它带着一条真规则:
 * 绑定的生效键是"数据元码优先", 撞键计数要**排除被编辑的控件自身** —— 提示回答的是
 * "改完之后会跟谁撞", 不是"现在跟谁撞"。排除自身后, create/edit 两种模式共用同一条
 * 判定 (others ≥ 1 即撞), 展示的 n 再把自己算回去。§11: 第二次实现即须抽取。
 *
 * 数据元码排在标识之前 —— 它是默认绑定键。
 */
export function SemanticIdentityFields({
  internal, dataElement, onChange, otherKeyUsage,
}: {
  internal: string
  dataElement: string
  onChange: (patch: { internal?: string; dataElement?: string }) => void
  /** **其他**控件占用各键的次数 (不含被编辑控件); 缺省 = 不提示 */
  otherKeyUsage?: ReadonlyMap<string, number>
}) {
  const { t } = useTranslation()
  const key = effectiveBindingKeyOf(internal, dataElement)
  const others = key === '' ? 0 : (otherKeyUsage?.get(key) ?? 0)
  return (
    <>
      <TextField
        label={t('controlConfig.code.dataElementLabel')}
        value={dataElement}
        onChange={(v) => onChange({ dataElement: v })}
        placeholder={t('controlConfig.code.dataElementPlaceholder')}
      />
      <TextField
        label={t('controlConfig.code.internalLabel')}
        value={internal}
        onChange={(v) => onChange({ internal: v })}
        placeholder={t('controlConfig.code.internalPlaceholder')}
      />
      <p className="text-[11px] leading-relaxed text-chrome-ink-muted">{t('controlConfig.code.hint')}</p>
      {/* 撞键不阻断应用 —— 重复身份是**合法**文档状态, 只是绑定会报歧义 (§12.10.2) */}
      {others >= 1 && (
        <p className="text-[11px] leading-relaxed text-amber-600">
          {t('controlConfig.code.dupHint', { n: others + 1 })}
        </p>
      )}
    </>
  )
}

// 类型守卫 (用于选择控件是否显示某字段)
// ---- 数据绑定 (码表) ----

/**
 * 码表绑定只在**下拉 (select)** 形态开放。
 *
 * 为什么不是「枚举族全开放」: radio/checkbox 按定义靠 inline 候选集工作，
 * 而 §12.6.4 规定 inline enums 恒优先 —— 给它们绑码表等于发布一个可证明
 * 不生效的控件。select 则可以「无 inline 候选、候选全来自码表」, 是
 * format.dictionary 唯一有意义的落点。
 *
 * 也不把码表开放给纯文本 S1: 绑定会让控件变成 enum-backed (VR-9 严格
 * 成员校验), 那是**交互形态**的改变; 由「绑定码表」隐式推导出 select
 * 等于让 controlType 从数据推导, 与 VR-15 冲突。
 */

/** 码表 id 形状 (契约 §12.6.4: 32 位 hex)。格式不合规不阻断保存, 只提示。 */
export function isDictionaryIdLike(id: string): boolean {
  return /^[0-9a-f]{32}$/.test(id)
}

/**
 * 码表绑定字段：已加载码表下拉 + 手动粘贴 id + 清空。
 *
 * 候选值来源是平台侧目录 (platform/data), 与注入给 Editor 的
 * DictionaryStore 同源 —— 这里只呈现「可绑定什么」, 解析仍由引擎在
 * 命令边界走 DictionaryProvider (§12.6.4)。
 */
export function DictionaryField({
  value, onChange, inlineEnumsPresent,
}: {
  value: string
  onChange: (v: string) => void
  /** 控件自身已声明 inline 候选 → 码表恒被覆盖 (§12.6.4), 提示死数据 */
  inlineEnumsPresent?: boolean
}) {
  const { t } = useTranslation()
  const known = DICTIONARY_CATALOG.some((e) => e.id === value)
  return (
    <div className="space-y-3">
      <Field label={t('controlConfig.dict.label')}>
        <select
          className={inputCls}
          value={known ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{t('controlConfig.dict.unbound')}</option>
          {DICTIONARY_CATALOG.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
      </Field>

      <Field label={t('controlConfig.dict.idLabel')}>
        <div className="flex items-center gap-2">
          <input
            className={inputCls}
            value={value}
            placeholder={t('controlConfig.dict.idPlaceholder')}
            onChange={(e) => onChange(e.target.value.trim())}
          />
          <button
            type="button"
            onClick={() => onChange('')}
            disabled={value === ''}
            className="flex-shrink-0 text-xs text-chrome-ink-tertiary hover:text-red-500 disabled:text-chrome-ink-disabled"
          >
            {t('controlConfig.dict.clear')}
          </button>
        </div>
      </Field>

      {value !== '' && !isDictionaryIdLike(value) && (
        <p className="text-xs text-amber-600">
          {t('controlConfig.dict.badIdHint')}
        </p>
      )}
      {value !== '' && inlineEnumsPresent === true && (
        <p className="text-xs text-amber-600">
          {t('controlConfig.dict.inlineOverrideHint')}
        </p>
      )}
      <p className="text-xs text-chrome-ink-muted">
        {t('controlConfig.dict.platformHint')}
      </p>
    </div>
  )
}

export type { ElementEnumOption }

// ---- 计算式撰写 (契约 §12.12.9) ----

/**
 * 文档里**可引用的键** —— 来自 `Editor.getBoundValues()` 的同一份投影。
 *
 * 为什么不在这里现读 Editor: 弹框只持本地 draft (§12.7), 文档快照由调用方在打开
 * 时给 (§12.12.9 的"同一份清单"要求: 与撞键提示同源, 否则必然漂移成"UI 说能引用、
 * 求值说歧义"这种最难查的形态)。
 */
export interface ReferenceKey {
  key: string
  /** 控件名 —— 作者按名字认字段, 光看码认不出来 */
  name: string
  /** 该键命中 ≥2 个控件: 公式引用它**必报歧义** (§12.12.3), 只提示不拦 */
  ambiguous: boolean
}

/** 错误码 → 文案键 (§12.12.9: 错误必须**分类**可判定, 不许塌成"公式有误") */
const FORMULA_ERROR_KEYS: Record<CalcErrorCode, keyof LocaleMessages> = {
  syntax: 'controlConfig.formula.err.syntax',
  unresolved_reference: 'controlConfig.formula.err.unresolved',
  ambiguous_reference: 'controlConfig.formula.err.ambiguous',
  unknown_function: 'controlConfig.formula.err.unknownFunction',
  bad_arguments: 'controlConfig.formula.err.badArguments',
  empty_reference: 'controlConfig.formula.err.empty',
  not_a_number: 'controlConfig.formula.err.notANumber',
  cycle: 'controlConfig.formula.err.cycle',
  conflicting_visibility: 'controlConfig.formula.err.conflictingVisibility',
  not_displayable: 'controlConfig.formula.err.notDisplayable',
}

/**
 * 公式撰写字段 + 试算 + 可引用键清单 (契约 §12.12.9)。
 *
 * **两个弹框共用这一个** —— 输入域与单选复选。批次一吃过"同一条契约条款只兑现一半
 * 控件"的亏 (语义身份只给了输入域弹框), 这次一条款要从两个弹框同时进。
 *
 * 三条立场:
 *   1. 错误**只提示不拦**: 作者可能正写到一半, 硬拦会把"存草稿"变成不可能 ——
 *      与 §12.10.2 的撞键提示同一姿势。这个组件不碰 onApply, 也拦不住它。
 *   2. 试算走调用方注入的 `preview` (实际就是 `Editor.evaluateFormula`), 本组件
 *      **不认识求值器**。引擎侧的错误已是分类的, 这里只做码 → 文案。
 *   3. 键是**绑定键** (§12.10.1), 点一下插到光标处 —— 手打 `[数据元码]` 是错字温床。
 */
export function FormulaField({
  value, onChange, referenceKeys, preview,
}: {
  value: string
  onChange: (v: string) => void
  referenceKeys?: readonly ReferenceKey[]
  /** 引擎侧试算; 缺省 = 不显示试算行 (单测/无引擎时) */
  preview?: (formula: string) => CalcResult
}) {
  const { t } = useTranslation()
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const trimmed = value.trim()

  const result = useMemo(
    () => (trimmed === '' || !preview ? null : preview(trimmed)),
    [trimmed, preview],
  )

  const insert = (key: string) => {
    const token = `[${key}]`
    const el = areaRef.current
    if (!el) { onChange(value + token); return }
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? start
    onChange(value.slice(0, start) + token + value.slice(end))
    // 受控组件: 值要等重渲染才落, 故光标在下一帧设
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + token.length
      el.setSelectionRange(pos, pos)
    })
  }

  return (
    <div className="space-y-3">
      <Field label={t('controlConfig.formula.label')}>
        <textarea
          ref={areaRef}
          className={cn(inputCls, 'font-mono text-xs leading-relaxed resize-y min-h-[64px]')}
          value={value}
          placeholder={t('controlConfig.formula.placeholder')}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      </Field>

      <p className="text-[11px] leading-relaxed text-chrome-ink-muted">{t('controlConfig.formula.hint')}</p>

      {/* 试算结果 —— 值公式给值, 触发式给"谁可见/隐藏" */}
      {result && (
        result.ok ? (
          result.role === 'value' ? (
            <p className="text-[11px] leading-relaxed text-emerald-600">
              {t('controlConfig.formula.previewValue', { value: String(result.value) })}
            </p>
          ) : (
            <p className="text-[11px] leading-relaxed text-emerald-600">
              {t('controlConfig.formula.previewVisibility', {
                key: result.directive.key,
                state: t(result.directive.visible ? 'controlConfig.formula.visible' : 'controlConfig.formula.hidden'),
              })}
            </p>
          )
        ) : (
          <p className="text-[11px] leading-relaxed text-amber-600">
            {t(FORMULA_ERROR_KEYS[result.error.code])}
            {result.error.candidateNodeIds ? ` (${result.error.candidateNodeIds.length})` : ''}
          </p>
        )
      )}

      <div>
        <span className={fieldLabelCls}>{t('controlConfig.formula.keysLabel')}</span>
        {(referenceKeys ?? []).length === 0 ? (
          <p className="text-[11px] leading-relaxed text-chrome-ink-muted">{t('controlConfig.formula.keysEmpty')}</p>
        ) : (
          <div className="max-h-32 overflow-y-auto rounded-md border border-line-subtle bg-chrome-subtle p-1.5">
            <div className="flex flex-wrap gap-1">
              {(referenceKeys ?? []).map((k) => (
                <button
                  key={k.key}
                  type="button"
                  onClick={() => insert(k.key)}
                  title={k.ambiguous ? t('controlConfig.formula.ambiguousHint') : k.key}
                  className={cn(
                    'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-mono',
                    'border hover:bg-chrome-hover',
                    k.ambiguous
                      ? 'border-amber-400 text-amber-700'
                      : 'border-line-subtle text-chrome-ink-body',
                  )}
                >
                  {k.name}
                  <span className="text-chrome-ink-muted">[{k.key}]</span>
                  {k.ambiguous && <span className="not-italic">{t('controlConfig.formula.ambiguous')}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
