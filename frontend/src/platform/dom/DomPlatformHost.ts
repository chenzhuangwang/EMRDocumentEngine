// ============================================================
// DomPlatformHost — 浏览器平台能力宿主实现 (契约 §27.1)
//
// 在 platform/dom 内集中浏览器专属能力: 主题 chrome / 系统剪贴板 /
// 埋点上报 / 离屏 HTML 测量 / 卸载生命周期 / 自动保存持久化 (IndexedDB)。
// engine 经 PlatformHost 注入语义化能力, 不触碰 document/window/navigator/indexedDB。
//
// 依赖方向: platform/dom → engine/host (单向, 契约 §27)
// ============================================================

import type {
  ClipboardHost, HtmlMeasureResult, PlatformHost, StorageHost,
} from '../../engine/host/EditorHost'
import type { ThemeColors } from '../../engine/state/EditorTheme'
import { DomIndexedDBStorage } from './DomStorageHost'

/** 系统剪贴板 — 最佳努力, 非安全上下文/无剪贴板时静默降级 */
class DomClipboardHost implements ClipboardHost {
  canRead(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.clipboard?.readText
  }

  writeText(text: string): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return Promise.resolve()
    }
    return navigator.clipboard.writeText(text).catch(() => { /* 静默降级 */ })
  }

  readText(): Promise<string> {
    if (!this.canRead()) {
      return Promise.reject(new Error('[DomClipboardHost] clipboard read unavailable'))
    }
    return navigator.clipboard.readText()
  }
}

/** ThemeColors 字段 → :root CSS 变量名映射 (与旧 EditorTheme.apply 字面一致) */
const THEME_CSS_VARS: Record<keyof ThemeColors, string> = {
  pageBg: '--emr-page-bg',
  canvasBg: '--emr-canvas-bg',
  textColor: '--emr-text-color',
  chromeBg: '--emr-chrome-bg',
  chromeText: '--emr-chrome-text',
  selectionBg: '--emr-selection-bg',
  cursorColor: '--emr-cursor-color',
  hfBg: '--emr-hf-bg',
}

// ---- 离屏测量容器 (复用单例) ----

let measureContainer: HTMLDivElement | null = null

function getMeasureContainer(): HTMLDivElement {
  if (!measureContainer) {
    measureContainer = document.createElement('div')
    measureContainer.style.cssText =
      'position:absolute;visibility:hidden;width:auto;height:auto;white-space:nowrap;pointer-events:none;'
    document.body.appendChild(measureContainer)
  }
  return measureContainer
}

export class DomPlatformHost implements PlatformHost {
  readonly clipboard: ClipboardHost = new DomClipboardHost()
  readonly storage: StorageHost = new DomIndexedDBStorage()

  applyTheme(colors: ThemeColors): void {
    const root = document.documentElement
    for (const key of Object.keys(THEME_CSS_VARS) as (keyof ThemeColors)[]) {
      root.style.setProperty(THEME_CSS_VARS[key], colors[key])
    }
  }

  sendBeacon(url: string, data: string): void {
    try {
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const blob = new Blob([data], { type: 'application/json' })
        navigator.sendBeacon(url, blob)
      }
    } catch { /* 静默 */ }
  }

  measureHtml(html: string, fontSize: number): HtmlMeasureResult {
    const container = getMeasureContainer()
    container.innerHTML = html
    const span = container.querySelector('.katex') as HTMLSpanElement
    if (span) span.style.fontSize = `${fontSize}px`

    const rect = container.getBoundingClientRect()
    return { width: rect.width, height: rect.height, text: container.textContent || '' }
  }

  onBeforeUnload(cb: () => void): () => void {
    window.addEventListener('beforeunload', cb)
    return () => window.removeEventListener('beforeunload', cb)
  }
}
