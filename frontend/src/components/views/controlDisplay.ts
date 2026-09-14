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
// controlType 的展示名复用 controlWidgetById() (§12.4 目录), 不在本文件
// 复制第二套映射表。未知 controlType 兜底显示原始值, 不猜测。
// ================================================================

import type { ControlType } from '@/engine/template/TemplateDefinition'
import type { ElementMeta } from '@/engine/document/core/DocumentModel'
import { controlWidgetById } from '@/platform/data/controlLibrary'

/** controlType → 展示名。undefined → 「未指定」; 未知值 → 原始字符串 (不猜)。 */
export function controlTypeDisplayName(controlType: ControlType | undefined): string {
  if (!controlType) return '未指定'
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
export function semanticIdentityOf(element: ElementMeta | undefined): SemanticIdentity | null {
  if (!element) return null
  const f = element.format
  const enums = f?.enums
  return {
    dataElement: element.code?.dataElement ?? '—',
    dataType: f?.dataType ?? '—',
    showType: f?.showType ?? '—',
    enums: enums ? `${enums.data?.length ?? 0} 项` : '—',
    required: element.required ? '是' : '否',
    readonly: element.readonly ? '是' : '否',
  }
}
