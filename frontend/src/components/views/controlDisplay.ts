// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ControlDisplay — 控件属性面板的只读展示投影 (契约 §12.5)
//
// 纯函数, 无副作用: 把「控件形态」与「语义身份」投影成面板展示字符串。
// 不产生任何写入 —— 面板展示这些字段时绝不调用 setControlDefinition,
// 故不存在「展示即迁移」的副作用路径 (旧文档 controlType undefined 保持
// undefined, 显示「未指定」, 不回写默认值)。
//
// controlType 的展示名优先复用 i18n 键 (dialog.controlType.*), 与控件配置
// 弹窗的形态按钮同名; 目录 (controlWidgetById) 的 name 仅作 i18n 缺键时的
// 兜底。未知 controlType 兜底显示原始值, 不猜测。
//
// v6.1: 两个函数都接受 t() (纯函数不能挂 hook, 由调用方注入)。
// ================================================================

import type { ControlType } from '@emrde/document-engine'
import type { ElementMeta } from '@emrde/document-engine'
import type { LocaleMessages, LocaleParams } from '@emrde/document-engine'
import { controlWidgetById } from '@/platform/data/controlLibrary'

/** 翻译函数形态 (由调用方注入 useTranslation().t) */
type T = (key: keyof LocaleMessages, params?: LocaleParams) => string

/** controlType → i18n 键 (属性面板展示名, 与控件库目录名一致) */
const CONTROL_TYPE_KEYS: Record<ControlType, keyof LocaleMessages> = {
  input: 'controlDisplay.type.input',
  textarea: 'controlDisplay.type.textarea',
  number: 'controlDisplay.type.number',
  select: 'controlDisplay.type.select',
  date: 'controlDisplay.type.date',
  datetime: 'controlDisplay.type.datetime',
  checkbox: 'controlDisplay.type.checkbox',
  radio: 'controlDisplay.type.radio',
}

/**
 * controlType → 展示名。undefined → 「未指定」; 未知值 → 原始字符串 (不猜)。
 *
 * 展示名优先走 i18n (与配置弹窗同名), 缺键时回退目录 name。
 */
export function controlTypeDisplayName(controlType: ControlType | undefined, t?: T): string {
  if (!controlType) return t ? t('controlDisplay.notSpecified') : '未指定'
  const key = CONTROL_TYPE_KEYS[controlType]
  if (t && key) return t(key)
  return controlWidgetById(controlType)?.name ?? controlType
}

/** 语义身份只读投影 (契约 §12.5: 只读, 不引入命令) */
export interface SemanticIdentity {
  /** 数据元编码 code.dataElement */
  dataElement: string
  /** 取值类型 format.dataType */
  dataType: string
  /** 展示类型 format.showType */
  showType: string
  /** 枚举候选数 (format.enums.data 长度) */
  enums: string
  /** 是否必填 element.required */
  required: string
  /** 是否只读 element.readonly */
  readonly: string
}

/** 从 ElementMeta 投影只读语义身份卡; 无 element (非 smarttext / 旧文档缺语义) → null */
export function semanticIdentityOf(element: ElementMeta | undefined, t?: T): SemanticIdentity | null {
  if (!element) return null
  const f = element.format
  const enums = f?.enums
  const yes = t ? t('common.yes') : '是'
  const no = t ? t('common.no') : '否'
  const dash = '—'   // 占位符, 不翻译
  return {
    dataElement: element.code?.dataElement ?? dash,
    dataType: f?.dataType ?? dash,
    showType: f?.showType ?? dash,
    enums: enums
      ? (t ? t('controlDisplay.itemCount', { n: enums.data?.length ?? 0 }) : `${enums.data?.length ?? 0} 项`)
      : dash,
    required: element.required ? yes : no,
    readonly: element.readonly ? yes : no,
  }
}