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
  paragraphStyle: { alignment?: string; listType?: string; indent?: number; outlineLevel?: number } | null
  /** 光标处文本样式 (供 Toolbar 按钮状态同步) */
  textStyle: {
    font?: string; size?: number
    bold?: boolean; italic?: boolean; underline?: boolean
    strikeout?: boolean; superscript?: boolean; subscript?: boolean
    color?: string
  } | null
  /** 页眉页脚编辑状态 (TASK-470) */
  headerFooterEdit: { active: boolean; section: 'header' | 'footer' }
  headerFooterConfig: { differentFirstPage: boolean; differentOddEven: boolean }

  setMode: (mode: string) => void
  setPageMode: (mode: string) => void
  setDocument: (doc: DocumentDetail | null) => void
  setDirty: (dirty: boolean) => void
  setSaveStatus: (status: 'saved' | 'saving' | 'unsaved' | 'error') => void
  setOnlineUsers: (count: number) => void
  setValidationResults: (results: ValidationResult[]) => void
  setParagraphStyle: (style: { alignment?: string; listType?: string; indent?: number; outlineLevel?: number } | null) => void
  setTextStyle: (style: {
    font?: string; size?: number
    bold?: boolean; italic?: boolean; underline?: boolean
    strikeout?: boolean; superscript?: boolean; subscript?: boolean
    color?: string
  } | null) => void
  /** 格式刷状态 (TASK-472) */
  formatPainter: { active: boolean; style: Record<string, unknown> | null }
  setFormatPainter: (active: boolean, style?: Record<string, unknown> | null) => void
  /** 撤销/重做状态 (供 Toolbar 按钮禁用态) */
  canUndo: boolean
  canRedo: boolean
  setCanUndoRedo: (canUndo: boolean, canRedo: boolean) => void
  /** 激活/关闭页眉页脚编辑 */
  setHeaderFooterEdit: (active: boolean, section?: 'header' | 'footer') => void
  setHeaderFooterConfig: (patch: Partial<{ differentFirstPage: boolean; differentOddEven: boolean }>) => void
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
  paragraphStyle: null,
  textStyle: null,
  formatPainter: { active: false, style: null },
  canUndo: false,
  canRedo: false,
  headerFooterEdit: { active: false, section: 'header' },
  headerFooterConfig: { differentFirstPage: false, differentOddEven: false },

  setMode: (mode) => set({ mode }),
  setPageMode: (pageMode) => set({ pageMode }),
  setDocument: (document) => set({ document, isDirty: false, saveStatus: 'saved' }),
  setDirty: (isDirty) => set({ isDirty, saveStatus: isDirty ? 'unsaved' : 'saved' }),
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  setOnlineUsers: (onlineUsers) => set({ onlineUsers }),
  setValidationResults: (validationResults) => set({ validationResults }),
  setParagraphStyle: (paragraphStyle) => set({ paragraphStyle }),
  setTextStyle: (textStyle) => set({ textStyle }),
  setFormatPainter: (active, style = null) => set({ formatPainter: { active, style } }),
  setCanUndoRedo: (canUndo, canRedo) => set({ canUndo, canRedo }),
  setHeaderFooterEdit: (active, section) =>
    set({ headerFooterEdit: { active, section: section || 'header' } }),
  setHeaderFooterConfig: (patch) =>
    set((s) => ({ headerFooterConfig: { ...s.headerFooterConfig, ...patch } })),
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
