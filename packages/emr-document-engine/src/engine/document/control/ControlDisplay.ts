// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ControlDisplay — 控件「值 → 显示文本」与「候选来源」的唯一实现
// (契约 §11 / §12.6.4 / §12.10.4)
//
// 为什么这两个函数住在引擎而不是导出层: 绑定 API (§12.10) 与导出投影
// (lib/export/fields) 必须给出**逐字相同**的 display 与候选集, 否则同一份
// 文档在两个消费方眼里值不一样。而它俩此前只有导出层一份 —— 绑定要用,
// 就地复制就成第二份 (§11: 非平凡逻辑第二次出现即须抽取)。
//
// 层级: 调用方向是 lib → engine (§19 允许且既定的方向), 所以下沉到
// document/control/ 不引入任何环。导出层改为 import 本文件, 语义一字未改。
//
// 与渲染口径的关系 (刻意保留的差异, 不得顺手"修掉"):
//   渲染路径 (LayoutEngine → ElementFormatter.controlValueDisplay) 只读
//   inline format.enums.data, **读不到字典候选** —— 于是字典型枚举在屏幕上
//   显示的是机器码 (本引擎的一处渲染缺口)。
//   本文件按 inline 优先 / 否则字典候选 解析, 因此能给出显示名。
//   两条路径的差异由 DisplaySource 显式化: 数据路径给出 'enum' 时, 屏幕可能
//   仍是机器码。对齐两者是**另一件事**, 不得夹带进绑定或导出特性。
// ================================================================

import type { ControlValue, ElementEnumOption, ElementMeta } from '../core/DocumentModel'

/** 显示值来源 —— 让「为什么这一条是机器码」可判定, 而不是靠猜 */
export type DisplaySource =
  /** 未填, display 是占位符 */
  | 'placeholder'
  /** 值经候选表映射成了显示名 */
  | 'enum'
  /** 值未经映射原样输出 (无候选表, 或候选表里查不到该码) */
  | 'raw'

export interface DisplayResult {
  display: string
  source: DisplaySource
}

/**
 * 枚举候选: inline `format.enums` 存在则用它, 否则用注入的字典型来源 ——
 * 与 Editor.getControlSnapshot 同一优先级 (§12.6.4: inline 恒优先)。
 *
 * 「存在」指**键存在**, 不是「有内容」: 一个 present-but-empty 的 enums
 * 对象 (如 `{data: []}`) **抑制**字典绑定 (§12.6.4)。故判断是
 * `inline !== undefined`, 而非 `inline.data?.length`。
 */
export function enumOptionsFor(
  nodeId: string,
  element: ElementMeta | undefined,
  optionsOf?: (nodeId: string) => readonly ElementEnumOption[] | undefined,
): ElementEnumOption[] | null {
  const inline = element?.format?.enums
  if (inline !== undefined) {
    return inline.data && inline.data.length > 0 ? inline.data : null
  }
  const external = optionsOf?.(nodeId)
  return external && external.length > 0 ? [...external] : null
}

/**
 * 值 → 显示文本。
 *
 * 未填 (undefined / '' / []) → 占位符, source='placeholder'。
 * 数值 → 原样字符串, source='raw' (数值无候选可映射)。
 * 字符串 / 字符串数组 → 命中候选则用候选 name, 否则原样。
 */
export function resolveDisplay(
  value: ControlValue | undefined,
  placeholder: string,
  options: ElementEnumOption[] | null,
): DisplayResult {
  if (value === undefined || value === '') return { display: placeholder, source: 'placeholder' }
  if (typeof value === 'number') return { display: String(value), source: 'raw' }

  const nameOf = (v: string): { text: string; matched: boolean } => {
    const hit = options?.find((o) => o.value === v)
    return hit ? { text: hit.name, matched: true } : { text: v, matched: false }
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return { display: placeholder, source: 'placeholder' }
    const mapped = value.map(nameOf)
    return {
      display: mapped.map((m) => m.text).join('、'),
      source: mapped.some((m) => m.matched) ? 'enum' : 'raw',
    }
  }

  const m = nameOf(value)
  return { display: m.text, source: m.matched ? 'enum' : 'raw' }
}
