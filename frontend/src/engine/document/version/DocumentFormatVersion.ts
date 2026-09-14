// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// DocumentFormatVersion — 文档格式版本 (架构 Phase 2, 2026-08-27)
//
// 文档 schema 的语义化版本。仅在文档格式发生破坏性变化时升级。
//
// 版本号语义:
//   - Major: 破坏性变更 (字段重命名, 类型变化, 必填字段新增)
//   - Minor: 向后兼容的功能性新增 (可选字段)
//   - Patch: 注释 / 字段顺序调整等无影响变更
//
// 演化历史 (实际注册的升级规则):
//   v1.0.0 → v2.0.0  新增 modelVersion 字段 (R67, v6.0)
//   v2.0.0 → v3.0.0  body.children 迁移为 ID 引用 (breaking)
//   v3.0.0 → v4.0.0  新增 pageSetup.orientation 默认值
//   v4.0.0 → v4.1.0  ElementFormat 新增可选字段 (scale/minRows/enums)
//   v4.1.0 → v4.2.0  SmartTextNode 新增可选字段 value (运行时值)
//   v4.2.0 → v4.3.0  DocumentTree.metadata 收紧为 DocumentMetadata (白名单收口)
//   v4.3.0 → v4.4.0  TemplateDefinition 新增可选字段 controlType (控件 widget 形态)
//   v4.4.0 → v4.5.0  DocumentTree 新增可选页眉/页脚变体数组 (首页/偶数页, 契约 §7.9)
//
// SLIF 是 layout 中间输出, 但 SLIFVersion 是名义独立版本域 (契约 §26.14),
// 不通过 type alias 复用 DocumentFormatVersion。
// ================================================================

/** 文档格式版本 (semver) */
export interface DocumentFormatVersion {
  major: number
  minor: number
  patch: number
}

/** 当前引擎支持的最高文档格式版本 */
export const CURRENT_DOCUMENT_VERSION: DocumentFormatVersion = { major: 4, minor: 5, patch: 0 }

/** 缺失 modelVersion 时视为的文档格式版本 (历史文档默认值) */
export const LEGACY_DOCUMENT_VERSION = '1.0.0'

/**
 * SLIF 格式版本 — 名义独立类型 (契约 §26.3/§26.13/§26.14)。
 *
 * 与 DocumentFormatVersion 结构性分离: 即使数值当前相等, 二者也是
 * 不同版本域, 不得互相赋值 — brand 字段在编译期强制分离。
 */
export interface SLIFVersion {
  /** 名义标记: 与 DocumentFormatVersion 区分 (契约 §26.14) */
  readonly __slifVersionDomain: 'SLIF'
  major: number
  minor: number
  patch: number
}

/** 当前 SLIF 版本 (独立常量, 不得引用 CURRENT_DOCUMENT_VERSION 对象) */
export const CURRENT_SLIF_VERSION: SLIFVersion = {
  __slifVersionDomain: 'SLIF',
  major: 4,
  minor: 2,
  patch: 0,
}

// ---- 版本比较工具 (从 ModelUpgrader 迁移至此) ----

/** 从 "x.y.z" 字符串解析为结构化版本 */
export function parseVersion(v: string): DocumentFormatVersion {
  const [major, minor, patch] = v.split('.').map(Number)
  return { major: major || 0, minor: minor || 0, patch: patch || 0 }
}

/** 版本比较: a < b 返回负数, a > b 返回正数, a === b 返回 0 */
export function compareVersions(a: DocumentFormatVersion | string, b: DocumentFormatVersion | string): number {
  const va = typeof a === 'string' ? parseVersion(a) : a
  const vb = typeof b === 'string' ? parseVersion(b) : b
  if (va.major !== vb.major) return va.major - vb.major
  if (va.minor !== vb.minor) return va.minor - vb.minor
  return va.patch - vb.patch
}

/** 结构化版本 → "x.y.z" 字符串 */
export function versionToString(v: DocumentFormatVersion): string {
  return `${v.major}.${v.minor}.${v.patch}`
}