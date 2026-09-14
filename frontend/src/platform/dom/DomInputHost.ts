// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// DomInputHost — 浏览器交互宿主实现 (契约 §27.1)
//
// 在 platform/dom 内创建 hidden textarea (IME surface) + 挂事件监听,
// 经 InputHost 供 engine 使用。engine 不触碰 textarea / document / window。
//
// 依赖方向: platform/dom → engine/host (单向, 契约 §27)
// ============================================================

import type {
  InputHost, ImeSurface, CaretRect,
  ContainerListeners, GlobalListeners,
} from '../../engine/host/EditorHost'

/** 平台内部的 hidden textarea 包装 — 持有真实 DOM textarea, 对外只暴露 ImeSurface */
class DomImeSurface implements ImeSurface {
  constructor(private readonly textarea: HTMLTextAreaElement) {}

  onCompositionStart(cb: () => void): void {
    this.textarea.addEventListener('compositionstart', () => cb())
  }

  onCompositionUpdate(cb: (text: string) => void): void {
    this.textarea.addEventListener('compositionupdate', (e: CompositionEvent) => cb(e.data || ''))
  }

  onCompositionEnd(cb: (text: string) => void): void {
    this.textarea.addEventListener('compositionend', (e: CompositionEvent) => cb(e.data || ''))
  }

  onInput(cb: (value: string) => void): void {
    this.textarea.addEventListener('input', () => cb(this.textarea.value))
  }

  updateCursorRect(rect: CaretRect): void {
    Object.assign(this.textarea.style, {
      left: `${rect.left}px`,
      top: `${rect.top + rect.height}px`,
      width: `${Math.max(rect.width, 1)}px`,
      height: `${Math.max(rect.height, 1)}px`,
      fontSize: '1px',
      lineHeight: '1px',
      padding: '0',
    })
  }

  focus(): void {
    this.textarea.focus()
  }

  getValue(): string {
    return this.textarea.value
  }

  setValue(v: string): void {
    this.textarea.value = v
  }

  remove(): void {
    this.textarea.remove()
  }
}

export class DomInputHost implements InputHost {
  private container: HTMLElement | null = null

  /** 绑定宿主容器 (平台边界在构造 Editor 前调用) */
  mount(container: HTMLElement): void {
    this.container = container
  }

  createImeSurface(): ImeSurface {
    const container = this.requireContainer()
    const textarea = document.createElement('textarea')
    Object.assign(textarea.style, {
      position: 'fixed', opacity: '0', width: '1px', height: '1px',
      left: '0', top: '0', border: 'none', outline: 'none',
      resize: 'none', overflow: 'hidden',
      fontSize: '1px', lineHeight: '1px', padding: '0',
    })
    container.appendChild(textarea)
    return new DomImeSurface(textarea)
  }

  attachContainer(listeners: ContainerListeners): () => void {
    const container = this.requireContainer()
    if (listeners.keydown) container.addEventListener('keydown', listeners.keydown)
    if (listeners.mousedown) container.addEventListener('mousedown', listeners.mousedown)
    if (listeners.click) container.addEventListener('click', listeners.click)
    if (listeners.mouseup) container.addEventListener('mouseup', listeners.mouseup)
    if (listeners.mouseleave) container.addEventListener('mouseleave', listeners.mouseleave)
    return () => {
      if (listeners.keydown) container.removeEventListener('keydown', listeners.keydown)
      if (listeners.mousedown) container.removeEventListener('mousedown', listeners.mousedown)
      if (listeners.click) container.removeEventListener('click', listeners.click)
      if (listeners.mouseup) container.removeEventListener('mouseup', listeners.mouseup)
      if (listeners.mouseleave) container.removeEventListener('mouseleave', listeners.mouseleave)
    }
  }

  attachGlobal(listeners: GlobalListeners): () => void {
    if (listeners.mousemove) window.addEventListener('mousemove', listeners.mousemove)
    if (listeners.mouseup) window.addEventListener('mouseup', listeners.mouseup)
    if (listeners.focus) window.addEventListener('focus', listeners.focus)
    if (listeners.visibilitychange) document.addEventListener('visibilitychange', listeners.visibilitychange)
    return () => {
      if (listeners.mousemove) window.removeEventListener('mousemove', listeners.mousemove)
      if (listeners.mouseup) window.removeEventListener('mouseup', listeners.mouseup)
      if (listeners.focus) window.removeEventListener('focus', listeners.focus)
      if (listeners.visibilitychange) document.removeEventListener('visibilitychange', listeners.visibilitychange)
    }
  }

  isVisible(): boolean {
    return document.visibilityState === 'visible'
  }

  setCursor(cursor: string): void {
    const container = this.requireContainer()
    container.style.cursor = cursor
  }

  private requireContainer(): HTMLElement {
    if (!this.container) {
      throw new Error('[DomInputHost] mount(container) must be called before creating IME surface / attaching listeners.')
    }
    return this.container
  }
}
