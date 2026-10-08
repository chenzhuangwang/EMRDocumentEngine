// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ofdXml — OFD 对象图 → 各 XML 分件 (导出特性层, 纯函数)
//
// 分件结构与元素/属性名对照 GB/T 33190-2016 的对象模型, 并逐项核对了
// ofdrw/ofd-core 中的模型类 (CT_Text / CT_Path / CT_Image / CT_MultiMedia /
// CT_Font) 与一份真实 OFD 样本 (helloworld.ofd) 的实际产出。
//
// **不声称符合 OFD-H**: OFD-H 目前是征求意见稿且其正文未取得, 结构化数据区
// 以本引擎自有命名空间承载 (见 ofdHMapping)。本模块只保证遵循 GB/T 33190 的
// 容器与对象模型。
//
// 元素顺序按标准图表排列 (CommonData → Pages → ...), 因为 OFD 的 XSD 用的是
// sequence 而非 all —— 顺序错了阅读器会直接判非法。
// ============================================================

import {
  createXmlCtx, xmlDeclaration, xmlElement, xmlTextNode,
} from '../xmlWriter'
import type { XmlBuildCtx } from '../xmlWriter'
import { boxStr, mm, toOfdColor } from './ofdModel'
import type { OfdModel, OfdObject, OfdPage, OfdTextObject, OfdPathObject, OfdImageObject } from './ofdModel'
import {
  CLINICAL_DATA_PATH, EMRH_NS, EXTENSION_NAME, OFD_NS, termOf, META_KEYS,
} from './ofdHMapping'
import type { MetaKey } from './ofdHMapping'
import type { FieldProjection } from '../fields'

/** 一个包内条目 */
export interface OfdEntry {
  name: string
  data: string | Uint8Array
}

export interface OfdDocInfo {
  /** 文档标识 (Document.xml 的 DocID, 也是将来签章可绑定的句柄) */
  docId: string
  title?: string
  creator: string
  creatorVersion: string
  creationDate: Date
}

/**
 * 业务元数据 —— 只从现有模型派生。
 *
 * 派生不出来的字段 (住院号 / 就诊时间 / 诊断 / 手术信息) 在模型里根本不存在,
 * 因此**留空并标注 notDerived**, 不编造。这是本文件对用户「必须内置业务字段」
 * 要求的诚实答复: 能给的给, 给不了的说清楚给不了。
 */
export interface OfdBusinessMeta {
  patientInfo?: string
  admissionNo?: string
  visitTime?: string
  documentType?: string
  author?: string
  submittedAt?: string
  diagnosis?: string
  procedure?: string
}

export interface OfdXmlInput {
  model: OfdModel
  docInfo: OfdDocInfo
  /** 结构化字段投影 (写入数据区) */
  projection?: FieldProjection
  /** 业务元数据 (键为 ASCII 机器键) */
  business?: OfdBusinessMeta
  /** 溯源记录 (与 JSON/XML 导出同源) */
  provenance: { generator: string; license: string; copyright: string; token: string }
  /** 文档级信息, 写进数据区 */
  document: { id?: string; title?: string; modelVersion?: string }
  /** 本文件的实际页数与页面盒 (来自 SLIF, 不是 doc.pageSetup) */
  layout: { pageWidthMm: number; pageHeightMm: number; pageCount: number }
  /** 人读标签 (由 UI 层注入; 机器键见 ofdHMapping) */
  labels: Record<MetaKey, string>
  /** 未派生出的业务字段 (显式列出, 不编造) */
  notDerived?: readonly MetaKey[]
  now: Date
}

const OFD_PREFIX = 'ofd'

/** 一个带命名空间前缀的元素 */
function ofd(ctx: XmlBuildCtx, name: string, attrs?: Record<string, string | number | boolean | null | undefined>, children?: readonly string[] | string): string {
  return xmlElement(ctx, `${OFD_PREFIX}:${name}`, attrs, children)
}

function emrh(ctx: XmlBuildCtx, name: string, attrs?: Record<string, string | number | boolean | null | undefined>, children?: readonly string[] | string): string {
  return xmlElement(ctx, `emrh:${name}`, attrs, children)
}

// ------------------------------------------------------------
// 各分件
// ------------------------------------------------------------

/** OFD.xml —— 包入口 */
export function buildOfdEntryPoint(ctx: XmlBuildCtx, input: OfdXmlInput): string {
  const { docInfo } = input
  const docInfoChildren: string[] = [
    ofd(ctx, 'DocID', undefined, [xmlTextNode(ctx, docInfo.docId)]),
    ofd(ctx, 'CreationDate', undefined, [xmlTextNode(ctx, isoDate(docInfo.creationDate))]),
    ofd(ctx, 'Creator', undefined, [xmlTextNode(ctx, docInfo.creator)]),
    ofd(ctx, 'CreatorVersion', undefined, [xmlTextNode(ctx, docInfo.creatorVersion)]),
  ]
  if (docInfo.title) {
    docInfoChildren.push(ofd(ctx, 'Title', undefined, [xmlTextNode(ctx, docInfo.title)]))
  }

  const body = ofd(ctx, 'DocBody', undefined, [
    ofd(ctx, 'DocInfo', undefined, docInfoChildren),
    ofd(ctx, 'DocRoot', undefined, [xmlTextNode(ctx, 'Doc_0/Document.xml')]),
  ])

  return (
    xmlDeclaration() +
    ofd(ctx, 'OFD', {
      'xmlns:ofd': OFD_NS,
      // 版本号取值 1.0: 与本仓库对照的真实样本一致 (ofdrw 的 OFD.VERSION 常量是 1.2,
      // 但那要求读者支持 1.2 的特性集; 我们只用 1.0 就有的对象, 声明 1.0 更保守)。
      Version: '1.0',
      DocType: 'OFD',
    }, [body])
  )
}

/** Doc_0/Document.xml —— 文档根节点 */
export function buildOfdDocument(ctx: XmlBuildCtx, input: OfdXmlInput): string {
  const { model, layout } = input

  const commonDataChildren: string[] = []
  commonDataChildren.push(ofd(ctx, 'PageArea', undefined, [
    ofd(ctx, 'PhysicalBox', undefined, [
      xmlTextNode(ctx, `0 0 ${layout.pageWidthMm.toFixed(3)} ${layout.pageHeightMm.toFixed(3)}`),
    ]),
  ]))
  // PublicRes 承载字体 (Res 目录下的资源)
  commonDataChildren.push(ofd(ctx, 'PublicRes', undefined, [xmlTextNode(ctx, 'PublicRes.xml')]))
  // DocumentRes 承载图片 (MultiMedia)
  if (model.images.length > 0) {
    commonDataChildren.push(ofd(ctx, 'DocumentRes', undefined, [xmlTextNode(ctx, 'DocumentRes.xml')]))
  }
  commonDataChildren.push(ofd(ctx, 'MaxUnitID', undefined, [xmlTextNode(ctx, String(model.maxUnitId))]))

  const pageNodes = model.pages.map((p) => ofd(ctx, 'Page', {
    ID: p.id,
    BaseLoc: `Pages/Page_${p.index}/Content.xml`,
  }))

  const documentChildren: string[] = [
    ofd(ctx, 'CommonData', undefined, commonDataChildren),
    ofd(ctx, 'Pages', undefined, pageNodes),
  ]

  // 扩展位: 指向结构化数据区。OFD-H 工具据此在文档根就能发现数据区, 不必扫附件。
  // 用 ofd:Extensions 而非自定义顶层元素 —— 这是标准为扩展预留的位置。
  documentChildren.push(ofd(ctx, 'Extensions', undefined, [xmlTextNode(ctx, 'Extensions.xml')]))

  return xmlDeclaration() + ofd(ctx, 'Document', { 'xmlns:ofd': OFD_NS }, documentChildren)
}

/** Doc_0/Extensions.xml —— 扩展信息入口 (标准 §17 图 83) */
export function buildOfdExtensions(ctx: XmlBuildCtx): string {
  const extension = ofd(ctx, 'Extension', { Name: EXTENSION_NAME }, [
    emrh(ctx, 'ClinicalDataRef', undefined, [xmlTextNode(ctx, CLINICAL_DATA_PATH)]),
  ])
  return (
    xmlDeclaration() +
    xmlElement(ctx, 'ofd:Extensions', { 'xmlns:ofd': OFD_NS, 'xmlns:emrh': EMRH_NS }, [extension])
  )
}

/** Doc_0/PublicRes.xml —— 字形资源 (按名引用, 不内嵌) */
export function buildOfdPublicRes(ctx: XmlBuildCtx, input: OfdXmlInput): string {
  const fonts = input.model.fonts.map((f) => ofd(ctx, 'Font', {
    ID: f.id, FontName: f.name, FamilyName: f.name,
  }))
  return (
    xmlDeclaration() +
    ofd(ctx, 'Res', { 'xmlns:ofd': OFD_NS, BaseLoc: 'Res' }, [
      ofd(ctx, 'Fonts', undefined, fonts),
    ])
  )
}

/** Doc_0/DocumentRes.xml —— 图片等多媒资资源 */
export function buildOfdDocumentRes(ctx: XmlBuildCtx, input: OfdXmlInput): string {
  const medias = input.model.images.map((img) => ofd(ctx, 'MultiMedia', {
    ID: img.id, Type: 'Image', Format: img.format,
  }, [ofd(ctx, 'MediaFile', undefined, [xmlTextNode(ctx, `Res/${img.fileName}`)])]))

  return (
    xmlDeclaration() +
    ofd(ctx, 'Res', { 'xmlns:ofd': OFD_NS, BaseLoc: 'Res' }, [
      ofd(ctx, 'MultiMedias', undefined, medias),
    ])
  )
}

function emitTextObject(ctx: XmlBuildCtx, o: OfdTextObject): string {
  const children: string[] = []
  if (o.fillColor) {
    // 颜色是**子元素** `<ofd:FillColor Value="r g b"/>` (CT_Color 的 Value 属性),
    // 不是 TextObject 的属性 —— 与 PathObject 的 StrokeColor/FillColor 同构
    children.push(ofd(ctx, 'FillColor', { Value: toOfdColor(o.fillColor) }))
  }
  children.push(ofd(ctx, 'TextCode', {
    X: mm(o.codeX),
    Y: mm(o.codeY),
    // DeltaX 用朴素空格分隔的十进制列表, 长度 === 字形数。
    // 刻意不用 `g` 行程编码: 那是可选的体积优化, 徒增一致性风险。
    ...(o.deltaX.length > 0 ? { DeltaX: o.deltaX.map((v) => mm(v)).join(' ') } : {}),
  }, [xmlTextNode(ctx, o.text)]))

  return ofd(ctx, 'TextObject', {
    ID: o.id,
    Boundary: boxStr(o.boundary),
    Font: o.fontId,
    Size: mm(o.size),
    ...(o.fillColor ? { Fill: true } : {}),
    ...(o.weight ? { Weight: o.weight } : {}),
    ...(o.italic ? { Italic: true } : {}),
  }, children)
}

function emitPathObject(ctx: XmlBuildCtx, o: OfdPathObject): string {
  const children: string[] = []
  if (o.stroke && o.strokeColor) {
    children.push(ofd(ctx, 'StrokeColor', { Value: toOfdColor(o.strokeColor) }))
  }
  if (o.fill && o.fillColor) {
    children.push(ofd(ctx, 'FillColor', { Value: toOfdColor(o.fillColor) }))
  }
  children.push(ofd(ctx, 'AbbreviatedData', undefined, [xmlTextNode(ctx, o.abbreviatedData)]))

  return ofd(ctx, 'PathObject', {
    ID: o.id,
    Boundary: boxStr(o.boundary),
    ...(o.stroke ? { Stroke: true, LineWidth: mm(o.lineWidth ?? 1) } : {}),
    ...(o.fill ? { Fill: true } : {}),
    ...(o.dashPattern ? { DashPattern: o.dashPattern.map((v) => mm(v)).join(' ') } : {}),
  }, children)
}

function emitImageObject(ctx: XmlBuildCtx, o: OfdImageObject): string {
  return ofd(ctx, 'ImageObject', {
    ID: o.id,
    Boundary: boxStr(o.boundary),
    ResourceID: o.resourceId,
  })
}

function emitObject(ctx: XmlBuildCtx, o: OfdObject): string {
  switch (o.kind) {
    case 'text': return emitTextObject(ctx, o)
    case 'path': return emitPathObject(ctx, o)
    case 'image': return emitImageObject(ctx, o)
  }
}

/** Doc_0/Pages/Page_N/Content.xml */
export function buildOfdPage(ctx: XmlBuildCtx, page: OfdPage): string {
  const objects = page.objects.map((o) => emitObject(ctx, o)).filter(Boolean)
  // Layer ID 由模型统一分配 (与页 ID 同一空间, 否则会撞号)
  const layer = ofd(ctx, 'Layer', { ID: page.layerId }, objects)

  return (
    xmlDeclaration() +
    ofd(ctx, 'Page', { 'xmlns:ofd': OFD_NS }, [
      ofd(ctx, 'Content', undefined, [layer]),
    ])
  )
}

/**
 * Doc_0/Attachments/ClinicalData.xml —— 结构化临床数据区。
 *
 * 这是「OFD-H」意图的落点: 版式给机器看的页面, 这份给机器读的数据。
 * 元素名今日用自有术语 (见 ofdHMapping), 正式标准到位时改映射表即可。
 */
export function buildOfdClinicalData(ctx: XmlBuildCtx, input: OfdXmlInput): string {
  const { projection, business, document, provenance, layout, labels, now } = input

  const provenanceNode = emrh(ctx, 'provenance', {
    generator: provenance.generator,
    license: provenance.license,
    copyright: provenance.copyright,
    token: provenance.token,
  })

  const documentNode = emrh(ctx, 'document', {
    id: document.id ?? null,
    title: document.title ?? null,
    modelVersion: document.modelVersion ?? null,
    generatedAt: now.toISOString(),
    pageCount: layout.pageCount,
    pageWidthMm: layout.pageWidthMm.toFixed(3),
    pageHeightMm: layout.pageHeightMm.toFixed(3),
  })

  // 业务元数据: 每个键都出, 派生不出的带 derived="false" —— 下游能区分
  // 「没有这个字段的值」和「我们没给你这个字段」。
  const notDerived = new Set(input.notDerived ?? [])
  const metaNodes = META_KEYS.map((key) => {
    const value = business?.[key]
    const derived = value !== undefined && !notDerived.has(key)
    return emrh(ctx, 'meta', {
      key,                       // 稳定 ASCII 机器键
      label: labels[key] ?? key, // 人读标签 (由 UI 注入)
      derived,
      // OFD-H 正式术语 (今日为 undefined → 不输出该属性)
      ...(termOf(key).aligned ? { ofdHName: termOf(key).name } : {}),
    }, value !== undefined ? [xmlTextNode(ctx, value)] : [])
  })

  const sectionNodes = (projection?.sections ?? []).map((s) => emrh(ctx, 'section', {
    id: s.id,
    code: s.code ?? null,
    depth: s.depth,
    parentId: s.parentId ?? null,
    anonymous: s.anonymous,
    codeDuplicate: s.codeDuplicate,
  }))

  const fieldNodes = (projection?.fields ?? []).map((f) => emrh(ctx, 'field', {
    nodeId: f.nodeId,
    order: f.order,
    name: f.name,
    dataElement: f.code.dataElement,
    internal: f.code.internal,
    controlType: f.controlType ?? null,
    dataType: f.dataType ?? null,
    sectionCode: f.sectionCode ?? null,
    filled: f.filled,
    multiple: f.multiple,
    masked: f.masked,
    required: f.required,
    readonly: f.readonly,
    region: f.region,
    tableId: f.location.tableId ?? null,
    // 枚举的机器码与显示名**都给** —— 这是本特性被要求做到的核心
    value: f.value === null || Array.isArray(f.value) ? null : String(f.value),
    display: f.display,
    displaySource: f.displaySource,
  }, [
    ...(f.enumOptions
      ? [emrh(ctx, 'enumOptions', undefined, f.enumOptions.map((o) =>
          emrh(ctx, 'option', { name: o.name, value: o.value })))]
      : []),
    ...(Array.isArray(f.value)
      ? [emrh(ctx, 'multipleValues', undefined, f.value.map((v) =>
          emrh(ctx, 'value', { code: v }, [xmlTextNode(ctx, v)])))]
      : []),
  ]))

  const diagnostics = projection
    ? emrh(ctx, 'diagnostics', {
        fieldCount: projection.diagnostics.fieldCount,
        filledCount: projection.diagnostics.filledCount,
      }, projection.diagnostics.duplicateElementCodes.map((code) =>
        emrh(ctx, 'duplicateElementCode', { code })))
    : ''

  return (
    xmlDeclaration() +
    xmlElement(ctx, 'emrh:ClinicalData', {
      'xmlns:emrh': EMRH_NS,
      // 如实标注: 这不是 OFD-H 正式术语, 是对齐前的自有承载
      schema: 'emrde.structured-elements/1.0',
      ofdHAligned: false,
    }, [
      provenanceNode,
      documentNode,
      emrh(ctx, 'business', undefined, metaNodes),
      ...(sectionNodes.length > 0 ? [emrh(ctx, 'sections', undefined, sectionNodes)] : []),
      emrh(ctx, 'fields', undefined, fieldNodes),
      ...(diagnostics ? [diagnostics] : []),
    ])
  )
}

// ------------------------------------------------------------
// 组装全部分件
// ------------------------------------------------------------

/** 把对象图渲染成完整的 OFD 条目集 (未打包) */
export function buildOfdEntries(input: OfdXmlInput): { entries: OfdEntry[]; droppedChars: number } {
  const ctx = createXmlCtx()

  const entries: OfdEntry[] = []
  // 入口文件放最前 (包扫描按顺序找 DocRoot)
  entries.push({ name: 'OFD.xml', data: buildOfdEntryPoint(ctx, input) })
  entries.push({ name: 'Doc_0/Document.xml', data: buildOfdDocument(ctx, input) })
  entries.push({ name: 'Doc_0/Extensions.xml', data: buildOfdExtensions(ctx) })
  entries.push({ name: 'Doc_0/PublicRes.xml', data: buildOfdPublicRes(ctx, input) })
  if (input.model.images.length > 0) {
    entries.push({ name: 'Doc_0/DocumentRes.xml', data: buildOfdDocumentRes(ctx, input) })
  }
  for (const page of input.model.pages) {
    entries.push({ name: `Doc_0/Pages/Page_${page.index}/Content.xml`, data: buildOfdPage(ctx, page) })
  }
  for (const img of input.model.images) {
    entries.push({ name: `Doc_0/Res/${img.fileName}`, data: decodeDataUrl(img.dataUrl) })
  }
  entries.push({
    name: 'Doc_0/Attachments/ClinicalData.xml',
    data: buildOfdClinicalData(ctx, input),
  })

  return { entries, droppedChars: ctx.droppedChars }
}

/** data URL → 字节 (手写 base64 解码, 不依赖浏览器/Node 的 atob) */
export function decodeDataUrl(dataUrl: string): Uint8Array {
  const idx = dataUrl.indexOf(',')
  const payload = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl
  return base64ToBytes(payload)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let outIdx = 0
  let buffer = 0
  let bits = 0
  for (const ch of clean) {
    const v = B64.indexOf(ch)
    if (v < 0) continue
    buffer = (buffer << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[outIdx++] = (buffer >> bits) & 0xff
    }
  }
  return out.slice(0, outIdx)
}

function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
