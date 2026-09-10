// ================================================================
// ControlHitTest — 设计模式 + 运行时控件命中检测纯函数 (契约 §12.3/§12.6)
//
// 设计模式 (findControlItemEntryAt / findControlItemAt): 整节点粗命中,
//   用于选中控件做属性编辑/移动 —— 语义正确, 不经过运行时命中。
//
// 运行时 (findRuntimeControlHitAt): 拓扑分离命中 ——
//   - field   → computeControlBox (与 Render 同源, 含 minWidth/affordance)
//   - options → 从入口直接 layoutControlOptions 逐选项几何命中, 空白区
//               不返回整体 node (不变量 2: 永不退回「整个 node 一个 box」)
//
// 坐标口径与 Draw.renderDesignSelection / MouseHandler 同源: 页面局部坐标
// (page-local), 经 getFlatPageItems 展平, 含表格 cell 内偏移。纯函数,
// 便于脱离 Editor/DOM 单测。
// ================================================================

import type { SLIFPage, SLIFItem } from '../layout/core/SLIF'
import { getFlatPageItems } from '../layout/core/SLIF'
import type { TextMeasurer } from '../layout/text/TextMeasurer'
import type { ElementEnumOption } from '../document/core/DocumentModel'
import { computeControlBox } from '../document/control/ControlBox'
import { layoutControlOptions } from '../document/control/ControlOptions'

/** 在页面展平 items 中查找命中点 (docX, docY) 的 smarttext 控件 SLIFItem (含完整几何) */
export function findControlItemEntryAt(page: SLIFPage, docX: number, docY: number): SLIFItem | null {
  for (const item of getFlatPageItems(page)) {
    if (item.nodeType !== 'smarttext') continue
    const w = item.width || 0
    const h = item.height || item.ascent + item.descent
    if (docX >= item.x && docX <= item.x + w && docY >= item.y && docY <= item.y + h) {
      return item
    }
  }
  // 页眉 (相对页顶 y=0) / 页脚 (相对 footer 带顶) 的控件同样可命中
  for (const item of page.headerItems ?? []) {
    if (item.nodeType !== 'smarttext') continue
    const w = item.width || 0
    const h = item.height || item.ascent + item.descent
    if (docX >= item.x && docX <= item.x + w && docY >= item.y && docY <= item.y + h) return item
  }
  const footerTop = page.height - (page.footerHeight ?? 42)
  for (const item of page.footerItems ?? []) {
    if (item.nodeType !== 'smarttext') continue
    const w = item.width || 0
    const h = item.height || item.ascent + item.descent
    const itemY = footerTop + item.y
    if (docX >= item.x && docX <= item.x + w && docY >= itemY && docY <= itemY + h) return item
  }
  return null
}

/** 在页面展平 items 中查找命中点 (docX, docY) 的 smarttext 控件 nodeId */
export function findControlItemAt(page: SLIFPage, docX: number, docY: number): string | null {
  return findControlItemEntryAt(page, docX, docY)?.nodeId ?? null
}

/** 运行时命中解析 (per-nodeId 投影, 供 findRuntimeControlHitAt 消费) */
export interface RuntimeControlResolve {
  /** 视觉拓扑: recipe.kind (field/options) */
  kind: 'field' | 'options'
  /** 表现层 minWidth (Render/HitTest 同源) */
  minWidth?: number | string
  /** 候选项 (options 拓扑) */
  options?: readonly ElementEnumOption[]
  /** widget 形态 (options 拓扑为 'checkbox' | 'radio') */
  controlType?: string
  /** 附属字面量 (占位宽需一并计入命中几何) */
  label?: string
  prefix?: string
  suffix?: string
}

/** 运行时命中结果 */
export type RuntimeControlHit =
  | { kind: 'field'; item: SLIFItem }
  | { kind: 'option'; item: SLIFItem; option: ElementEnumOption }

/**
 * 运行时控件命中 (拓扑分离, 契约 §12.6)。
 *
 * @param resolve  按 nodeId 返回拓扑 + minWidth + options。测量语义与 Layout
 *                 同源 (同 font/size/bold/italic), 杜绝「Layout 测 A、HitTest 测 B」。
 */
export function findRuntimeControlHitAt(
  page: SLIFPage,
  docX: number,
  docY: number,
  resolve: (nodeId: string) => RuntimeControlResolve | undefined,
  measurer: TextMeasurer,
): RuntimeControlHit | null {
  const tryItems = (items: readonly SLIFItem[], bandTop: number): RuntimeControlHit | null => {
    for (const item of items) {
      if (item.nodeType !== 'smarttext') continue
      const r = resolve(item.nodeId)
      if (!r) continue

      const fontSize = item.size || 16
      const ascent = item.ascent > 0 ? item.ascent : fontSize * 0.8
      const descent = item.descent > 0 ? item.descent : fontSize * 0.2
      const lineH = ascent + descent
      const itemY = bandTop + item.y
      const font = item.font || 'SimSun'
      const size = item.size || 16
      const mw = (t: string) => measurer.measureWidth(t, { font, size, bold: item.bold, italic: item.italic })
      const leadW = (r.label ? mw(r.label) : 0) + (r.prefix ? mw(r.prefix) : 0)
      const trailW = r.suffix ? mw(r.suffix) : 0

      if (r.kind === 'field') {
        const layoutW = (item.width || 0) - (item.markerWidth || 0)
        const boxW = Math.max(0, layoutW - leadW - trailW)
        const box = computeControlBox(item.x + leadW, itemY, boxW, ascent, descent, r.minWidth)
        if (docX >= box.x && docX <= box.x + box.w && docY >= box.y && docY <= box.y + box.h) {
          return { kind: 'field', item }
        }
        continue
      }

      // options 拓扑
      const opts = r.options ?? []
      if (opts.length === 0) continue
      if (docY < itemY || docY > itemY + lineH) continue

      const layout = layoutControlOptions(
        opts,
        r.controlType === 'radio' ? 'radio' : 'checkbox',
        mw,
      )
      const relX = docX - (item.x + leadW)
      for (let i = 0; i < layout.length; i++) {
        const opt = layout[i]
        if (relX >= opt.x && relX <= opt.x + opt.width) {
          return { kind: 'option', item, option: opts[i] }
        }
      }
    }
    return null
  }

  // 正文 (含表格 cell) → 页眉 (页顶 y=0) → 页脚 (footer 带顶)
  const body = tryItems(getFlatPageItems(page), 0)
  if (body) return body
  const header = tryItems(page.headerItems ?? [], 0)
  if (header) return header
  return tryItems(page.footerItems ?? [], page.height - (page.footerHeight ?? 42))
}
