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
// ================================================================

import type { ControlValueRejectReason } from '@/engine'

const MESSAGES: Record<ControlValueRejectReason, string> = {
  write_locked: '该字段为只读，不可修改',
  type_mismatch: '值的类型不正确',
  enum_value_not_allowed: '不在候选项中',
  number_scale_exceeded: '数值精度超出限制',
  string_length_out_of_range: '字符长度超出限制',
  date_format_invalid: '日期格式应为 YYYY-MM-DD',
  datetime_format_invalid: '日期时间格式应为 YYYY-MM-DD HH:mm:ss',
}

export function controlRejectMessage(reason: ControlValueRejectReason): string {
  return MESSAGES[reason] ?? '输入不合法'
}
