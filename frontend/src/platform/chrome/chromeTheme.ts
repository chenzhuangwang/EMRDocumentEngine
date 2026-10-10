// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// chromeTheme — 界面外壳 (chrome) 主题化
//
// 与引擎的 EditorTheme 是**两套并存**的东西, 不要合并:
// - EditorTheme → `applyTheme()` → DomPlatformHost → 引擎的 8 个画布变量
//   (`--emr-page-bg` / `--emr-canvas-bg` / ...)。本批**不动**, 仍零消费。
// - 本文件 → 外壳的 15 个 chrome 变量 (`--emr-surface*` / `--emr-ink*` /
//   `--emr-line*` / `--emr-desk`), 由 Tailwind 的 `chrome-*` / `line-*` 配色消费。
//
// 变量名刻意与引擎的 8 个**不重名**, 将来画布主题化时两套互不覆盖。
// 本文件直接触碰 document 是合法的: 它就住在应用外壳层 platform/chrome/,
// 与 platform/data 同级 —— 这里本来就是浏览器专属能力/数据的地盘 (契约 §27)。
// ============================================================

import type { ThemePreset } from '@emrde/document-engine'
import { CHROME_TOKENS, CHROME_TOKEN_NAMES, chromeCssVar } from './chromeTokens'

/** localStorage 键 —— 与 `emr.locale` 同前缀 (i18n 批次会加同族键) */
export const CHROME_THEME_STORAGE_KEY = 'emr.theme'

export interface ChromePresetMeta {
  preset: ThemePreset
}

/**
 * 主题预设清单 —— **只描述"有哪些预设"**, 不带显示名。
 *
 * 显示名 (label / hint) 属 i18n 文案, 统一在 `engine/i18n` 的 `theme.*` 键里
 * (见 ThemeMenu 的 PRESET_KEYS)。此前本文件存过一份 zh/en 双语 label,
 * 与语言包重复且不随语言包更新 —— 那份副本已删。
 */
export const CHROME_PRESETS: readonly ChromePresetMeta[] = [
  { preset: 'standard' },
  { preset: 'eyeCare' },
  { preset: 'print' },
  { preset: 'dark' },
]

/** 运行时收窄 —— localStorage / 外部输入可能给出任意字符串 */
export function isThemePreset(value: unknown): value is ThemePreset {
  // 用 hasOwnProperty 而非 `in`: `in` 会沿原型链命中 'toString' 这类键, 让脏数据过关
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CHROME_TOKENS, value)
}

/**
 * 原生控件的配色方案 —— 滚动条 / `<select>` 弹出层 / 日期选择器 / 自动填充
 * 这几类由**浏览器自己绘制**, 不吃 CSS 变量, `color-scheme` 是唯一能影响它们
 * 的开关。不设的话深色外壳里会冒出一条亮色滚动条和白底下拉框。
 */
const COLOR_SCHEME: Record<ThemePreset, 'light' | 'dark'> = {
  standard: 'light',
  eyeCare: 'light',
  print: 'light',
  dark: 'dark',
}

// ---- 应用 ----

/**
 * 把预设写入 `:root` 的 CSS 变量, 并打上 `data-theme` 便于断言/调试。
 *
 * 幂等: 只做 `setProperty`, 不做任何增删节点 —— React StrictMode 双跑、
 * 重复调用都安全。
 *
 * 未知 preset (运行时脏数据) 回落到 standard 而不是抛错, 也不写半套变量:
 * 宁可整套退回默认, 也不要留下"面变了线没变"的半吊子外观。
 */
export function applyChromeTheme(preset: ThemePreset): void {
  if (typeof document === 'undefined') return

  const resolved: ThemePreset = isThemePreset(preset) ? preset : 'standard'
  const tokens = CHROME_TOKENS[resolved]
  const root = document.documentElement

  for (const name of CHROME_TOKEN_NAMES) {
    root.style.setProperty(chromeCssVar(name), tokens[name])
  }
  root.style.colorScheme = COLOR_SCHEME[resolved]
  root.dataset.theme = resolved
}

// ---- 持久化 ----

/** 读回上次选择; 无记录 / 脏数据 / localStorage 不可用 → standard */
export function readStoredChromePreset(): ThemePreset {
  try {
    const raw = localStorage.getItem(CHROME_THEME_STORAGE_KEY)
    return isThemePreset(raw) ? raw : 'standard'
  } catch {
    return 'standard'
  }
}

/** 写入本次选择; localStorage 不可用 (隐私模式/配额) 时静默 —— 主题本身已生效 */
export function storeChromePreset(preset: ThemePreset): void {
  try {
    localStorage.setItem(CHROME_THEME_STORAGE_KEY, preset)
  } catch {
    /* 静默: 持久化失败不影响本次会话的主题 */
  }
}
