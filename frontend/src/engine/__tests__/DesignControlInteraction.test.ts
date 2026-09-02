// ================================================================
// DesignControlInteraction — 设计模式控件交互 (契约 §12.3)
//
// 验证:
//   A. findControlItemAt 纯命中检测 — 正文 / 表格 cell 内 smarttext
//      包围盒命中、未命中、非 smarttext 忽略。
//   B. EditorStore 设计选中/悬停字段 — 唯一受控写入、同值去重、
//      版本号递增 (供 useSyncExternalStore 检测变更)。
// ================================================================

import { describe, it, expect } from 'vitest'
import { findControlItemAt } from '../interaction/ControlHitTest'
import { EditorStore } from '../state/EditorStore'
import type { SLIFItem, SLIFPage } from '../layout/core/SLIF'

function makeSmartItem(nodeId: string, x: number, y: number, width: number, height: number): SLIFItem {
  return {
    nodeId, nodeType: 'smarttext', type: 'smarttext',
    text: '[姓名]', x, y, width, height, ascent: height, descent: 0,
    font: 'SimSun', size: 16,
  }
}

function makeTextItem(nodeId: string, x: number, y: number, width: number, height: number): SLIFItem {
  return {
    nodeId, nodeType: 'text', type: 'text',
    text: '普通文本', x, y, width, height, ascent: height, descent: 0,
    font: 'SimSun', size: 16,
  }
}

function makePage(items: SLIFItem[]): SLIFPage {
  return { pageIndex: 0, width: 400, height: 600, items }
}

describe('findControlItemAt — 设计模式控件命中 (契约 §12.3)', () => {
  it('命中 smarttext 包围盒 → 返回 nodeId', () => {
    const page = makePage([makeSmartItem('st-1', 10, 20, 40, 16)])
    expect(findControlItemAt(page, 30, 28)).toBe('st-1')
  })

  it('点落在包围盒外 → 返回 null', () => {
    const page = makePage([makeSmartItem('st-1', 10, 20, 40, 16)])
    expect(findControlItemAt(page, 5, 25)).toBeNull()   // 左侧外
    expect(findControlItemAt(page, 60, 25)).toBeNull()  // 右侧外
    expect(findControlItemAt(page, 30, 10)).toBeNull()  // 上方外
    expect(findControlItemAt(page, 30, 40)).toBeNull()  // 下方外
  })

  it('非 smarttext 项 (普通 text) → 忽略, 返回 null', () => {
    const page = makePage([makeTextItem('tx-1', 10, 20, 40, 16)])
    expect(findControlItemAt(page, 30, 28)).toBeNull()
  })

  it('表格 cell 内 smarttext → 经 getFlatPageItems 偏移后命中', () => {
    // 表格 cell 内 item 展平后 x 会加 CELL_PAD(6) + cell.x
    const cellItem = makeSmartItem('st-cell', 0, 0, 40, 16)
    const tableItem: SLIFItem = {
      nodeId: 'tbl-1', nodeType: 'table', type: 'table',
      x: 0, y: 0, width: 100, height: 30, ascent: 0, descent: 0,
      font: 'SimSun', size: 16,
      rows: [{ height: 30, cells: [{ x: 0, y: 0, width: 100, height: 30, items: [cellItem] }] }],
    }
    const page = makePage([tableItem])
    // 展平后 x = 0 + 6 + 0 = 6, y = 0 + 0 = 0
    expect(findControlItemAt(page, 10, 5)).toBe('st-cell')
    // 落在 CELL_PAD 内 (x=3) → 未命中
    expect(findControlItemAt(page, 3, 5)).toBeNull()
  })

  it('空页面 / 无 smarttext → 返回 null', () => {
    expect(findControlItemAt(makePage([]), 30, 28)).toBeNull()
  })
})

describe('EditorStore 设计选中/悬停字段 (契约 §12.3)', () => {
  it('初始状态选中/悬停均为 null', () => {
    const store = new EditorStore()
    expect(store.state.designSelectedControlId).toBeNull()
    expect(store.state.designHoveredControlId).toBeNull()
  })

  it('setDesignSelectedControlId 设置选中并递增版本号', () => {
    const store = new EditorStore()
    const v0 = store.getVersion()
    store.setDesignSelectedControlId('st-1')
    expect(store.state.designSelectedControlId).toBe('st-1')
    expect(store.getVersion()).toBeGreaterThan(v0)
  })

  it('同值写入去重 — 不重复通知 (版本号不变)', () => {
    const store = new EditorStore()
    store.setDesignSelectedControlId('st-1')
    const v1 = store.getVersion()
    store.setDesignSelectedControlId('st-1')
    expect(store.getVersion()).toBe(v1)
  })

  it('setDesignHoveredControlId 设置/清除悬停', () => {
    const store = new EditorStore()
    store.setDesignHoveredControlId('st-1')
    expect(store.state.designHoveredControlId).toBe('st-1')
    store.setDesignHoveredControlId(null)
    expect(store.state.designHoveredControlId).toBeNull()
  })
})
