// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// InputComposer — IME 输入法抽象层 (架构 §8.4, v20.34)
//
// 封装浏览器 composition 事件差异 (Chrome/Firefox/Safari)
// 向上暴露统一事件, 向下经 ImeSurface (InputHost) 封装 hidden textarea
// ================================================================

import type { CaretRect, ImeSurface, EditorHost } from '../host/EditorHost'

export type { CaretRect }

export class InputComposer {
  private ime: ImeSurface
  composing = false
  private compositionJustEnded = false
  private callbacks = {
    start: [] as (() => void)[],
    update: [] as ((text: string) => void)[],
    end: [] as ((text: string) => void)[],
  }

  constructor(host: EditorHost) {
    this.ime = host.input.createImeSurface()

    this.ime.onCompositionStart(() => {
      this.composing = true; this.compositionJustEnded = false
      this.callbacks.start.forEach(cb => cb())
    })
    this.ime.onCompositionUpdate((text) => {
      this.callbacks.update.forEach(cb => cb(text))
    })
    this.ime.onCompositionEnd((text) => {
      this.composing = false; this.compositionJustEnded = true
      this.ime.setValue('')
      if (text) this.callbacks.end.forEach(cb => cb(text))
      setTimeout(() => { this.compositionJustEnded = false }, 50)
    })
    // Firefox/Safari 去重
    this.ime.onInput((val) => {
      if (this.compositionJustEnded || this.composing) return
      if (val) { this.callbacks.end.forEach(cb => cb(val)); this.ime.setValue('') }
    })
  }

  onCompositionStart(cb: () => void): void { this.callbacks.start.push(cb) }
  onCompositionUpdate(cb: (text: string) => void): void { this.callbacks.update.push(cb) }
  onCompositionEnd(cb: (text: string) => void): void { this.callbacks.end.push(cb) }

  /** 更新隐藏 textarea 位置 — 浏览器据此定位 IME 候选窗 */
  updateCursorRect(rect: CaretRect): void {
    this.ime.updateCursorRect(rect)
  }

  focus(): void { this.ime.focus() }
  destroy(): void { this.ime.remove() }
}
