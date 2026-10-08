// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ofdHMapping — OFD-H 术语与命名空间的**唯一映射点** (重命名缝)
//
// 背景: 《电子病历版式文档技术要求 (OFD-H)》目前是**征求意见稿**
// (2025-09-29 由国家卫生健康委医院管理研究所牵头发布征求意见), 其正文未能
// 取得。因此本仓库**不声称**产出符合 OFD-H —— 产出的 OFD 包遵循
// GB/T 33190-2016 的对象模型, 结构化数据区以本引擎自有命名空间承载,
// 其术语按 OFD-H **公开表述的意图**预留。
//
// 本文件是那份差异的**唯一落点**: 命名空间常量 + ASCII 机器键 + 一张目标名
// 对照表 (今日 `ofdHName` 全为 undefined)。正式标准到位时, 只需填这张表并
// 替换命名空间常量 —— ofdModel / ofdXml **永远不出现 OFD-H 术语**, 所以那次
// 变更不会扩散。
//
// 机器键一律**纯 ASCII**: 它们是给程序读的稳定标识, 不是给人看的文案。
// 人读标签由 UI 层经 `labels` 注入 (见 buildOfd 的 OfdLabels), 故本模块不受
// i18n 闸门约束, 也不会把中文写进结构里。
// ============================================================

/** GB/T 33190-2016 的 OFD 命名空间 (已对照真实 OFD 样本核实) */
export const OFD_NS = 'http://www.ofdspec.org/2016'

/**
 * 结构化临床数据区的命名空间。
 *
 * 今日是**引擎自有**命名空间, 不是 OFD-H 的 —— 因为 OFD-H 正文未取得,
 * 用它的命名空间就等于伪造一致性。正式文本到位后替换本常量即可。
 */
export const EMRH_NS = 'urn:emrde:ofd-h:2026'

/** 数据区所在的包内路径 */
export const CLINICAL_DATA_PATH = 'Attachments/ClinicalData.xml'
export const CLINICAL_DATA_FULL_PATH = `Doc_0/${CLINICAL_DATA_PATH}`

/** OFD `Extension` 节点的 Name —— OFD-H 工具据此在 Document.xml 里找到数据区 */
export const EXTENSION_NAME = 'EMRDE-StructuredData'

/**
 * 业务字段的 ASCII 机器键。
 *
 * 与「患者信息 / 住院号 / 诊断…」这类**人类标签**分开: 键是稳定标识, 标签是
 * 本地化文案。二者混用会让下游必须解析中文才能取字段。
 */
export const META_KEYS = [
  'patientInfo',
  'admissionNo',
  'visitTime',
  'documentType',
  'author',
  'submittedAt',
  'diagnosis',
  'procedure',
] as const

export type MetaKey = (typeof META_KEYS)[number]

/**
 * 机器键 → OFD-H 正式术语的对照表 —— **今日全为空**。
 *
 * 空不是遗漏, 是如实: 正文没拿到, 就不编术语名。填表即是正式对齐那一步,
 * 且不会碰模型层与序列化层。
 */
export const OFD_H_TERM: Readonly<Record<MetaKey, string | undefined>> = Object.freeze({
  patientInfo: undefined,
  admissionNo: undefined,
  visitTime: undefined,
  documentType: undefined,
  author: undefined,
  submittedAt: undefined,
  diagnosis: undefined,
  procedure: undefined,
})

/** 该键在正式 OFD-H 里应叫什么; 未对齐时返回自有键 (调用方可据此判断是否已对齐) */
export function termOf(key: MetaKey): { name: string; aligned: boolean } {
  const mapped = OFD_H_TERM[key]
  return mapped ? { name: mapped, aligned: true } : { name: key, aligned: false }
}
