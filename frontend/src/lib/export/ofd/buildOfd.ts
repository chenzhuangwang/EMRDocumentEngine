// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// buildOfd — OFD 产物的编排入口 (导出特性层)
//
// 输入是**可序列化的 DTO**, 不是 Editor: 页面几何来自 SLIF, 逐字形推进来自
// 注入的测量端口, 业务元数据来自文档模型。这一点是刻意的 —— 架构文档原本把
// OFD 规划在**后端** (suwell/ofdrw, output/3-architecture.md:5358), 于是这里
// 把「构造 DTO」与「渲染 DTO」分开: 将来接 ofdrw 只换渲染那一段, 前端这份
// 仍可作为离线 / 演示模式下的渲染器, 两者共用同一份 DTO。
//
// ===== 诚实边界 =====
// 产出的包遵循 GB/T 33190-2016 的对象模型, **不声称符合 OFD-H**:
//   - OFD-H 目前是**征求意见稿** (2025-09-29 由国家卫生健康委医院管理研究所
//     牵头发布征求意见), 正文未取得, 无法逐条对齐;
//   - 结构化数据区以本引擎自有命名空间 `urn:emrde:ofd-h:2026` 承载。
//
// ===== 字体 =====
// 不内嵌字体, 按名引用 (与对照的真实 OFD 样本一致)。保真的依靠是**逐字形
// DeltaX**: 每个字形的推进量都写死在文件里, 因此即便阅读器换用了别的字体,
// **版式也不会重排**, 只是字形轮廓不同。要真正内嵌需要引入开源中文字体并重新
// 推导度量, 那是一件独立工程, 不在本轮 (字体的字形轮廓保真作为已知限制记录)。
//
// ===== 签章 =====
// 只留接口与预留条目名, 本轮不实现 (SM2/SM4 不在 WebCrypto 里)。签章必须是
// **最后一次**改动 —— 这也是 zipTime 由调用方固定传入、且本函数同时返回
// entries 而非只返回字节的原因: 签章方需要一份稳定的字节序列去签名。
// ============================================================

import { buildZip } from '../zipWriter'
import type { ZipEntry } from '../zipWriter'
import { buildOfdModel } from './ofdModel'
import type { CharAdvancePort, FieldTextPort, OfdModel, OfdWarning } from './ofdModel'
import { buildOfdEntries } from './ofdXml'
import type { OfdBusinessMeta, OfdDocInfo, OfdEntry, OfdXmlInput } from './ofdXml'
import { META_KEYS } from './ofdHMapping'
import type { MetaKey } from './ofdHMapping'
import type { FieldProjection } from '../fields'
import type { SLIFPage } from '@/engine'

/** 带 id 的文档元数据 (只读投影, 不依赖 engine 的具体类型) */
export interface OfdDocumentMeta {
  id?: string
  title?: string
  modelVersion?: string
  metadata?: {
    author?: string
    creator?: string
    department?: string
    category?: string
    createdAt?: string
    updatedAt?: string
  }
}

export interface OfdBuildInput {
  /** 已排版的页面 (layout truth) */
  pages: readonly SLIFPage[]
  /** nodeId → 图片 data URL */
  images?: ReadonlyMap<string, string>
  /** 逐字形推进量端口 (生产: TextMeasurer; 测试: 桩) */
  charAdvance: CharAdvancePort
  /** 域代码解析端口 (生产: resolveFieldText + 逐页上下文) */
  resolveFieldText?: FieldTextPort
  /** 结构化字段投影 (写进数据区; 与「导出结构化元素」「导出 XML」同源) */
  projection?: FieldProjection
  document: OfdDocumentMeta
  /** 人读标签 (由 UI 层从 locale 注入, 保持本模块纯函数) */
  labels: Record<MetaKey, string>
  provenance: { generator: string; license: string; copyright: string; token: string }
  /** 生成方标识 (写进 DocInfo) */
  creator?: string
  creatorVersion?: string
  /** DocID —— 缺省用溯源 token (32 位 ASCII, 可作案卷句柄) */
  docId?: string
  now: Date
  /** 包内统一 mtime —— 固定值, 保证字节可复现 (签章的前提) */
  zipTime: Date
}

export interface OfdBuildResult {
  bytes: Uint8Array
  /** 包内条目名 (顺序即写入顺序) —— 供测试与签章方核对 */
  entryNames: string[]
  model: OfdModel
  warnings: OfdWarning[]
  /** 被剔除的 XML 非法字符数 (不静默; 调用方应上报) */
  droppedChars: number
}

/**
 * 签章端口 —— **本轮不实现**。
 *
 * 签章必须发生在 buildOfd 之后、且是最后一次改动; 任何后续写入都会让摘要失效。
 * 预留的包内位置: `Doc_0/Signs/Signatures.xml` 与 `Doc_0/Signs/Sign_0/*`。
 */
export interface OfdSignaturePort {
  sign(entries: readonly ZipEntry[]): readonly ZipEntry[]
}

/** 预留的签章条目名 (本轮不产出, 供将来的签章方对照) */
export const OFD_SIGNATURE_ENTRIES = [
  'Doc_0/Signs/Signatures.xml',
  'Doc_0/Signs/Sign_0/Seal.esl',
  'Doc_0/Signs/Sign_0/SignedValue.dat',
] as const

/**
 * 从现有文档模型派生业务元数据。
 *
 * **只派生模型里真有的东西**:
 *   documentType  ← title / metadata.category
 *   author        ← metadata.author / creator
 *   submittedAt   ← metadata.updatedAt / createdAt
 *
 * 派生不出的 (住院号 / 就诊时间 / 诊断 / 手术信息) 一律不给值 —— 它们在本引擎
 * 的文档模型里根本不存在, 编一个空串会被下游当成「确实没有住院号」而不是
 * 「这里没提供」。患者本人的数据在 `projection.fields` 里 (按 dataElement 码),
 * 数据区已经完整带上, 不在这里重复一份。
 */
export function deriveBusinessMeta(doc: OfdDocumentMeta): {
  business: OfdBusinessMeta
  notDerived: MetaKey[]
} {
  const md = doc.metadata
  const business: OfdBusinessMeta = {}
  if (doc.title) business.documentType = md?.category ? `${doc.title}` : doc.title
  const author = md?.author ?? md?.creator
  if (author) business.author = author
  const submitted = md?.updatedAt ?? md?.createdAt
  if (submitted) business.submittedAt = submitted

  const provided = new Set(
    (Object.keys(business) as MetaKey[]).filter((k) => business[k] !== undefined),
  )
  // 模型里没有对应来源的键 —— 显式列出, 让下游能区分「没提供」与「值为空」
  const structurallyAbsent: MetaKey[] = ['patientInfo', 'admissionNo', 'visitTime', 'diagnosis', 'procedure']
  const notDerived = META_KEYS.filter((k) => !provided.has(k) || structurallyAbsent.includes(k))
  return { business, notDerived }
}

export function buildOfd(input: OfdBuildInput): OfdBuildResult {
  const model = buildOfdModel({
    pages: input.pages,
    images: input.images,
    charAdvance: input.charAdvance,
    resolveFieldText: input.resolveFieldText,
    projection: input.projection,
  })

  const { business, notDerived } = deriveBusinessMeta(input.document)

  const docInfo: OfdDocInfo = {
    docId: input.docId ?? input.provenance.token,
    title: input.document.title,
    creator: input.creator ?? input.provenance.generator,
    creatorVersion: input.creatorVersion ?? '',
    creationDate: input.now,
  }

  const xmlInput: OfdXmlInput = {
    model,
    docInfo,
    projection: input.projection,
    business,
    provenance: input.provenance,
    document: {
      id: input.document.id,
      title: input.document.title,
      modelVersion: input.document.modelVersion,
    },
    layout: {
      pageWidthMm: model.pages[0]?.widthMm ?? 210,
      pageHeightMm: model.pages[0]?.heightMm ?? 297,
      pageCount: model.pages.length,
    },
    labels: input.labels,
    notDerived,
    now: input.now,
  }

  const { entries, droppedChars } = buildOfdEntries(xmlInput)

  // 入口文件排最前且不压缩 (与 ODF/EPUB 的惯例一致; OFD 是否强制未核实,
  // 但这样写不花任何代价, 且对两种可能的规定都成立)
  const zipEntries: ZipEntry[] = entries.map((e: OfdEntry, i: number) => ({
    name: e.name,
    data: e.data,
    store: i === 0,
  }))

  const bytes = buildZip(zipEntries, { mtime: input.zipTime })

  return {
    bytes,
    entryNames: zipEntries.map((e) => e.name),
    model,
    warnings: model.warnings,
    droppedChars,
  }
}
