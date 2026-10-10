// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// i18n bootstrap — 渲染前把语言定下来, 并接管后续变更的落盘与 <html lang>
//
// 必须在 createRoot().render() **之前**跑: 否则首帧恒是 zh-CN, 选英文的人
// 每次刷新都先闪一下中文。(与 chrome 主题的 bootstrap 同一个理由, 同一个位置。)
// ============================================================

import { locale, type Locale } from '@emrde/document-engine'

/** localStorage 键 —— 与 `emr.theme` 同族前缀 */
export const LOCALE_STORAGE_KEY = 'emr.locale'

export interface LocaleMeta {
  locale: Locale
  /** 菜单显示名 (用该语言自己的写法, 不随界面语言变) */
  label: string
}

export const LOCALES: readonly LocaleMeta[] = [
  { locale: 'zh-CN', label: '简体中文' },
  { locale: 'en-US', label: 'English' },
]

export function isLocale(value: unknown): value is Locale {
  return LOCALES.some((l) => l.locale === value)
}

/** 读回上次选择; 无记录 / 脏数据 / localStorage 不可用 → zh-CN */
export function readStoredLocale(): Locale {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY)
    return isLocale(raw) ? raw : 'zh-CN'
  } catch {
    return 'zh-CN'
  }
}

/** 写入本次选择; localStorage 不可用 (隐私模式/配额) 时静默 —— 语言本身已生效 */
export function storeLocale(next: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, next)
  } catch {
    /* 静默: 持久化失败不影响本次会话 */
  }
}

/**
 * 应用语言到引擎与 DOM, 并挂上后续变更的同步。
 *
 * `<html lang>` 必须跟着变 —— index.html 里写死的是 `lang="zh-CN"`,
 * 不更新就是一句谎话 (屏幕阅读器/断行规则/字体回退都读它)。
 */
function applyLocale(next: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = next
  storeLocale(next)
}

/** 渲染前调用一次。返回启动时的语言。 */
export function bootstrapLocale(): Locale {
  const initial = readStoredLocale()
  locale.setLocale(initial)
  applyLocale(initial)

  // 订阅放在这一处而不是菜单 onClick: 任何地方 setLocale 都会落盘 + 更新 lang,
  // 不留"改了 state 但 DOM 没变"的死接缝 (本仓库的高频陷阱)。
  locale.subscribe(() => applyLocale(locale.getLocale()))
  return initial
}
