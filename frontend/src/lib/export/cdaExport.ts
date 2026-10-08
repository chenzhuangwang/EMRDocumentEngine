// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// cdaExport — HL7 CDA 骨架 (导出特性层, 纯函数)
//
// 产出 ClinicalDocument → structuredBody → component/section → entry/observation
// 的骨架, 供跨系统交换与归档。字段语义一律取 fields.ts 的投影 —— 不在本模块
// 另写一遍「什么算一个字段」。
//
// 与扁平格式的关系 (契约 §31.12 点名): TXT/HTML **表达不了空 Section**
// (空节贡献零字符, 与「没有这个节」不可区分)。本格式能, 且**必须**能 ——
// 空节是结构事实, 丢掉它等于丢内容。
//
// 三条契约强制的失败语义:
//   1. 无节归属的内容**不得静默丢弃** (§31.5) → 归入合成节 UNASSIGNED, 并
//      以 emrde:anonymous 显式标记。
//   2. sectionCode 唯一性**未强制** (§31.14.10), 两节同码时**两节都输出**,
//      各带 emrde:sectionCodeDuplicate —— 不擅自去重、不报错。
//   3. 未填字段仍在输出里 (nullFlavor="NI"), 不是消失。
//
// 关于编码: 本仓库的 dataElement 目前多为占位码 (demo 里 27/28 共用
// DE99.99.001)。因此**每条 observation 都带 emrde:nodeId** 以便消歧, 并在
// header 的 emrde:diagnostics 里点名重复码 —— 不假装按码取值是可用的。
//
// 刻意不做的事: 不写 templateId 的权威 OID (没有可引用的注册表, 编一个就是
// 伪造); 不声称符合任何 CDA 实施指南 (不入 C-CDA/中国 CDR 的约束集合)。
// 产出的是**结构正确的 CDA 骨架**, 不是某个实施指南的合规文档。
// ============================================================

import {
  createXmlCtx, escapeXmlAttr, xmlDeclaration, xmlElement, xmlTextNode,
} from './xmlWriter'
import type { XmlBuildCtx } from './xmlWriter'
import type { FieldRecord, FieldProjection } from './fields'
import { provenanceRecord } from '@/lib/provenance'

/** HL7 v3 命名空间 —— CDA R2 的根命名空间 */
export const CDA_NS = 'urn:hl7-org:v3'
/** 本引擎的扩展命名空间 (承载 CDA 表达不了的字段: nodeId / controlType / 候选表…) */
export const EMRDE_NS = 'urn:emrde:cda:1'
/** dataElement 码的 codeSystem 标识 —— 本引擎自有的编码域, 不是 LOINC/SNOMED */
export const DATA_ELEMENT_CODE_SYSTEM = 'urn:emrde:dataelement'
/** sectionCode 的 codeSystem 标识 */
export const SECTION_CODE_SYSTEM = 'urn:emrde:section-code'
/** 无节归属内容的合成节码 —— 显式表达「这段内容没有结构归属」 */
export const UNASSIGNED_SECTION_CODE = 'UNASSIGNED'

export interface CdaDocumentMeta {
  id?: string
  title?: string
  /** 文档作者 (metadata.author / creator) */
  authorName?: string
  /** 机构 (metadata.department) */
  custodianName?: string
  /** 文档级时间 (metadata.createdAt / updatedAt) */
  effectiveTime?: Date
}

export interface CdaExportInput {
  projection: FieldProjection
  document: CdaDocumentMeta
  /** 生成时刻 —— 注入而非内取, 保证可确定复现 */
  now: Date
  /** 界面语言 (BCP-47 标签, 如 zh-CN) —— 由调用方从 locale 读, 本模块不猜 */
  language: string
}

/** CDA 时间戳: YYYYMMDDHHMMSS (手写, 不用 toLocaleDateString —— I18nGate 禁硬编码 locale) */
function cdaTime(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  )
}

/** CDA 日期: YYYYMMDD */
function cdaDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

/**
 * 值的 CDA 属性。
 *
 * 枚举字段用 **CD** (code + displayName) 而不是把显示名塞进值槽 —— 值的槽位
 * 是给机器码的, 显示名进去就把码丢了 (而本格式的全部意义就是码与名同时在)。
 * 非枚举字段才按 dataType 落到 ST / INT / TS。
 */
function valueAttrs(field: FieldRecord, rawValue: unknown): Record<string, string> {
  // 枚举: 码进 code, 名进 displayName —— 两者都在
  if (field.displaySource === 'enum' && typeof rawValue === 'string') {
    return { 'xsi:type': 'CD', code: rawValue, displayName: field.display }
  }
  switch (field.dataType) {
    case 'N': return { 'xsi:type': 'INT', value: String(rawValue) }
    case 'D': return { 'xsi:type': 'TS', value: cdaDate(new Date(String(rawValue))) }
    case 'DT': return { 'xsi:type': 'TS', value: cdaTime(new Date(String(rawValue))) }
    // 自由文本: 原值即人读文本 (没有码/名之分)
    default: return { 'xsi:type': 'ST', value: String(rawValue) }
  }
}

/**
 * 一个字段 → 一个或多个 observation。
 *
 * 多选字段产出**多条** observation: CDA 的一个 observation 只有一个 value,
 * 把多选塞进一个 ST 会造出一个下游无法可靠切分的字符串 (用顿号连接更是猜的——
 * 值本身可能含顿号)。每条各带 emrde:index 标明原始次序。
 */
function emitObservations(ctx: XmlBuildCtx, field: FieldRecord): string[] {
  const codeAttrs = {
    code: field.code.dataElement || 'UNKNOWN',
    codeSystem: DATA_ELEMENT_CODE_SYSTEM,
    codeSystemName: field.code.internal || null,
    displayName: field.name || null,
  }

  /** 与取值无关的公共子元素 */
  const commonChildren = (index: number | null, multipleCount: number): string[] => {
    const kids: string[] = []
    kids.push(xmlElement(ctx, 'emrde:nodeId', { value: field.nodeId }))
    if (field.controlType) kids.push(xmlElement(ctx, 'emrde:controlType', { value: field.controlType }))
    if (field.sectionCode) kids.push(xmlElement(ctx, 'emrde:sectionCode', { value: field.sectionCode }))
    if (field.location.tableId) {
      kids.push(xmlElement(ctx, 'emrde:tableRef', {
        tableId: field.location.tableId,
        row: field.location.cellIndex?.row ?? null,
        col: field.location.cellIndex?.col ?? null,
      }))
    }
    if (field.masked) kids.push(xmlElement(ctx, 'emrde:masked', { value: 'true' }))
    if (field.required) kids.push(xmlElement(ctx, 'emrde:required', { value: 'true' }))
    if (field.readonly) kids.push(xmlElement(ctx, 'emrde:readonly', { value: 'true' }))
    if (multipleCount > 1 && index !== null) {
      kids.push(xmlElement(ctx, 'emrde:multiple', { value: 'true', index }))
    }
    if (field.enumOptions) {
      kids.push(xmlElement(ctx, 'emrde:enumOptions', undefined,
        field.enumOptions.map((o) => xmlElement(ctx, 'emrde:option', { name: o.name, value: o.value }))))
    }
    return kids
  }

  // 多选 → 逐项一条; 标量 → 一条。未填走上面的分支, 到这里必有值。
  const values: unknown[] = Array.isArray(field.value)
    ? (field.value.length > 0 ? field.value : [null])
    : [field.value]
  const multipleCount = Array.isArray(field.value) ? field.value.length : 1

  if (!field.filled) {
    // 未填: 占位符进 <text> (人读), nullFlavor 进 <value> (机读)
    const kids = [
      ...commonChildren(null, 1),
      xmlElement(ctx, 'text', undefined, [xmlTextNode(ctx, field.placeholder)]),
      xmlElement(ctx, 'statusCode', { code: 'completed' }),
      xmlElement(ctx, 'value', { nullFlavor: 'NI' }),
    ]
    return [xmlElement(ctx, 'observation', { classCode: 'OBS', moodCode: 'EVN' }, [
      xmlElement(ctx, 'code', codeAttrs),
      ...kids,
    ])]
  }

  return values.map((v, i) => {
    const attrs = valueAttrs(field, v)
    const kids = [
      ...commonChildren(multipleCount > 1 ? i : null, multipleCount),
      // 人读文本: 显示名。机器码在 <value> 的属性里。
      xmlElement(ctx, 'text', undefined, [xmlTextNode(ctx, field.display)]),
      xmlElement(ctx, 'statusCode', { code: 'completed' }),
      xmlElement(ctx, 'value', attrs),
    ]
    return xmlElement(ctx, 'observation', { classCode: 'OBS', moodCode: 'EVN' }, [
      xmlElement(ctx, 'code', codeAttrs),
      ...kids,
    ])
  })
}

/** 一个节 → component。fields 为该节内的字段 (按阅读顺序)。 */
function emitSection(
  ctx: XmlBuildCtx,
  section: { code: string | null; anonymous: boolean; codeDuplicate: boolean } | null,
  fields: readonly FieldRecord[],
): string {
  const sectionChildren: string[] = []
  // 合成节 (section === null) 就是「无结构归属」本身 —— 它天然匿名, 必须标记,
  // 否则下游会把它当成一个真名叫 UNASSIGNED 的节。
  const anonymous = section === null || section.anonymous
  sectionChildren.push(xmlElement(ctx, 'code', {
    code: section?.code ?? UNASSIGNED_SECTION_CODE,
    codeSystem: section?.code ? SECTION_CODE_SYSTEM : `${SECTION_CODE_SYSTEM}:implicit`,
  }))
  if (anonymous) {
    sectionChildren.push(xmlElement(ctx, 'emrde:anonymous', { value: 'true' }))
  }
  if (section?.codeDuplicate) {
    sectionChildren.push(xmlElement(ctx, 'emrde:sectionCodeDuplicate', { value: 'true' }))
  }
  // 人读叙述: 该节内所有字段的「名称：显示值」逐行
  const narrative = fields
    .map((f) => `${f.name}：${f.display}`)
    .join('\n')
  sectionChildren.push(xmlElement(ctx, 'text', undefined, [xmlTextNode(ctx, narrative)]))

  for (const field of fields) {
    for (const obs of emitObservations(ctx, field)) {
      sectionChildren.push(xmlElement(ctx, 'entry', undefined, [obs]))
    }
  }

  return xmlElement(ctx, 'component', undefined, [
    xmlElement(ctx, 'section', undefined, sectionChildren),
  ])
}

export interface CdaResult {
  xml: string
  /** 转义期被剔除的 XML 非法字符数 —— 调用方必须上报, 不得静默 */
  droppedChars: number
}

/**
 * 文档 → HL7 CDA 骨架。
 *
 * 节的分组口径: 字段的 sectionId 相同即同节 (由 fields.ts 的 sectionOf 决定),
 * 节顺序按 projection.sections 的 (前序) 顺序; 无归属字段收进一个合成节 —— 放在
 * 最后, 因为它是「剩下的内容」而不是文档结构的一部分。
 */
export function buildCdaXml(input: CdaExportInput): CdaResult {
  const ctx = createXmlCtx()
  const { projection, document, now, language } = input

  const bySection = new Map<string, FieldRecord[]>()
  const orphans: FieldRecord[] = []
  for (const f of projection.fields) {
    if (f.sectionId === null) { orphans.push(f); continue }
    const list = bySection.get(f.sectionId) ?? []
    list.push(f)
    bySection.set(f.sectionId, list)
  }

  const bodyComponents: string[] = []
  for (const section of projection.sections) {
    // 空节也要输出 (契约 §31.12) —— 这正是本格式比 TXT/HTML 强的地方
    bodyComponents.push(emitSection(ctx, section, bySection.get(section.id) ?? []))
  }
  if (orphans.length > 0 || projection.sections.length === 0) {
    bodyComponents.push(emitSection(ctx, null, orphans))
  }

  const prov = provenanceRecord()

  const header: string[] = [
    xmlElement(ctx, 'realmCode', { code: 'CN' }),
    xmlElement(ctx, 'typeId', { root: '2.16.840.1.113883.1.3', extension: 'POCD_HD000040' }),
    xmlElement(ctx, 'id', { root: 'urn:emrde:document', extension: document.id ?? '' }),
    xmlElement(ctx, 'title', undefined, [xmlTextNode(ctx, document.title ?? '')]),
    xmlElement(ctx, 'effectiveTime', {
      value: cdaTime(document.effectiveTime ?? now),
    }),
    xmlElement(ctx, 'confidentialityCode', {
      code: 'N', codeSystem: '2.16.840.1.113883.5.25',
    }),
    // 界面语言由调用方给 —— 不猜、不硬编码 (I18nGate 会抓硬编码 locale)
    xmlElement(ctx, 'languageCode', { code: language }),
  ]

  if (document.authorName) {
    header.push(xmlElement(ctx, 'author', undefined, [
      xmlElement(ctx, 'assignedAuthor', undefined, [
        xmlElement(ctx, 'assignedPerson', undefined, [
          xmlElement(ctx, 'name', undefined, [xmlTextNode(ctx, document.authorName)]),
        ]),
      ]),
    ]))
  }
  if (document.custodianName) {
    header.push(xmlElement(ctx, 'custodian', undefined, [
      xmlElement(ctx, 'assignedCustodian', undefined, [
        xmlElement(ctx, 'representedCustodianOrganization', undefined, [
          xmlElement(ctx, 'name', undefined, [xmlTextNode(ctx, document.custodianName)]),
        ]),
      ]),
    ]))
  }

  // 引擎自有诊断: 重复数据元码等 —— 下游据此知道「按码取值」在本文件里不可靠
  const diagnostics: string[] = [
    xmlElement(ctx, 'emrde:fieldCount', { value: projection.diagnostics.fieldCount }),
    xmlElement(ctx, 'emrde:filledCount', { value: projection.diagnostics.filledCount }),
  ]
  for (const code of projection.diagnostics.duplicateElementCodes) {
    diagnostics.push(xmlElement(ctx, 'emrde:duplicateElementCode', { code }))
  }
  header.push(xmlElement(ctx, 'emrde:diagnostics', undefined, diagnostics))

  const structuredBody = xmlElement(ctx, 'structuredBody', undefined, bodyComponents)

  const rootAttrs: Record<string, string> = {
    xmlns: CDA_NS,
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    'xmlns:emrde': EMRDE_NS,
  }

  const provenance = xmlElement(ctx, 'emrde:provenance', {
    generator: prov.generator,
    license: prov.license,
    copyright: prov.copyright,
    token: prov.token,
  })

  const xml = xmlDeclaration() + xmlElement(ctx, 'ClinicalDocument', rootAttrs, [
    ...header,
    xmlElement(ctx, 'component', undefined, [structuredBody]),
    provenance,
  ])

  return { xml, droppedChars: ctx.droppedChars }
}

/** 属性值转义的再导出 —— 供需要自行拼片段的调用方复用 (不重复实现) */
export { escapeXmlAttr }
