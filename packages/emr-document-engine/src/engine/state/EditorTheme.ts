// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// EditorTheme — 编辑器主题 (engine canvas theme, v6.0)
//
// 4 预设: standard / eyeCare / print / dark
// 数据来源: canvasTokens.ts (4 预设 × 28 token, 纯数据)
// 落地: EditorTheme.setTheme() → host.platform.applyTheme(this.colors) →
//   DomPlatformHost 把 8 个旧画布变量 + 28 个 --emr-cnv-* 写到 :root
//
// Draw / 各 Particle 通过 RenderOptions.tokenSet 在每次 render 入口拍快照
// 读取 (内存对象, 同步可见; 不依赖 CSS 变量回流)。
// ============================================================

import type { EditorHost } from '../host/EditorHost'
import { CANVAS_TOKENS, STANDARD_CANVAS_TOKENS } from './canvasTokens'
import type { CanvasTokenSet } from './canvasTokens'
import type { EventBus } from '../interaction/EventBus'

export type ThemePreset = 'standard' | 'eyeCare' | 'print' | 'dark'

/**
 * 历史别名 —— 旧版 8 字段接口, 现委托到 canvasTokens 的 28 字段 CanvasTokenSet。
 * DomPlatformHost.applyTheme(colors: ThemeColors) 仍编译。
 */
export type ThemeColors = CanvasTokenSet

/** 运行时收窄 —— 防止 localStorage / 外部脏数据 */
export function isThemePreset(value: unknown): value is ThemePreset {
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(CANVAS_TOKENS, value)
}

export class EditorTheme {
  private host: EditorHost
  private current: ThemePreset = 'standard'
  private eventBus: EventBus | null = null

  constructor(host: EditorHost) {
    this.host = host
  }

  /** 注入事件总线 —— setTheme 同步发 'canvas-theme:changed' 用 */
  attachEventBus(bus: EventBus): void {
    if (this.eventBus === bus) return
    this.eventBus = bus
  }

  /** 当前预设 */
  get preset(): ThemePreset { return this.current }

  /** 当前预设下的完整 28 token 表 (内存对象引用; Draw render() 入口拍快照用) */
  get colors(): CanvasTokenSet { return CANVAS_TOKENS[this.current] }

  /** colors 别名, 更明确语义 */
  get tokenSet(): CanvasTokenSet { return this.colors }

  /**
   * 切换预设。同步:
   *   1. 写内部 preset
   *   2. 落 CSS 变量 (经 host.platform.applyTheme, 履约 §7.3)
   *   3. 同步发 'canvas-theme:changed' 事件 (供日志 / 调试; Draw 直接读 colors)
   *
   * 非法 preset 早退 (不抛, 不写)。同值早退。
   */
  setTheme(preset: ThemePreset): boolean {
    if (!isThemePreset(preset)) return false
    if (this.current === preset) return false
    this.current = preset
    this.apply()
    this.eventBus?.emit('canvas-theme:changed', preset)
    return true
  }

  /** 落 CSS 变量 —— 经 PlatformHost, 不直接触碰 DOM (契约 §28) */
  apply(): void {
    this.host.platform.applyTheme(this.colors)
  }

  /** 重置为默认主题 */
  reset(): void {
    this.setTheme('standard')
  }
}

/** standard 预设的 token 表 —— 兜底值, 防止首帧 / 漏注入 */
export { STANDARD_CANVAS_TOKENS }