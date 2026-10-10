// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

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
  ClipboardHost, PlatformHost, StorageHost,
} from '../../engine/host/EditorHost'
import type { ThemeColors } from '../../engine/state/EditorTheme'
import {
  CANVAS_TOKEN_NAMES,
  withAlpha,
  type CanvasTokenName,
} from '../../engine/state/canvasTokens'
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

/**
 * 旧 8 字段画布 CSS 变量名 —— 字段名映射从原 8 字段改为从 28 字段 token 表对应键。
 *
 * 保留原因: 历史兼容 (chromeTheme.test.ts:56-70 守护"两套命名空间不重叠" 的断言
 * 不涉及这些变量名)。值随 4 预设切换变化。**当前零渲染路径消费** —— 仍保留
 * 是因为它们是契约 §7.3 的"host.platform.applyTheme(colors)" 的对外产物。
 */
const LEGACY_THEME_CSS_VARS: Partial<Record<keyof ThemeColors, string>> = {
  pageBg: '--emr-page-bg',
  canvasBg: '--emr-canvas-bg',
  textInk: '--emr-text-color',
  secondaryInk: '--emr-chrome-bg',
  fallbackInk: '--emr-chrome-text',
  cursorColor: '--emr-cursor-color',
}

/**
 * 8 字段里的 selectionBg 与 hfBg —— 旧值用了 rgba(...) 含 alpha, 而 28 字段
 * token 表统一存 RGB 三元组, 这里走 withAlpha 拼。
 */
const LEGACY_SELECTION_VAR = '--emr-selection-bg'
const LEGACY_HF_BG_VAR = '--emr-hf-bg'

/**
 * 28 个 token 全名 → `--emr-cnv-<name>` 备而不发 (留作 runtime overlay 未来读取,
 * 当前零消费)。命名空间刻意避开 chrome 的 `--emr-surface*` / `--emr-ink*` 等
 * 19 个 chrome token, 也避开旧 8 字段的 `--emr-page-bg` 等, 互不覆盖。
 */
function cnvVarName(name: CanvasTokenName): string {
  return `--emr-cnv-${name}`
}

export class DomPlatformHost implements PlatformHost {
  readonly clipboard: ClipboardHost = new DomClipboardHost()
  readonly storage: StorageHost = new DomIndexedDBStorage()

  applyTheme(colors: ThemeColors): void {
    const root = document.documentElement

    // ---- 旧 8 字段 (pageBg/canvasBg/textInk/secondaryInk/fallbackInk/cursorColor) ----
    for (const [key, varName] of Object.entries(LEGACY_THEME_CSS_VARS) as [keyof ThemeColors, string][]) {
      const v = colors[key]
      if (typeof v === 'string' && v.length > 0) {
        // token 是 "R G B" 三元组, 旧 CSS 变量接受 'rgb(R, G, B)' 形态
        root.style.setProperty(varName, `rgb(${v.replace(/\s+/g, ', ')})`)
      }
    }

    // ---- 旧 selectionBg / hfBg (alpha 形态) ----
    if (typeof colors.selectionBg === 'string') {
      root.style.setProperty(LEGACY_SELECTION_VAR, withAlpha(colors.selectionBg, 0.3))
    }
    if (typeof colors.pageBg === 'string') {
      root.style.setProperty(LEGACY_HF_BG_VAR, `rgb(${colors.pageBg.replace(/\s+/g, ', ')})`)
    }

    // ---- 28 个 --emr-cnv-* 备而不发 ----
    for (const name of CANVAS_TOKEN_NAMES) {
      const v = colors[name]
      if (typeof v === 'string' && v.length > 0) {
        root.style.setProperty(cnvVarName(name), v)
      }
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

  onBeforeUnload(cb: () => void): () => void {
    window.addEventListener('beforeunload', cb)
    return () => window.removeEventListener('beforeunload', cb)
  }
}