// ============================================================
// EditorContext 纯函数测试 (契约 RULE 10)
//
// 验证 buildContextSnapshot 的上下文种类判别 (优先级顺序) 与
// isCoversPoint 的选区覆盖判定 (含跨段落限制)。
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

  it('跨段落选区 → false (P0 限制: 仅同段落判定)', () => {
    const sel = makeSelection(true, 0, 8)
    sel.focus.paragraphPath = ['doc', 'p2']
    expect(isCoversPoint(sel, point)).toBe(false)
  })
})
