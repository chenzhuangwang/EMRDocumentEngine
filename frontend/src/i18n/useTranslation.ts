// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// i18n React 绑定
//
// 引擎的 `locale` 单例自带 version/subscribe (契约 §27.3), 这里只做
// useSyncExternalStore 桥 —— 与 EditorProvider 的 useEditorStoreSnapshot
// 是同一个范式, 不另造一套。
//
// 为什么不放 EditorProvider: HomePage / ComparePage **不挂** EditorProvider,
// 把 hook 塞进去会让主页一调就抛错。locale 本就是 app-wide 的, 不依附 Editor。
//
// ⚠ 不调本 hook、直接用模块级 `t()` 的组件**不会**在切语言后刷新 —— 见文件尾。
// ============================================================

import { useMemo, useSyncExternalStore } from 'react'
import { locale, type Locale, type LocaleMessages, type LocaleParams } from '@/engine'

/** 订阅语言变更并返回当前语言 */
export function useLocale(): Locale {
  useSyncExternalStore(
    (onChange) => locale.subscribe(onChange),
    () => locale.getVersion(),
    () => 0, // SSR / 无 DOM 环境: 版本恒 0, 与引擎默认语言一致
  )
  return locale.getLocale()
}

export interface Translation {
  locale: Locale
  /** 带插值/复数的翻译函数 (见 engine formatMessage) */
  t: (key: keyof LocaleMessages, params?: LocaleParams) => string
  setLocale: (next: Locale) => void
}

/**
 * 组件里取翻译的推荐入口。
 *
 * 返回的 `t` 是从单例现读的 (不是快照), 所以拿到的一定是当前语言;
 * 订阅保证语言一变本组件就重渲染。
 */
export function useTranslation(): Translation {
  const current = useLocale()
  return useMemo(
    () => ({
      locale: current,
      t: (key, params) => locale.t(key, params),
      setLocale: (next) => locale.setLocale(next),
    }),
    [current],
  )
}
