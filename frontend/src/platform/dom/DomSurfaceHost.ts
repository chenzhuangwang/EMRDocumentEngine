// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// DomSurfaceHost — 浏览器渲染表面宿主实现 (契约 §27.2)
//
// 在 platform/dom 内创建 / 挂载 canvas, 经 SurfaceHost/ViewportHost
// 供 engine 使用。engine 只拿到注入的 ctx, 不触碰 canvas 元素本身。
//
// 依赖方向: platform/dom → engine/host (单向, 契约 §27)
// ============================================================

import type {
  CanvasSurface, SurfaceHost, ViewportHost, LayerKind,
} from '../../engine/host/EditorHost'

/** 平台内部的 canvas 包装 — 持有真实 DOM canvas, 对外只暴露 CanvasSurface */
class DomCanvasSurface implements CanvasSurface {
  readonly ctx: CanvasRenderingContext2D
  width: number
  height: number

  constructor(readonly element: HTMLCanvasElement) {
    this.ctx = element.getContext('2d')!
    this.width = element.width
    this.height = element.height
  }

  get imageSource(): CanvasImageSource {
    return this.element
  }

  resize(physicalW: number, physicalH: number, cssW: number, cssH: number): void {
    this.width = physicalW
    this.height = physicalH
    this.element.width = physicalW
    this.element.height = physicalH
    this.element.style.width = `${cssW}px`
    this.element.style.height = `${cssH}px`
  }

  setTop(cssTopPx: number): void {
    this.element.style.top = `${cssTopPx}px`
  }

  getBoundingClientRect(): { left: number; top: number } {
    const r = this.element.getBoundingClientRect()
    return { left: r.left, top: r.top }
  }

  toDataURL(type?: string): string {
    return this.element.toDataURL(type)
  }

  remove(): void {
    this.element.remove()
  }
}

export class DomSurfaceHost implements SurfaceHost, ViewportHost {
  private container: HTMLElement | null = null

  /** 绑定宿主容器 (平台边界在构造 Editor 前调用) */
  mount(container: HTMLElement): void {
    this.container = container
  }

  createLayer(kind: LayerKind): CanvasSurface {
    const container = this.requireContainer()
    const canvas = document.createElement('canvas')
    canvas.style.position = 'absolute'
    canvas.style.top = '0'
    canvas.style.left = '0'
    canvas.style.pointerEvents = 'auto'
    // 层叠顺序: static(1) < content(2) < interact(3)
    canvas.style.zIndex = kind === 'static' ? '1' : kind === 'content' ? '2' : '3'
    container.appendChild(canvas)
    return new DomCanvasSurface(canvas)
  }

  createOffscreen(width: number, height: number): CanvasSurface {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return new DomCanvasSurface(canvas)
  }

  createSpacer(): { setHeight(cssHeightPx: number): void; remove(): void } {
    const container = this.requireContainer()
    const div = document.createElement('div')
    div.style.pointerEvents = 'none'
    div.style.width = '1px'
    container.appendChild(div)
    return {
      setHeight(cssHeightPx: number) { div.style.height = `${cssHeightPx}px` },
      remove() { div.remove() },
    }
  }

  loadImage(url: string): Promise<{ width: number; height: number; source: CanvasImageSource }> {
    // 与旧 new Image() + onload 行为一致: 加载失败时不 resolve (静默不显示)
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve({ width: img.width, height: img.height, source: img })
      img.src = url
    })
  }

  devicePixelRatio(): number {
    return window.devicePixelRatio || 1
  }

  requestFrame(cb: () => void): number {
    return requestAnimationFrame(cb)
  }

  cancelFrame(id: number): void {
    cancelAnimationFrame(id)
  }

  size(): { width: number; height: number } {
    const c = this.container
    if (!c) return { width: 0, height: 0 }
    return { width: c.clientWidth, height: c.clientHeight }
  }

  bounds(): { left: number; top: number } {
    const c = this.container
    if (!c) return { left: 0, top: 0 }
    const r = c.getBoundingClientRect()
    return { left: r.left, top: r.top }
  }

  private requireContainer(): HTMLElement {
    if (!this.container) {
      throw new Error('[DomSurfaceHost] mount(container) must be called before creating layers.')
    }
    return this.container
  }
}
