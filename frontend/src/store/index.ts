// ============================================================
// Zustand 全局状态管理
// ============================================================

import { create } from 'zustand'
import type { UserInfo } from '@/services/api'

// ---- 编辑器状态 (app 级状态, 架构 §7.1) ----

interface EditorState {
  /** 在线协作人数 (Phase 2 collab 预留, 当前未接线 → 恒为 0) */
  onlineUsers: number

  setOnlineUsers: (count: number) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  onlineUsers: 0,

  setOnlineUsers: (onlineUsers) => set({ onlineUsers }),
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

interface UIState {
  sidebarOpen: boolean
  propertiesPanelOpen: boolean
  sidebarTab: 'templates' | 'elements' | 'pages' | 'comments'

  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setPropertiesPanelOpen: (open: boolean) => void
  setSidebarTab: (tab: 'templates' | 'elements' | 'pages' | 'comments') => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: false,
  propertiesPanelOpen: false,
  sidebarTab: 'templates',

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setPropertiesPanelOpen: (propertiesPanelOpen) => set({ propertiesPanelOpen }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
}))
