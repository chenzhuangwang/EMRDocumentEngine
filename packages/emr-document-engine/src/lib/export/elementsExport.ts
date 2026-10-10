// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// elementsExport — 结构化元素 JSON (导出特性层, 纯函数)
//
// 「所有的输入项数据」的机器可读产物: 每个 smarttext 控件一条, 同时给
// **机器码** (value) 与**显示名** (display), 再附候选表 (enumOptions), 使
// 下游既能直接上报/统计, 又能直接展示, 且不必回文档查定义。
//
// 这是数据路径, 不是表现路径: 不承诺与 TXT/HTML 导出同形, 只承诺与
// fields.ts 的投影同源 (三个导出格式共用同一份字段语义)。
//
// 与既有 JSON 导出的关系: 那份是**完整文档序列化** (节点树 + 模板定义 +
// 版式), 用于回环; 这份只是**字段清单**, 用于交换与提取。两者互补。
// ============================================================

import type { FieldProjection } from './fields'

export const ELEMENTS_SCHEMA_VERSION = '1.0'
export const ELEMENTS_KIND = 'emrde.structured-elements'

/** 文档级可观测值 —— 由调用方注入 (本模块不读 Editor, 保持纯函数可测) */
export interface ElementsDocumentMeta {
  id?: string
  title?: string
  modelVersion?: string
  /** 声明的页面设置 (doc.pageSetup) —— 是**意图**, 未必等于实际排版结果 */
  pageSetup?: unknown
  /** 实际排版结果 (SLIF) —— 声明与结果不一致时以这里为准 (见 plan 风险 3) */
  layout?: { pageWidth: number; pageHeight: number; pageCount: number }
  /** doc.metadata 原样带出 */
  metadata?: unknown
  stats?: { paragraphs?: number; words?: number; chars?: number }
}

export interface ElementsExportInput {
  projection: FieldProjection
  document: ElementsDocumentMeta
  /** 生成时刻 —— 由调用方注入, 保证本函数可确定复现 (不用 Date.now()) */
  now: Date
}

/**
 * 组装结构化元素产物。
 *
 * 顶层字段沿用既有 JSON 导出的约定: 加载侧容忍未知顶层字段 (`_toc` / `_provenance`
 * 已开先例), 故 `_provenance` 由 UI 边界用 stampExportObject 附加, 本函数不写。
 */
export function buildElementsDocument(input: ElementsExportInput): Record<string, unknown> {
  const { projection, document, now } = input
  return {
    schemaVersion: ELEMENTS_SCHEMA_VERSION,
    kind: ELEMENTS_KIND,
    generatedAt: now.toISOString(),
    document: {
      id: document.id ?? null,
      title: document.title ?? null,
      modelVersion: document.modelVersion ?? null,
      pageSetup: document.pageSetup ?? null,
      layout: document.layout ?? null,
      metadata: document.metadata ?? null,
      stats: document.stats ?? null,
    },
    sections: projection.sections,
    fields: projection.fields,
    diagnostics: projection.diagnostics,
  }
}
