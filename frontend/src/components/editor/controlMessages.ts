// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// controlMessages — 控件校验拒绝原因 → 用户提示文案 (UI 层)
//
// 引擎只返回 ControlValueRejectReason 枚举 (§12.6), 文案属 UI; 此处集中映射,
// 供 RuntimeControlOverlay 就地提示。
//
// v6.1: 文案走 i18n。**纯函数不能挂 hook** —— t() 由调用方 (RuntimeControlOverlay)
// 注入; 未注入时回退 zh-CN 字面量 (兼容既有调用方与测试)。
// ================================================================

import type { ControlValueRejectReason } from '@/engine'
import type { LocaleMessages, LocaleParams } from '@/engine'

/** 翻译函数形态 (由调用方注入 useTranslation().t) */
type T = (key: keyof LocaleMessages, params?: LocaleParams) => string

/** reject reason → i18n 键 (单一映射, 不重复两份字面量) */
const MESSAGE_KEYS: Record<ControlValueRejectReason, keyof LocaleMessages> = {
  write_locked: 'control.reject.writeLocked',
  type_mismatch: 'control.reject.typeMismatch',
  enum_value_not_allowed: 'control.reject.enumValueNotAllowed',
  number_scale_exceeded: 'control.reject.numberScaleExceeded',
  string_length_out_of_range: 'control.reject.stringLengthOutOfRange',
  date_format_invalid: 'control.reject.dateFormatInvalid',
  datetime_format_invalid: 'control.reject.datetimeFormatInvalid',
}

/**
 * 拒绝原因 → 用户提示。
 *
 * @param reason 引擎返回的拒绝原因枚举
 * @param t      可选的翻译函数 (useTranslation().t); 缺省回退 zh-CN 字面量
 */
export function controlRejectMessage(reason: ControlValueRejectReason, t?: T): string {
  const key = MESSAGE_KEYS[reason]
  if (t && key) return t(key)
  return FALLBACK[reason] ?? '输入不合法'
}

/** zh-CN 兜底 (t 未注入时) —— 与 control.reject.* 的 zh-CN 值保持一致 */
const FALLBACK: Record<ControlValueRejectReason, string> = {
  write_locked: '该字段为只读，不可修改',
  type_mismatch: '值的类型不正确',
  enum_value_not_allowed: '不在候选项中',
  number_scale_exceeded: '数值精度超出限制',
  string_length_out_of_range: '字符长度超出限制',
  date_format_invalid: '日期格式应为 YYYY-MM-DD',
  datetime_format_invalid: '日期时间格式应为 YYYY-MM-DD HH:mm:ss',
}