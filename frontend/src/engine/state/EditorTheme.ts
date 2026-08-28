// ============================================================
// EditorTheme — 编辑器主题系统 (R49, v6.0)
//
// 4 预设: standard / eyeCare / print / dark
// 主题颜色注入到平台 chrome (DOM 下映射为 :root CSS 变量), 经 PlatformHost
// ============================================================

import type { EditorHost } from '../host/EditorHost'

export type ThemePreset = 'standard' | 'eyeCare' | 'print' | 'dark'

export interface ThemeColors {
  /** 页面背景 */
  pageBg: string
  /** 画布背景 */
  canvasBg: string
  /** 正文文字颜色 */
  textColor: string
  /** 工具栏/状态栏背景 */
  chromeBg: string
  /** chrome 文字 */
  chromeText: string
  /** 选中高亮 */
  selectionBg: string
  /** 光标颜色 */
  cursorColor: string
  /** 页眉页脚背景 */
  hfBg: string
}

const THEMES: Record<ThemePreset, ThemeColors> = {
  standard: {
    pageBg: '#FFFFFF',
    canvasBg: '#F5F5F5',
    textColor: '#1F2937',
    chromeBg: '#FFFFFF',
    chromeText: '#374151',
    selectionBg: 'rgba(59, 130, 246, 0.3)',
    cursorColor: '#1F2937',
    hfBg: '#F9FAFB',
  },
  eyeCare: {
    pageBg: '#F5F0E8',
    canvasBg: '#EAE3D9',
    textColor: '#3D3226',
    chromeBg: '#F5F0E8',
    chromeText: '#5C4B3A',
    selectionBg: 'rgba(180, 140, 100, 0.3)',
    cursorColor: '#3D3226',
    hfBg: '#EDE5D8',
  },
  print: {
    pageBg: '#FFFFFF',
    canvasBg: '#FFFFFF',
    textColor: '#000000',
    chromeBg: '#FFFFFF',
    chromeText: '#000000',
    selectionBg: 'rgba(0, 0, 0, 0.15)',
    cursorColor: '#000000',
    hfBg: '#FAFAFA',
  },
  dark: {
    pageBg: '#1E1E1E',
    canvasBg: '#2D2D2D',
    textColor: '#E5E5E5',
    chromeBg: '#252525',
    chromeText: '#CCCCCC',
    selectionBg: 'rgba(59, 130, 246, 0.4)',
    cursorColor: '#FFFFFF',
    hfBg: '#2A2A2A',
  },
}

export class EditorTheme {
  private host: EditorHost
  private current: ThemePreset = 'standard'

  constructor(host: EditorHost) {
    this.host = host
  }

  /** 获取当前主题 */
  get preset(): ThemePreset { return this.current }

  /** 获取当前颜色 */
  get colors(): ThemeColors { return THEMES[this.current] }

  /** 切换主题 */
  setTheme(preset: ThemePreset): void {
    this.current = preset
    this.apply()
  }

  /** 应用主题到平台 chrome (契约 §28: 经 PlatformHost, 不直接触碰 DOM) */
  apply(): void {
    this.host.platform.applyTheme(this.colors)
  }

  /** 重置为默认主题 */
  reset(): void { this.setTheme('standard') }
}
