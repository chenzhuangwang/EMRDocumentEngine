// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ControlProjection — 控件绑定的阅读顺序投影 (契约 §12.10)
//
// 回答一个问题: 「这份文档里有哪些可绑定控件, 按阅读顺序是什么, 每个的键/
// 值/显示值/候选是什么」。
//
// 顺序**必须**取自既有的顺序原语 (§31), 不得自己走一遍树:
//   正文   → bodyParagraphSpine(doc, pool)         (W3, 含 Section 与 cell 展开)
//   页眉   → hfParagraphsForExport(doc, 'header')  (§7.9 变体归属的唯一实现)
//   页脚   → hfParagraphsForExport(doc, 'footer')
// 这三者本身就在引擎内 (§31 的 W1-W4 是逻辑流的唯一实现), 直接复用即
// "站在事实源上", 不是另写一份遍历。DocumentWalkGate 也照此守。
//
// 为什么不复用 lib/export/fields.ts 的 collectFields (契约 §12.10.4):
//   - engine/ → lib/ 被 §19 禁止 (lib/export/fields.ts:27 已导入 engine barrel,
//     反向一条边即成环; §32 又把 "." 与 "./export" 打成两个 bundle);
//   - collectFields 今天只有应用侧那三处导出调用, **零引擎侧消费者** ——
//     没有东西可共享。
// 接受的重复是「段落 id → smarttext 子节点 id → 记录」这十几行胶水, 不是遍历
// 口径。**不得**为了消掉这段重复而向上 import。
//
// 显示值与候选来源**不是**重复: 两者都读 control/ControlDisplay.ts 的唯一实现,
// 与导出投影逐字相同。
// ================================================================

import type { DocumentTree, ElementEnumOption, ControlValue, ElementMeta } from '../core/DocumentModel'
import { NodeType } from '../core/DocumentModel'
import { bodyParagraphSpine, type SpinePool } from '../selection/SelectionCollector'
import { hfParagraphsForExport } from '../core/HeaderFooterRegions'
import { isControlValueEmpty } from './ControlValue'
import { defaultBindingKey } from './ElementIdentity'
import { enumOptionsFor, resolveDisplay, type DisplaySource } from './ControlDisplay'

/** 绑定条目所在区域 */
export type BoundRegion = 'body' | 'header' | 'footer'

/** 一条可绑定控件 —— 绑定 API 的读方向返回单元 (契约 §12.10.2) */
export interface BoundItem {
  nodeId: string
  /** 所在段落 id —— 供 §12.11 完整性闸门组装 paraPath 让宿主跳转 */
  paragraphId: string
  region: BoundRegion
  /** 绑定键 (按 keyOf 算; 缺省 = dataElement 空回退 internal; 无身份时为空串) */
  key: string
  name: string
  /** 未填时的显示形式 (含方括号, 如 '[姓名]') */
  placeholder: string
  /** 运行期值, **原样** (机器码); 未填为 undefined */
  value: ControlValue | undefined
  /** 显示值 (枚举值映射回候选 name 后) */
  display: string
  /** display 是怎么来的 —— 'raw' 表示该值没能映射成显示名 */
  displaySource: DisplaySource
  /** 是否已填 (undefined / '' / [] 视为未填, 契约 §12.6.1) */
  filled: boolean
  required: boolean
  readonly: boolean
  /** 隐私标记: true 表示受脱敏策略保护 */
  masked: boolean
  /** 枚举候选 (inline 优先, 否则注入的字典型来源); 无候选为 null */
  enumOptions: ElementEnumOption[] | null
}

/** 一键多节点的点名 (契约 §12.10.2: 读方向不隐藏歧义) */
export interface BoundDuplicate {
  key: string
  nodeIds: string[]
}

export interface ControlProjection {
  /** 按阅读顺序: 正文 → 页眉 → 页脚, 区域内按段落顺序 */
  items: BoundItem[]
  /** 出现次数 > 1 的键; key 为空串表示这些控件**没有身份** */
  duplicates: BoundDuplicate[]
}

/**
 * 契约 §12.10.2 的读方向返回单元 —— 与 ControlProjection **同一份数据**。
 * 保留两个名字只为让契约术语 (BoundValues) 与模块术语 (ControlProjection) 对得上;
 * 不引入第二套结构, 也不做任何转换。
 */
export type BoundValues = ControlProjection

/** 投影读取池的最小结构 —— 与顺序原语要求的 SpinePool 结构相同 (契约 §31) */
export type ProjectionPool = SpinePool

export interface ControlProjectionOptions {
  /**
   * 绑定键取值器 (契约 §12.10.1)。缺省 = defaultBindingKey
   * (dataElement 优先, 回退 internal) —— 与 single 守卫同一顺序, 不另立一套。
   */
  keyOf?: (element: ElementMeta | undefined) => string | undefined
  /**
   * 字典型枚举的候选取值器 (inline `format.enums` 之外的来源)。
   * 注入而非直接读 Editor 的私有 dictionaries —— 保持本模块纯函数、可测。
   */
  optionsOf?: (nodeId: string) => readonly ElementEnumOption[] | undefined
}

export interface ControlProjectionInput extends ControlProjectionOptions {
  doc: DocumentTree
  pool: ProjectionPool
}

/** 段落里的 smarttext 子节点 id (顺序 = children 顺序 = 段内阅读顺序) */
function controlIdsOf(paraId: string, pool: ProjectionPool): string[] {
  const para = pool.nodes.get(paraId)
  const out: string[] = []
  for (const childId of para?.children ?? []) {
    if (pool.nodes.get(childId)?.type === NodeType.SMART_TEXT) out.push(childId)
  }
  return out
}

/** 单条控件 → 绑定条目。非 smarttext / 缺失节点返回 null (调用方已过滤) */
function buildItem(
  nodeId: string,
  paragraphId: string,
  region: BoundRegion,
  keyOf: NonNullable<ControlProjectionOptions['keyOf']>,
  optionsOf: ControlProjectionOptions['optionsOf'],
  pool: ProjectionPool,
): BoundItem | null {
  const node = pool.nodes.get(nodeId) as
    | { type?: string; text?: string; value?: ControlValue; element?: ElementMeta }
    | undefined
  if (!node || node.type !== NodeType.SMART_TEXT) return null

  const element = node.element
  const value = node.value
  const placeholder = node.text ?? ''
  const enumOptions = enumOptionsFor(nodeId, element, optionsOf)
  const { display, source } = resolveDisplay(value, placeholder, enumOptions)

  return {
    nodeId,
    paragraphId,
    region,
    key: keyOf(element) ?? '',
    name: element?.name ?? '',
    placeholder,
    value,
    display,
    displaySource: source,
    filled: !isControlValueEmpty(value),
    required: element?.required === true,
    readonly: element?.readonly === true,
    masked: element?.privacy?.enabled === true,
    enumOptions,
  }
}

/** 一段一段地收 —— 顺序来自调用方给的段落 id 序列 (即顺序原语) */
function collectRegion(
  paraIds: readonly string[],
  region: BoundRegion,
  keyOf: NonNullable<ControlProjectionOptions['keyOf']>,
  optionsOf: ControlProjectionOptions['optionsOf'],
  pool: ProjectionPool,
): BoundItem[] {
  const out: BoundItem[] = []
  for (const paraId of paraIds) {
    for (const nodeId of controlIdsOf(paraId, pool)) {
      const item = buildItem(nodeId, paraId, region, keyOf, optionsOf, pool)
      if (item) out.push(item)
    }
  }
  return out
}

/**
 * 文档 → 绑定投影。
 *
 * 未填字段**不过滤**: 「未填」是有意义的事实 (§12.11 的完整性闸门就靠它)。
 * 不过滤掉会让宿主无法区分「没有这个字段」与「没填」。
 *
 * 无身份的控件 (键为空串) **照常返回**, 并按空串参与重复判定 ——
 * 它们确实互相冲突, 隐藏这一点对调用方有害。
 */
export function boundControlProjectionOf(input: ControlProjectionInput): ControlProjection {
  const keyOf = input.keyOf ?? defaultBindingKey
  const { pool } = input

  const items: BoundItem[] = [
    ...collectRegion(bodyParagraphSpine(input.doc, pool), 'body', keyOf, input.optionsOf, pool),
    ...collectRegion(hfParagraphsForExport(input.doc, 'header'), 'header', keyOf, input.optionsOf, pool),
    ...collectRegion(hfParagraphsForExport(input.doc, 'footer'), 'footer', keyOf, input.optionsOf, pool),
  ]

  const byKey = new Map<string, string[]>()
  for (const it of items) {
    const arr = byKey.get(it.key)
    if (arr) arr.push(it.nodeId)
    else byKey.set(it.key, [it.nodeId])
  }
  const duplicates: BoundDuplicate[] = []
  for (const [key, nodeIds] of byKey) {
    if (nodeIds.length > 1) duplicates.push({ key, nodeIds })
  }

  return { items, duplicates }
}
