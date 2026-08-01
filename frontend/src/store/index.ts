// ============================================================
// Zustand 全局状态管理
// ============================================================

import { create } from 'zustand'
import type { DocumentDetail, UserInfo } from '@/services/api'

// ---- 编辑器状态 ----

interface EditorState {
  mode: string
  pageMode: string
  documentId: string | null
  document: DocumentDetail | null
  isDirty: boolean
  saveStatus: 'saved' | 'saving' | 'unsaved' | 'error'
  onlineUsers: number
  validationResults: ValidationResult[]
  paragraphStyle: { alignment?: string; listType?: string; indent?: number } | null

  setMode: (mode: string) => void
  setPageMode: (mode: string) => void
  setDocument: (doc: DocumentDetail | null) => void
  setDirty: (dirty: boolean) => void
  setSaveStatus: (status: 'saved' | 'saving' | 'unsaved' | 'error') => void
  setOnlineUsers: (count: number) => void
  setValidationResults: (results: ValidationResult[]) => void
  setParagraphStyle: (style: { alignment?: string; listType?: string; indent?: number } | null) => void
}


export interface ValidationResult {
  elementId: string
  valid: boolean
  message?: string
}

export const useEditorStore = create<EditorState>((set) => ({
  mode: 'edit',
  pageMode: 'paging',
  documentId: null,
  document: null,
  isDirty: false,
  saveStatus: 'saved',
  onlineUsers: 0,
  validationResults: [],

  setMode: (mode) => set({ mode }),
  setPageMode: (pageMode) => set({ pageMode }),
  setDocument: (document) => set({ document, isDirty: false, saveStatus: 'saved' }),
  setDirty: (isDirty) => set({ isDirty, saveStatus: isDirty ? 'unsaved' : 'saved' }),
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  setOnlineUsers: (onlineUsers) => set({ onlineUsers }),
  setValidationResults: (validationResults) => set({ validationResults }),
  setParagraphStyle: (paragraphStyle) => set({ paragraphStyle }),
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
  sidebarTab: 'templates' | 'elements' | 'pages'

  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setPropertiesPanelOpen: (open: boolean) => void
  setSidebarTab: (tab: 'templates' | 'elements' | 'pages') => void
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
