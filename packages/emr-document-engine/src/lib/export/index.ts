// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// lib/export — 导出 / 打印特性层的分发入口 (契约 §32)
//
// 这是分包 `./export` 子路径的 source entry。汇总文档导出 (纯文本 / HTML /
// 结构化元素 / HL7 CDA / OFD) 、打印任务规则与导出取证溯源。
//
// 与引擎核心的关系: 本层**消费** engine, 不被 engine 依赖 (§12 特性层)。
// 与 ./dom / ./react 不同, 本层是纯函数层, 无 DOM 副作用 —— 但 fflate (ZIP)
// 是运行期依赖, 由 package.json 的 dependencies 提供, 不内联进产物。
//
// 注意: 本层文件一律用相对路径 import (契约 §32.1), 别名不会写进 .d.ts。
// ============================================================

// ---- 文档 → 纯文本 / HTML ----
export {
  getListMarker,
  collectParagraphText,
  collectTableText,
  buildExportText,
  collectParagraphRuns,
  buildExportHtml,
} from '../documentExport'
export type { ExportPool } from '../documentExport'

// ---- 文档 → 字段清单语义投影 (三个结构化导出共用的唯一一份) ----
export { collectFields } from './fields'
export type {
  FieldPool,
  FieldRegion,
  FieldLocation,
  FieldRecord,
  SectionRecord,
  FieldProjection,
  TemplateDefinitionLike,
  TemplateDefinitionSource,
  FieldProjectionInput,
  DisplaySource,
} from './fields'

// ---- 结构化元素 JSON ----
export {
  buildElementsDocument,
  ELEMENTS_SCHEMA_VERSION,
  ELEMENTS_KIND,
} from './elementsExport'
export type { ElementsDocumentMeta, ElementsExportInput } from './elementsExport'

// ---- HL7 CDA R2 ----
export {
  buildCdaXml,
  CDA_NS,
  EMRDE_NS,
  DATA_ELEMENT_CODE_SYSTEM,
  SECTION_CODE_SYSTEM,
  UNASSIGNED_SECTION_CODE,
} from './cdaExport'
export type { CdaDocumentMeta, CdaExportInput, CdaResult } from './cdaExport'

// ---- OFD ----
export { buildOfd, deriveBusinessMeta, OFD_SIGNATURE_ENTRIES } from './ofd/buildOfd'
export type {
  OfdDocumentMeta,
  OfdBuildInput,
  OfdBuildResult,
  OfdSignaturePort,
} from './ofd/buildOfd'
export {
  buildOfdModel,
  mm,
  boxStr,
  toOfdColor,
  MM_PER_PX,
} from './ofd/ofdModel'
export type {
  OfdModel,
  OfdModelInput,
  OfdPage,
  OfdObject,
  OfdBox,
  OfdWarning,
  CharAdvancePort,
  FieldTextPort,
} from './ofd/ofdModel'
export {
  buildOfdEntries,
  buildOfdEntryPoint,
  buildOfdDocument,
  buildOfdExtensions,
  buildOfdPublicRes,
  buildOfdDocumentRes,
  buildOfdPage,
  buildOfdClinicalData,
  decodeDataUrl,
} from './ofd/ofdXml'
export type { OfdEntry, OfdDocInfo, OfdBusinessMeta, OfdXmlInput } from './ofd/ofdXml'
export {
  OFD_NS,
  EMRH_NS,
  META_KEYS,
  OFD_H_TERM,
  termOf,
  CLINICAL_DATA_PATH,
  CLINICAL_DATA_FULL_PATH,
  EXTENSION_NAME,
} from './ofd/ofdHMapping'
export type { MetaKey } from './ofd/ofdHMapping'

// ---- ZIP 容器 (fflate 封装; 字节可复现) ----
export { buildZip } from './zipWriter'
export type { ZipEntry, ZipOptions } from './zipWriter'

// ---- XML 组装 ----
// escapeXmlAttr 同时经 cdaExport re-export 到本层, 两处指向同一实现;
// 显式从源头导出以避免 export * 冲突时该名字被静默丢弃。
export {
  createXmlCtx,
  sanitizeXmlChars,
  escapeXmlText,
  escapeXmlAttr,
  xmlTextNode,
  xmlElement,
  xmlDeclaration,
} from './xmlWriter'
export type { XmlText, XmlBuildCtx, XmlAttrs } from './xmlWriter'

// ---- 打印任务规则 (范围钳制 / 完成判定 / 续打断点) ----
export {
  printDocKey,
  resolvePrintRange,
  selectPrintPages,
  isPrintFinished,
  buildPrintRecord,
} from '../printJob'
export type { PrintRecord, PrintRange, PrintJobContext } from '../printJob'

// ---- 导出取证溯源 (IP-POLICY 第 3 节) ----
export {
  currentProvenance,
  encodeMarker,
  decodeMarker,
  provenanceMetaTags,
  provenanceRecord,
  stampExportHtml,
  stampExportText,
  stampExportObject,
  stampExportXml,
  GENERATOR_NAME,
  GENERATOR_VERSION,
  HOLDER_PREIMAGE,
  HOLDER_HASH8,
} from '../provenance'
export type { ProvenanceInfo } from '../provenance'
