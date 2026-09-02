// ================================================================
// ControlHitTest — 设计模式控件命中检测纯函数 (契约 §12.3)
//
// 在展平的 SLIFPage items 中查找包围盒含点 (docX, docY) 的 smarttext
// 控件, 返回其 nodeId; 未命中返回 null。
//
// 坐标口径与 Draw.renderDesignSelection / MouseHandler.hitTestControl
// 同源: 页面局部坐标 (page-local), 经 getFlatPageItems 展平, 含表格
// cell 内偏移。提取为纯函数以便脱离 Editor/DOM 单测。
// ================================================================

import type { SLIFPage } from '../layout/core/SLIF'
import { getFlatPageItems } from '../layout/core/SLIF'

/** 在页面展平 items 中查找命中点 (docX, docY) 的 smarttext 控件 nodeId */
export function findControlItemAt(page: SLIFPage, docX: number, docY: number): string | null {
  for (const item of getFlatPageItems(page)) {
    if (item.nodeType !== 'smarttext') continue
    const w = item.width || 0
    const h = item.height || item.ascent + item.descent
    if (docX >= item.x && docX <= item.x + w && docY >= item.y && docY <= item.y + h) {
      return item.nodeId
    }
  }
  return null
}
