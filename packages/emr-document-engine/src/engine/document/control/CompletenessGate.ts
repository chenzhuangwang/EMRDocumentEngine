// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// CompletenessGate — 完成时点的必填未填闸门 (契约 §12.11)
//
// 判据本身是既有的 layer C (isControlValueComplete, §12.6.2), 本文件**不重写**
// 它, 只把「哪些控件不完整」从文档级问出来, 并给每一项带上**可跳转**的定位。
//
// 为什么读投影而不自己走一遍树: §12.11 要的覆盖范围与 §12.10 的读方向**必须
// 同一份** —— 宿主拿到的「未填项」与「可绑定项」若范围不同, 就会出现
// 「读得到却校验不到」或反之。故本模块是 ControlProjection 的**消费者**,
// 不是第二个遍历实现。
//
// 为什么不是 QCResult / 不是分数: QCResult.score/grade 是**合规分**
// (§7.5 / §12.6.2 layer E); 完整性是另一个事实、另一个 owner。契约明文
// 禁止二者合并或共用一个字段。故本模块不 import qc/, 也不产生任何分数 ——
// 宿主只要完整性时, 不必被迫先算合规。
// ================================================================

import type { BoundItem, ControlProjection } from './ControlProjection'

/**
 * 一条未填的必填项 (契约 §12.11)。
 * 形状对齐 QCIssueLocation: paragraphPath 是宿主「点击 → 跳到控件」的依据。
 */
export interface MissingField {
  nodeId: string
  /** 定位路径 [docId, paragraphId] —— 与 QCEngine 的 smarttext 定位同形 */
  paragraphPath: string[]
  /** 控件名 (展示用); 无名时为空串, 不回退成占位符 */
  name: string
}

export interface CompletenessResult {
  /** 无未填项 */
  ok: boolean
  /** 按阅读顺序排列的未填项 (正文 → 页眉 → 页脚) */
  missing: MissingField[]
}

/**
 * 投影 → 未填的必填项。
 *
 * docId 只用于拼 paragraphPath (与 QCEngine 口径一致), 不参与判定。
 * 顺序**直接继承**投影的阅读顺序, 不重排 —— 宿主按返回顺序跳转即可。
 */
export function missingRequiredOf(
  projection: ControlProjection,
  docId: string,
): MissingField[] {
  const out: MissingField[] = []
  for (const item of projection.items) {
    if (!isMissing(item)) continue
    out.push({
      nodeId: item.nodeId,
      paragraphPath: [docId, item.paragraphId],
      name: item.name,
    })
  }
  return out
}

/**
 * 单条判据: 必填 且 未填。
 * 只读两个既有字段 (required 来自 element.required, filled 来自
 * isControlValueEmpty 的取反), 与 isControlValueComplete 同口径 ——
 * 不在这里重新解释「什么算空」。
 */
function isMissing(item: BoundItem): boolean {
  return item.required && !item.filled
}
