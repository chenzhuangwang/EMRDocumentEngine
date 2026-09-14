// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// EditorHost — 平台能力边界 (契约 §27)
//
// 纯类型, 零 DOM / 零浏览器依赖。
//
// 平台能力只能通过 Host 接口进入 engine,
// engine 不得直接访问 document / window / navigator (契约 §28)。
//
// 依赖方向 (契约 §27):
//
//     platform/dom
//         ↓
//     engine/
//
// 禁止: engine/ → platform/
// ============================================================

import type { FontMetrics } from '../layout/text/FontMetrics'
import type { FontDescriptor } from '../layout/text/FontManager'
import type { ThemeColors } from '../state/EditorTheme'
import type { DocumentTree } from '../document/core/DocumentModel'

// ---- 文本测量结果 (engine 自有类型, 非 DOM TextMetrics) ----

export interface TextMeasurement {
  width: number
  fontBoundingBoxAscent?: number
  fontBoundingBoxDescent?: number
  actualBoundingBoxAscent?: number
  actualBoundingBoxDescent?: number
}

// ---- TextHost — 文本测量 + 字体度量 ----

export interface TextHost {
  /** 测量文本宽度 (font 为 CSS font 描述串) */
  measure(text: string, font: string): TextMeasurement
  /** 提取字体度量 (upem=1000 归一化) */
  getFontMetrics(family: string, weight: number, style: string): FontMetrics
}

// ---- FontHost — 字体可用性 + 生命周期 ----

export interface FontHost {
  /** 单字符在指定字体下是否可用 (替代 document.fonts.check(font, char)) */
  isGlyphAvailable(family: string, char: string): boolean
  /** 字体族是否已加载可用 (替代 document.fonts.check(font)) */
  isFontAvailable(family: string, weight: number, style: string): boolean
  /** 等待字体就绪 (替代 document.fonts.ready) */
  onReady(): Promise<void>
  /** 注册/加载字体 (替代 FontFace + document.fonts.add) */
  loadFont(descriptor: FontDescriptor): Promise<void>
  /** 查询系统可用字体列表 (替代 queryLocalFonts) */
  querySystemFonts(): Promise<string[]>
}

// ---- SurfaceHost — 渲染表面生命周期 (契约 §27.2) ----

export type LayerKind = 'static' | 'content' | 'interact'

/**
 * 一层可绘制画布 — 平台创建并挂载; 引擎只持注入的 ctx + 委托元素级操作。
 * width/height 为物理像素尺寸 (resize 后更新)。
 */
export interface CanvasSurface {
  /** 注入的 2D 绘图上下文 (契约 §28 例外) */
  readonly ctx: CanvasRenderingContext2D
  /** 作为 CanvasImageSource 供 createPattern / drawImage (契约 §28 例外) */
  readonly imageSource: CanvasImageSource
  /** 物理像素宽 (resize 设置) */
  readonly width: number
  /** 物理像素高 (resize 设置) */
  readonly height: number
  /** 同步尺寸: 物理像素 + CSS 尺寸 */
  resize(physicalW: number, physicalH: number, cssW: number, cssH: number): void
  /** 滚动反偏移: 绝对定位画布 top */
  setTop(cssTopPx: number): void
  /** 相对视口的 client 位置 (仅 left/top, 供 IME 定位) */
  getBoundingClientRect(): { left: number; top: number }
  /** 导出 dataURL (打印) */
  toDataURL(type?: string): string
  /** 从 DOM 移除 */
  remove(): void
}

export interface SurfaceHost {
  /** 创建一层渲染画布 (platform 负责 createElement + getContext + append) */
  createLayer(kind: LayerKind): CanvasSurface
  /** 创建离屏画布 (水印 pattern / 打印) */
  createOffscreen(width: number, height: number): CanvasSurface
  /** 创建滚动占位元素 */
  createSpacer(): { setHeight(cssHeightPx: number): void; remove(): void }
  /** 加载图片 (替代 new Image()) */
  loadImage(url: string): Promise<{ width: number; height: number; source: CanvasImageSource }>
  /** 设备像素比 (替代 window.devicePixelRatio) */
  devicePixelRatio(): number
  /** 帧调度 (替代 requestAnimationFrame) */
  requestFrame(cb: () => void): number
  /** 取消帧调度 */
  cancelFrame(id: number): void
}

// ---- ViewportHost — 视口尺寸 + 容器几何 (契约 §27.1) ----

export interface ViewportHost {
  /** 视口 CSS 尺寸 (替代 container.clientWidth/Height) */
  size(): { width: number; height: number }
  /** 容器相对视口的位置 (替代 container.getBoundingClientRect, 供 screen→doc) */
  bounds(): { left: number; top: number }
}

// ---- InputHost — 交互能力 (契约 §27.1) ----
//
// IME surface (hidden textarea) + 容器/全局事件监听 + 光标样式。
// 事件载荷类型 (KeyboardEvent/MouseEvent) 由平台注入, 引擎从不构造,
// 与 CanvasRenderingContext2D 同列于 §28 例外 (注入类型)。

export interface CaretRect {
  left: number
  top: number
  width: number
  height: number
}

/** 隐藏 textarea 包装 — 平台创建并挂载, 引擎只管合成回调 + 光标定位 */
export interface ImeSurface {
  onCompositionStart(cb: () => void): void
  onCompositionUpdate(cb: (text: string) => void): void
  onCompositionEnd(cb: (text: string) => void): void
  onInput(cb: (value: string) => void): void
  /** 定位隐藏 textarea — 浏览器据此定位 IME 候选窗 */
  updateCursorRect(rect: CaretRect): void
  focus(): void
  getValue(): string
  setValue(v: string): void
  remove(): void
}

export interface ContainerListeners {
  keydown?: (e: KeyboardEvent) => void
  mousedown?: (e: MouseEvent) => void
  click?: (e: MouseEvent) => void
  mouseup?: (e: MouseEvent) => void
  mouseleave?: (e: MouseEvent) => void
}

export interface GlobalListeners {
  mousemove?: (e: MouseEvent) => void
  mouseup?: (e: MouseEvent) => void
  focus?: () => void
  visibilitychange?: () => void
}

export interface InputHost {
  createImeSurface(): ImeSurface
  /** 挂容器事件, 返回 detach 闭包 */
  attachContainer(listeners: ContainerListeners): () => void
  /** 挂 window/document 全局事件, 返回 detach 闭包 */
  attachGlobal(listeners: GlobalListeners): () => void
  /** 文档当前是否可见 (替代 document.visibilityState === 'visible') */
  isVisible(): boolean
  /** 设置容器光标样式 (替代 container.style.cursor) */
  setCursor(cursor: string): void
}

// ---- PlatformHost — 平台能力 (契约 §27.1) ----
//
// 主题 chrome / 系统剪贴板 / 埋点上报 / 离屏 HTML 测量 / 卸载生命周期 /
// 自动保存持久化 (StorageHost)。
// 全部经平台注入, engine 不再触碰 document/window/navigator/indexedDB (契约 §28)。

export interface ClipboardHost {
  /** 写系统剪贴板纯文本 — 最佳努力, 永不 reject (无剪贴板/非安全上下文静默降级) */
  writeText(text: string): Promise<void>
  /** 读系统剪贴板纯文本 — 不可用时 reject, 调用方用 canRead() 前置判定 */
  readText(): Promise<string>
  /** 是否支持读 (替代 navigator.clipboard?.readText 判空) */
  canRead(): boolean
}

export interface HtmlMeasureResult {
  width: number
  height: number
  /** 元素 textContent (供 Canvas fillText 回退绘制) */
  text: string
}

/** 自动保存快照 — 引擎域类型, 定义在 host 边界 (契约 §19: host 不反向依赖 feature) */
export interface SaveSnapshot {
  id: string
  documentId: string
  title: string
  tree: DocumentTree
  savedAt: number
  version: number
}

/** 自动保存持久化 — 引擎只做域逻辑 (快照构造/防抖/保留策略), 传输交平台 (契约 §27.1) */
export interface StorageHost {
  /** 初始化底层存储 (建库/建表/建索引), 就绪后 resolve */
  init(): Promise<void>
  /** 写入/覆盖一条快照 (按 id upsert) */
  put(snapshot: SaveSnapshot): Promise<void>
  /** 取某文档全部快照 (顺序未定义, 引擎自行 sort/reduce) */
  list(documentId: string): Promise<SaveSnapshot[]>
  /** 批量删除指定 id 的快照 */
  remove(ids: string[]): Promise<void>
  /** 关闭底层存储 */
  close(): void
}

export interface PlatformHost {
  /** 应用主题颜色到平台 chrome (DOM 下映射为 :root CSS 变量) */
  applyTheme(colors: ThemeColors): void
  clipboard: ClipboardHost
  /** 上报性能埋点 (payload 已由 engine 序列化为 JSON 字符串; 平台负责 Blob + sendBeacon) */
  sendBeacon(url: string, data: string): void
  /** 离屏测量一段 HTML 在给定字号下的尺寸 + 文本内容 (KaTeX) */
  measureHtml(html: string, fontSize: number): HtmlMeasureResult
  /** 页面卸载前回调, 返回 detach 闭包 (替代 window.addEventListener('beforeunload')) */
  onBeforeUnload(cb: () => void): () => void
  /** 自动保存持久化 (替代 indexedDB 直连) */
  storage: StorageHost
}

// ---- EditorHost — 聚合 ----
//
// 终态六元组 (契约 §27.1):
//
//     interface EditorHost {
//       text: TextHost; font: FontHost;
//       surface: SurfaceHost; viewport: ViewportHost;
//       input: InputHost; platform: PlatformHost;
//     }
export interface EditorHost {
  text: TextHost
  font: FontHost
  surface: SurfaceHost
  viewport: ViewportHost
  input: InputHost
  platform: PlatformHost
}
