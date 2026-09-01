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
//
// SLIF 是 layout 中间输出, 不独立演化 — 用 type alias 复用本类型。
// ================================================================

/** 文档格式版本 (semver) */
export interface DocumentFormatVersion {
  major: number
  minor: number
  patch: number
}

/** 当前引擎支持的最高文档格式版本 */
export const CURRENT_DOCUMENT_VERSION: DocumentFormatVersion = { major: 4, minor: 2, patch: 0 }

/** 与 CURRENT_DOCUMENT_VERSION 对齐 (SLIF 是中间格式, 派生自文档格式) */
export type SLIFVersion = DocumentFormatVersion

/** 当前 SLIF 版本 */
export const CURRENT_SLIF_VERSION: SLIFVersion = CURRENT_DOCUMENT_VERSION

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