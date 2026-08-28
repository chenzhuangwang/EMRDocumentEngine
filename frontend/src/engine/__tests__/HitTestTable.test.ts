// ============================================================
// HitTestTable 命中检测测试 (v21.0 Phase 1)
//
// 验证:
//   1. 普通表格 cell 内点击命中正确段落
//   2. colspan 合并单元格命中 (修复 colWidths[ci] 下标定位 bug)
//   3. 表格外点击返回 null
//   4. buildMergeMatrix 全 colspan 场景列数不低估
// ============================================================

import { describe, it, expect } from 'vitest'
import { HitTestIndex } from '../render/HitTestIndex'
import { testMeasurer } from './helpers'
import { buildMergeMatrix } from '../document/table/MergeMatrix'
import { buildNodePool } from '../document/core/NodePool'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import type { BaseNode } from '../document/core/DocumentModel'
import type { SLIFItem, SLIFCell } from '../layout/core/SLIF'

const hitIndex = new HitTestIndex(testMeasurer)

/** 构造一个 cell 内文本 item (cell 局部坐标) */
function cellText(nodeId: string, text: string, width: number): SLIFItem {
  return {
    nodeId, nodeType: 'text', type: 'text',
    x: 0, y: 0, width, height: 20,
    ascent: 14, descent: 6,
    font: 'SimSun', size: 12,
    text,
  }
}

function cell(id: string, width: number, items: SLIFItem[], colspan?: number): SLIFCell {
  return { id, x: 0, y: 0, width, height: 24, colspan, items }
}

/**
 * 2 列表格, 第 0 行首格 colspan=2 跨满整行:
 *   row0: [M(合并, 跨2列)]
 *   row1: [L, R]
 * 列宽 [100, 100], 行高 24 (+1 gap)
 */
function makeFixture() {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)

  const mk = (text: string) => {
    const tn = createTextNode(text)
    const para = createParagraph([tn.id])
    allNodes.set(tn.id, tn as unknown as BaseNode)
    allNodes.set(para.id, para as unknown as BaseNode)
    return { tnId: tn.id, paraId: para.id }
  }
  const M = mk('M')
  const L = mk('L')
  const R = mk('R')

  const pool = buildNodePool(allNodes, { body: doc.id })

  const tableItem: SLIFItem = {
    nodeId: 'table1', nodeType: 'table', type: 'table',
    x: 0, y: 0, width: 200, height: 49,
    ascent: 49, descent: 0, font: 'SimSun', size: 12,
    columnWidths: [100, 100],
    rows: [
      {
        height: 24,
        cells: [cell('cellM', 200, [cellText(M.tnId, 'M', 188)], 2)],
      },
      {
        height: 24,
        cells: [
          cell('cellL', 100, [cellText(L.tnId, 'L', 88)]),
          cell('cellR', 100, [cellText(R.tnId, 'R', 88)]),
        ],
      },
    ],
  }

  return { doc, pool, tableItem, M, L, R }
}

describe('HitTestTable', () => {
  it('普通 cell 点击命中正确段落', () => {
    const { doc, pool, tableItem, L, R } = makeFixture()

    const hitL = hitIndex.hitTestTable(tableItem, 50, 30, pool, doc.id)
    expect(hitL).not.toBeNull()
    expect(hitL!.paraPath[1]).toBe(L.paraId)

    const hitR = hitIndex.hitTestTable(tableItem, 150, 30, pool, doc.id)
    expect(hitR).not.toBeNull()
    expect(hitR!.paraPath[1]).toBe(R.paraId)
  })

  it('colspan 合并单元格: 跨列区域命中同一 cell (修复下标定位 bug)', () => {
    const { doc, pool, tableItem, M } = makeFixture()

    // 第 0 行第 0 列 (x=50)
    const hitLeft = hitIndex.hitTestTable(tableItem, 50, 10, pool, doc.id)
    expect(hitLeft).not.toBeNull()
    expect(hitLeft!.paraPath[1]).toBe(M.paraId)

    // 第 0 行第 1 列 (x=150) — 旧实现 colWidths[0]=100 只覆盖 x<100, 会返回 null
    const hitRight = hitIndex.hitTestTable(tableItem, 150, 10, pool, doc.id)
    expect(hitRight).not.toBeNull()
    expect(hitRight!.paraPath[1]).toBe(M.paraId)
  })

  it('表格外点击返回 null', () => {
    const { doc, pool, tableItem } = makeFixture()

    // X 超出表格宽度 (200)
    expect(hitIndex.hitTestTable(tableItem, 250, 10, pool, doc.id)).toBeNull()
    // Y 超出表格总高度 (49)
    expect(hitIndex.hitTestTable(tableItem, 50, 100, pool, doc.id)).toBeNull()
    // 负坐标
    expect(hitIndex.hitTestTable(tableItem, -5, 10, pool, doc.id)).toBeNull()
  })
})

describe('buildMergeMatrix colspan 列数', () => {
  it('全 colspan 场景列数不低估', () => {
    const rows = [
      { cells: [{ id: 'a', colspan: 3 }] },
      { cells: [{ id: 'b', colspan: 2 }, { id: 'c' }] },
    ]
    const m = buildMergeMatrix(rows)
    expect(m.cols).toBe(3)
    expect(m.getCell(0, 0)).toBe('a')
    expect(m.getCell(0, 1)).toBe('a')
    expect(m.getCell(0, 2)).toBe('a')
    expect(m.getCell(1, 0)).toBe('b')
    expect(m.getCell(1, 1)).toBe('b')
    expect(m.getCell(1, 2)).toBe('c')
  })

  it('显式 numCols 覆盖推算值', () => {
    const rows = [{ cells: [{ id: 'a' }] }]
    const m = buildMergeMatrix(rows, { numCols: 4 })
    expect(m.cols).toBe(4)
  })
})

// ---- rowspan 命中 (v21.0 Phase 2) ----

/** 2×2 表格, cell(0,0) rowspan=2 跨两行:
 *   row0: [A(rowspan=2), B]
 *   row1: [D]  (列 0 被 A 的 rowspan 占用, 数据里不存在)
 */
function makeRowspanFixture() {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)

  const mk = (text: string) => {
    const tn = createTextNode(text)
    const para = createParagraph([tn.id])
    allNodes.set(tn.id, tn as unknown as BaseNode)
    allNodes.set(para.id, para as unknown as BaseNode)
    return { tnId: tn.id, paraId: para.id }
  }
  const A = mk('A')
  const B = mk('B')
  const D = mk('D')

  const pool = buildNodePool(allNodes, { body: doc.id })

  const tableItem: SLIFItem = {
    nodeId: 'table2', nodeType: 'table', type: 'table',
    x: 0, y: 0, width: 200, height: 49,
    ascent: 49, descent: 0, font: 'SimSun', size: 12,
    columnWidths: [100, 100],
    rows: [
      {
        height: 24,
        cells: [
          { id: 'c00', x: 0, y: 0, width: 100, height: 49, rowspan: 2, items: [cellText(A.tnId, 'A', 88)] },
          { id: 'c01', x: 100, y: 0, width: 100, height: 24, items: [cellText(B.tnId, 'B', 88)] },
        ],
      },
      {
        height: 24,
        cells: [
          { id: 'c11', x: 100, y: 0, width: 100, height: 24, items: [cellText(D.tnId, 'D', 88)] },
        ],
      },
    ],
  }

  return { doc, pool, tableItem, A, B, D }
}

describe('HitTestTable rowspan', () => {
  it('rowspan 占用区域命中合并 cell', () => {
    const { doc, pool, tableItem, A, D } = makeRowspanFixture()

    // row0 列 0 (rowspan cell 顶部)
    expect(hitIndex.hitTestTable(tableItem, 50, 10, pool, doc.id)!.paraPath[1]).toBe(A.paraId)
    // row1 列 0 (rowspan 占用的下半部分) — 应命中 A 而非 D
    expect(hitIndex.hitTestTable(tableItem, 50, 30, pool, doc.id)!.paraPath[1]).toBe(A.paraId)
    // row1 列 1 — 命中 D
    expect(hitIndex.hitTestTable(tableItem, 150, 30, pool, doc.id)!.paraPath[1]).toBe(D.paraId)
  })
})
