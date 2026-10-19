// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// Zustand 全局状态管理
// ============================================================

import { create } from 'zustand'
import type { UserInfo } from '@/services/api'
import { readStoredChromePreset } from '@/platform/chrome/chromeTheme'
import type { ThemePreset, LocaleMessages, LocaleParams } from '@emrde/document-engine'

// ---- 编辑器状态 (app 级状态, 架构 §7.1) ----

/** 引擎上报的最近一次错误 (ErrorRecovery → setErrorReporter)。瞬态, 不序列化。 */
export interface EngineErrorNotice {
  code: string
  message: string
  /**
   * 文案键 + 参数 —— 让状态栏能**重译**。
   *
   * `message` 是上报那一刻展开的快照, 切语言不会变; 带键后 UI 可 `t(key, params)`
   * 现算, 语言一变提示就跟着变。引擎侧的错误都带键; UI 自造的 message 可以不带。
   */
  key?: keyof LocaleMessages
  params?: LocaleParams
}

/**
 * 用户手动关掉过的错误。同一条之后不再弹 ——
 * 否则逐帧失败的页面每帧都重报一次, 状态栏里那条提示**永远关不掉**。
 *
 * 去重键**优先用 key+params 而非 message**: message 是当前语言下的展开结果,
 * 若拿它做键, 切一次语言同一条错误就会"变成新错误"重新弹出, 用户关不掉。
 * 无键 (UI 自造的 message) 时退回 message, 与既有行为一致。
 */
let dismissedErrorKey: string | null = null
const errorKeyOf = (e: EngineErrorNotice) =>
  e.key ? `${e.code}|${e.key}|${JSON.stringify(e.params ?? null)}` : `${e.code}|${e.message}`

interface EditorState {
  /** 在线协作人数 (Phase 2 collab 预留, 当前未接线 → 恒为 0) */
  onlineUsers: number
  /**
   * 引擎错误 (Level 2/3 容错报告)。
   *
   * 这是 setErrorReporter 的**落点** —— 在此之前引擎的错误只能走 console.error,
   * 用户看不到任何东西 (页面渲染失败只留一张占位图, 没有任何说明)。
   */
  lastEngineError: EngineErrorNotice | null

  setOnlineUsers: (count: number) => void
  reportEngineError: (err: EngineErrorNotice) => void
  dismissEngineError: () => void
}

export const useEditorStore = create<EditorState>((set) => ({
  onlineUsers: 0,
  lastEngineError: null,

  setOnlineUsers: (onlineUsers) => set({ onlineUsers }),

  reportEngineError: (err) => set((s) => {
    const key = errorKeyOf(err)
    // 同一条错误重复上报 → 不动 state (逐帧失败会每帧报一次, 每次 set 都会重渲染)
    if (dismissedErrorKey === key) return s
    if (s.lastEngineError && errorKeyOf(s.lastEngineError) === key) return s
    return { lastEngineError: err }
  }),

  dismissEngineError: () => set((s) => {
    dismissedErrorKey = s.lastEngineError ? errorKeyOf(s.lastEngineError) : null
    return { lastEngineError: null }
  }),
}))

// ---- 用户状态 ----

interface UserState {
  user: UserInfo | null
  isAuthenticated: boolean
  setUser: (user: UserInfo | null) => void
  logout: () => void
}

export const useUserStore = create<UserState>((set) => ({
  user: null,
  isAuthenticated: false,
  setUser: (user) => set({ user, isAuthenticated: !!user }),
  logout: () => {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    set({ user: null, isAuthenticated: false })
  },
}))

// ---- UI 状态 ----

/** 侧栏标签页 —— 单一定义, 避免状态字段与 setter 各写一份联合而漏改其一 */
export type SidebarTab = 'templates' | 'elements' | 'pages' | 'comments' | 'qc' | 'revisions'

interface UIState {
  sidebarOpen: boolean
  sidebarTab: SidebarTab
  /**
   * chrome (界面外壳) 主题预设。
   *
   * owner 在这里而不是 EditorStore: 主题要覆盖 HomePage / ComparePage, 那两页
   * **不挂 EditorProvider**, 放 EditorStore 会变成 per-Editor 事实, 主页拿不到
   * (契约 §7.1 把 application settings 判给 Zustand)。
   *
   * 注意: 这里只存"选了什么"; 写 CSS 变量/落盘的副作用由 main.tsx 的
   * bootstrap 订阅统一处理, 使任何调用方 set 都能生效, 不会漏接。
   */
  themePreset: ThemePreset

  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setSidebarTab: (tab: SidebarTab) => void
  setThemePreset: (preset: ThemePreset) => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: false,
  sidebarTab: 'templates',
  themePreset: readStoredChromePreset(),

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setThemePreset: (themePreset) => set({ themePreset }),
}))
