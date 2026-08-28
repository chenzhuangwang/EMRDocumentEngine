// ============================================================
// platform/dom — 浏览器宿主实现 (契约 §27)
//
// 依赖方向: platform/dom → engine (单向)
// ============================================================

import type { EditorHost } from '../../engine/host/EditorHost'
import { DomTextHost, createDomTextHost } from './DomTextHost'
import { DomSurfaceHost } from './DomSurfaceHost'
import { DomInputHost } from './DomInputHost'
import { DomPlatformHost } from './DomPlatformHost'

export { DomTextHost, createDomTextHost }
export { DomSurfaceHost }
export { DomInputHost }
export { DomPlatformHost }

/** 浏览器 EditorHost — surface/viewport 合并为同一 DomSurfaceHost; input/platform 独立 */
export interface DomEditorHost extends EditorHost {
  surface: DomSurfaceHost
  viewport: DomSurfaceHost
  input: DomInputHost
  platform: DomPlatformHost
}

/**
 * 构建浏览器 EditorHost。
 *
 * text/font 合并为 DomTextHost; surface/viewport 合并为 DomSurfaceHost;
 * input 为 DomInputHost, platform 为 DomPlatformHost (边界稳定后再按需拆分, 契约 §27.1)。
 *
 * 模块加载安全 (契约 §29): 无 DOM 副作用, surface/input 需显式 mount(container)。
 */
export function createDomEditorHost(): DomEditorHost {
  const textHost = createDomTextHost()
  const surface = new DomSurfaceHost()
  return {
    text: textHost,
    font: textHost,
    surface,
    viewport: surface,
    input: new DomInputHost(),
    platform: new DomPlatformHost(),
  }
}
