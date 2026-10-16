// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ElementIdentity — 数据元身份的唯一判据 (契约 §12.1 / §12.10.1)
//
// 此前这条规则住在 command/commands/InsertNodesCommand.ts 里, 只服务粘贴的
// single 守卫。数据绑定 (§12.10) 需要同一条规则来算绑定键 —— 若就地复制一份,
// 「哪个字段是什么」这个事实就有了两份实现, 必然漂移 (§11)。
//
// 故把规则下沉到 document/control/: 命令层与投影层都读它。层级方向本来就是
// command → document (§19), 下沉后无环。
//
// 关键约束: 回退顺序 (dataElement → internal) 在任何调用点上都必须一致。
// InsertNodesCommand 的 single 守卫、InsertControlCommand 的重复身份守卫、
// ControlProjection 的默认绑定键, 三者共用本文件 —— 不得各自规定优先级。
// ================================================================

import type { ElementMeta } from '../core/DocumentModel'

/**
 * 数据元身份: dataElement 优先, 回退 internal (契约 §12.1 single 守卫)。
 * 两者皆空 → 无规范身份 → 不参与唯一性约束 (返回 null)。
 */
export function elementIdentity(element: ElementMeta | undefined | null): string | null {
  if (!element?.code) return null
  const de = element.code.dataElement?.trim()
  if (de) return de
  const internal = element.code.internal?.trim()
  return internal || null
}

/**
 * 数据绑定的默认键 (契约 §12.10.1) —— 与 elementIdentity **同一顺序**,
 * 刻意不另立一套。差别只在返回值: 绑定键是 string (无身份时为空串,
 * 便于分组与回报), 身份判据是 string | null (无身份时明确"不参与约束")。
 */
export function defaultBindingKey(element: ElementMeta | undefined | null): string {
  return elementIdentity(element) ?? ''
}
