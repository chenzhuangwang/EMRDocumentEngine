// ================================================================
// EditorVersion — 引擎代码版本 (架构 Phase 2, 2026-08-27)
//
// 标识当前运行的引擎代码版本。随每次 release 变化。
//
// 与 DocumentFormatVersion 严格区分:
//   - EditorVersion      → "当前是哪个版本的代码"
//   - DocumentFormatVersion → "当前代码能读写哪个版本的文档格式"
//
// 两者通常绑定 (Editor v21 → 支持 DocFormat v4), 但分开定义。
// ================================================================

/** 引擎代码版本 (semver) */
export interface EditorVersion {
  major: number
  minor: number
  patch: number
}

/** 当前引擎版本 (2026-08-27: v21) */
export const EDITOR_VERSION: EditorVersion = { major: 21, minor: 0, patch: 0 }