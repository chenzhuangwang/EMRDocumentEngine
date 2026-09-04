// ============================================================
// EditorContext 纯函数测试 (契约 RULE 10)
//
// 验证 buildContextSnapshot 的上下文种类判别 (优先级顺序) 与
// isCoversPoint 的选区覆盖判定 (含跨段落覆盖, 注入 siblings 顺序)。
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildContextSnapshot, isCoversPoint } from '../context/EditorContext'
import type { ContextFacts } from '../context/EditorContext'
import type { SelectionState } from '../state/EditorRuntimeState'
import { createDefaultRuntimeState } from '../state/EditorRuntimeState'

/** 构造单段落选区 (active 控制是否激活) */
function makeSelection(active: boolean, aOffset: number, fOffset: number): SelectionState {
  const sel = createDefaultRuntimeState().selection
  sel.active = active
  sel.anchor.paragraphPath = ['doc', 'p1']
  sel.anchor.offset = aOffset
  sel.focus.paragraphPath = ['doc', 'p1']
  sel.focus.offset = fOffset
  return sel
}

function baseFacts(overrides: Partial<ContextFacts> = {}): ContextFacts {
  return {
    nodeId: null,
    entryType: null,
    pageIndex: 0,
    localX: 100,
    localY: 100,
    headerFooterSection: null,
    controlId: null,
    cellPosition: null,
    textHit: null,
    selection: makeSelection(false, 0, 0),
    ...overrides,
  }
}

describe('buildContextSnapshot 种类判别', () => {
  it('无任何命中 → blank', () => {
    const snap = buildContextSnapshot(baseFacts())
    expect(snap.kind).toBe('blank')
  })

  it('页眉区域 → headerFooterRegion', () => {
    const snap = buildContextSnapshot(baseFacts({ headerFooterSection: 'header' }))
    expect(snap).toMatchObject({ kind: 'headerFooterRegion', section: 'header' })
  })

  it('设计模式控件命中 → smartText', () => {
    const snap = buildContextSnapshot(baseFacts({ controlId: 'ctrl-1' }))
    expect(snap).toMatchObject({ kind: 'smartText', controlId: 'ctrl-1' })
  })

  it('表格单元格内文本命中 → cell (含 tableId/row/col/offset)', () => {
    const snap = buildContextSnapshot(baseFacts({
      entryType: 'table',
      nodeId: 'table-1',
      cellPosition: { tableId: 'table-1', row: 1, col: 2 },
      textHit: {
        paragraphId: 'p-in-cell',
        paragraphPath: ['doc', 'p-in-cell'],
        offset: 5,
        scope: { type: 'cell', tableId: 'table-1', row: 1, col: 2 },
      },
    }))
    expect(snap).toMatchObject({
      kind: 'cell', tableId: 'table-1', row: 1, col: 2,
      paragraphId: 'p-in-cell', offset: 5,
    })
  })

  it('表格命中但无单元格文本 → table', () => {
    const snap = buildContextSnapshot(baseFacts({ entryType: 'table', nodeId: 'table-1' }))
    expect(snap).toMatchObject({ kind: 'table', tableId: 'table-1' })
  })

  it('图片命中 → image', () => {
    const snap = buildContextSnapshot(baseFacts({ entryType: 'image', nodeId: 'img-1' }))
    expect(snap).toMatchObject({ kind: 'image', nodeId: 'img-1' })
  })

  it('分隔符命中 → separator', () => {
    const snap = buildContextSnapshot(baseFacts({ entryType: 'separator', nodeId: 'sep-1' }))
    expect(snap).toMatchObject({ kind: 'separator', nodeId: 'sep-1' })
  })

  it('分节符命中 → sectionBreak (entryType 下划线 → kind 驼峰)', () => {
    const snap = buildContextSnapshot(baseFacts({ entryType: 'section_break', nodeId: 'sb-1' }))
    expect(snap).toMatchObject({ kind: 'sectionBreak', nodeId: 'sb-1' })
  })

  it('正文文本命中 → text (含 scope 与 coversSelection)', () => {
    const snap = buildContextSnapshot(baseFacts({
      entryType: 'text',
      nodeId: 'text-1',
      textHit: {
        paragraphId: 'p1',
        paragraphPath: ['doc', 'p1'],
        offset: 3,
        scope: { type: 'body' },
      },
    }))
    expect(snap).toMatchObject({
      kind: 'text', paragraphId: 'p1', offset: 3, scope: { type: 'body' },
    })
  })

  it('优先级: 页眉区域 > 控件命中 > 单元格 > 表格 > 文本', () => {
    // headerFooterSection 应压过 textHit 与 controlId
    const hf = buildContextSnapshot(baseFacts({
      headerFooterSection: 'footer',
      controlId: 'ctrl-1',
      textHit: { paragraphId: 'p1', paragraphPath: ['doc', 'p1'], offset: 0, scope: { type: 'body' } },
    }))
    expect(hf.kind).toBe('headerFooterRegion')

    // controlId 应压过 cellPosition + textHit
    const ctrl = buildContextSnapshot(baseFacts({
      controlId: 'ctrl-1',
      entryType: 'table',
      nodeId: 'table-1',
      cellPosition: { tableId: 'table-1', row: 0, col: 0 },
      textHit: { paragraphId: 'p1', paragraphPath: ['doc', 'p1'], offset: 0, scope: { type: 'cell', tableId: 'table-1', row: 0, col: 0 } },
    }))
    expect(ctrl.kind).toBe('smartText')
  })
})

describe('isCoversPoint 选区覆盖判定', () => {
  const point = { paragraphPath: ['doc', 'p1'], offset: 5 }

  it('命中点在同段落选区内 → true', () => {
    const sel = makeSelection(true, 2, 8)
    expect(isCoversPoint(sel, point)).toBe(true)
  })

  it('命中点在同段落选区外 → false', () => {
    const sel = makeSelection(true, 6, 8)
    expect(isCoversPoint(sel, point)).toBe(false)
  })

  it('选区未激活 → false', () => {
    const sel = makeSelection(false, 2, 8)
    expect(isCoversPoint(sel, point)).toBe(false)
  })

  it('无兄弟顺序时跨段落选区 → false (保守回退)', () => {
    const sel = makeSelection(true, 0, 8)
    sel.focus.paragraphPath = ['doc', 'p2']
    expect(isCoversPoint(sel, point)).toBe(false)
  })

  describe('跨段落选区覆盖 (提供 siblings)', () => {
    const siblings = ['p1', 'p2', 'p3'] as const

    function crossSel(aPara: string, aOff: number, fPara: string, fOff: number): SelectionState {
      const sel = makeSelection(true, aOff, fOff)
      sel.anchor.paragraphPath = ['doc', aPara]
      sel.focus.paragraphPath = ['doc', fPara]
      return sel
    }

    it('命中中间段落整段 → true', () => {
      const sel = crossSel('p1', 2, 'p3', 4)
      expect(isCoversPoint(sel, { paragraphPath: ['doc', 'p2'], offset: 0 }, [...siblings])).toBe(true)
      expect(isCoversPoint(sel, { paragraphPath: ['doc', 'p2'], offset: 99 }, [...siblings])).toBe(true)
    })

    it('命中 lo 边界段落: offset >= loOff 才覆盖', () => {
      const sel = crossSel('p1', 3, 'p3', 4)
      expect(isCoversPoint(sel, { paragraphPath: ['doc', 'p1'], offset: 3 }, [...siblings])).toBe(true)
      expect(isCoversPoint(sel, { paragraphPath: ['doc', 'p1'], offset: 5 }, [...siblings])).toBe(true)
      expect(isCoversPoint(sel, { paragraphPath: ['doc', 'p1'], offset: 2 }, [...siblings])).toBe(false)
    })

    it('命中 hi 边界段落: offset <= hiOff 才覆盖', () => {
      const sel = crossSel('p1', 3, 'p3', 4)
      expect(isCoversPoint(sel, { paragraphPath: ['doc', 'p3'], offset: 4 }, [...siblings])).toBe(true)
      expect(isCoversPoint(sel, { paragraphPath: ['doc', 'p3'], offset: 0 }, [...siblings])).toBe(true)
      expect(isCoversPoint(sel, { paragraphPath: ['doc', 'p3'], offset: 5 }, [...siblings])).toBe(false)
    })

    it('反向选区 (focus 在上, anchor 在下) 仍按 lo/hi 归约', () => {
      // anchor 在 p3, focus 在 p1 → lo=p1(3) hi=p3(4)
      const sel = crossSel('p3', 4, 'p1', 3)
      expect(isCoversPoint(sel, { paragraphPath: ['doc', 'p2'], offset: 1 }, [...siblings])).toBe(true)
      expect(isCoversPoint(sel, { paragraphPath: ['doc', 'p1'], offset: 3 }, [...siblings])).toBe(true)
      expect(isCoversPoint(sel, { paragraphPath: ['doc', 'p3'], offset: 4 }, [...siblings])).toBe(true)
      expect(isCoversPoint(sel, { paragraphPath: ['doc', 'p1'], offset: 2 }, [...siblings])).toBe(false)
    })

    it('命中选区范围之外 → false', () => {
      const sel = crossSel('p1', 3, 'p2', 4)
      expect(isCoversPoint(sel, { paragraphPath: ['doc', 'p3'], offset: 0 }, [...siblings])).toBe(false)
    })

    it('命中段落不在兄弟域 → false', () => {
      const sel = crossSel('p1', 3, 'p2', 4)
      expect(isCoversPoint(sel, { paragraphPath: ['doc', 'p9'], offset: 0 }, [...siblings])).toBe(false)
    })

    it('单段落选区 + 提供 siblings: 按 anchor/focus 偏移区间覆盖 (回归: 曾退化为仅 anchor 单点)', () => {
      // anchor/focus 同在 p1, 命中点也在 p1 — 必须按 [2,8] 区间判定, 而非 anchor.offset 单点
      const sel = makeSelection(true, 2, 8)
      expect(isCoversPoint(sel, { paragraphPath: ['doc', 'p1'], offset: 5 }, [...siblings])).toBe(true)
      expect(isCoversPoint(sel, { paragraphPath: ['doc', 'p1'], offset: 2 }, [...siblings])).toBe(true)
      expect(isCoversPoint(sel, { paragraphPath: ['doc', 'p1'], offset: 8 }, [...siblings])).toBe(true)
      expect(isCoversPoint(sel, { paragraphPath: ['doc', 'p1'], offset: 1 }, [...siblings])).toBe(false)
      expect(isCoversPoint(sel, { paragraphPath: ['doc', 'p1'], offset: 9 }, [...siblings])).toBe(false)
      // 命中其他段落 → 不在同段选区
      expect(isCoversPoint(sel, { paragraphPath: ['doc', 'p2'], offset: 5 }, [...siblings])).toBe(false)
    })
  })
})
