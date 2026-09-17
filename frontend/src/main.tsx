// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { useUIStore } from './store'
import { applyChromeTheme, storeChromePreset } from './platform/dom/chromeTheme'
import { bootstrapLocale } from './i18n/bootstrap'
import { installErrorReporter } from './errorReporting'

// ---- 引擎错误上报落点 ----
// ErrorRecovery 的三级容错默认只 console.error, 用户侧零感知。接上落点后由
// StatusBar 呈现 (实现与理由见 errorReporting.ts)。
installErrorReporter()

// ---- i18n bootstrap ----
//
// 同样必须在 render() 之前: 否则首帧恒是中文, 选英文的人每次刷新先闪一下。
bootstrapLocale()

// ---- chrome 主题 bootstrap ----
//
// 必须在 createRoot().render() **之前**同步跑完: 否则首帧会是 standard,
// 选深色的用户每次刷新都先看到一帧白, 再跳成暗色。
//
// 订阅放在这一处而不是各个调用点 (菜单 onClick 等), 保证任何地方
// setThemePreset 都会真正落到 DOM —— 这正是本仓库反复出现的"改了 state
// 但没人接线"死接缝的成因, 用一个订阅面兜住。
applyChromeTheme(useUIStore.getState().themePreset)
useUIStore.subscribe((state, prev) => {
  if (state.themePreset === prev.themePreset) return
  applyChromeTheme(state.themePreset)
  storeChromePreset(state.themePreset)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
