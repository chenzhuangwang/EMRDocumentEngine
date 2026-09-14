// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// TablePaginator 单元测试 — 纯分页器 (不经过 LayoutEngine/PageBreaker)
//
// 验证硬约束/不变量:
//   P0 行级跨页 / 无 0 进度死循环 / requiresNewPage 显式信号
//   P1 单行内切 (行边界, 无 rowspan) / cursorRow 不推进直到末片完成
//   P2 rowspan 不可拆分守卫 (整行独占一页, 允许溢出)
//   repeatHeader 单独 headerRows, 逻辑行不重复
// ================================================================

import { describe, it, expect } from 'vitest'
import { createTablePaginator } from '../layout/table/TablePaginator'
import type { SLIFRow, SLIFItem } from '../layout/core/SLIF'

function textItem(id: string, y: number, height = 20): SLIFItem {
  return {
    nodeId: id, nodeType: 'text', type: 'text',
    x: 0, y, width: 10, height,
    ascent: height * 0.8, descent: height * 0.2,
    font: 'SimSun', size: 16, text: id,
  }
}

/** 单行 (1 行内容) 或单行多行文本域 (lines 行) */
function makeRow(id: string, height: number, lineHeight: number): SLIFRow {
  const lines = Math.floor(height / lineHeight)
  const items = Array.from({ length: lines }, (_, i) => textItem(`${id}_${i}`, i * lineHeight, lineHeight))
  return { height, cells: [{ id: `${id}_c`, x: 0, y: 0, width: 100, height, items }] }
}

function rowspanRow(id: string, height: number): SLIFRow {
  return {
    height,
    cells: [{ id: `${id}_c`, x: 0, y: 0, width: 100, height, rowspan: 2, items: [textItem(`${id}_0`, 0, 20)] }],
  }
}

const opts = { repeatHeader: false, headerCount: 0, pageContentHeight: 100 }

describe('TablePaginator P0 行级跨页', () => {
  it('10 行 / 每页 4 行 → [0..3] [4..7] [8..9], 逻辑行各出现一次', () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRow(`r${i}`, 24, 24)) // unit = 25
    const p = createTablePaginator(rows, [100], opts)

    const r1 = p.paginate(100)
    expect(r1.requiresNewPage).toBe(false)
    expect(r1.done).toBe(false)
    expect(r1.consumedRows).toBe(4)
    expect(r1.fragment.bodyRows.length).toBe(4)
    expect(r1.fragment.logicalStart).toBe(0)
    expect(r1.fragment.logicalEnd).toBe(4)
    expect(r1.fragment.continuation).toBe(false)

    const r2 = p.paginate(100)
    expect(r2.consumedRows).toBe(4)
    expect(r2.fragment.logicalStart).toBe(4)
    expect(r2.fragment.logicalEnd).toBe(8)
    expect(r2.fragment.continuation).toBe(true)

    const r3 = p.paginate(100)
    expect(r3.consumedRows).toBe(2)
    expect(r3.done).toBe(true)
    expect(r3.fragment.logicalStart).toBe(8)
    expect(r3.fragment.logicalEnd).toBe(10)
    expect(r3.fragment.continuation).toBe(true)
  })

  it('本页剩余不足 → requiresNewPage=true (显式换页信号), 换页后必能推进', () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRow(`r${i}`, 24, 24))
    const p = createTablePaginator(rows, [100], opts)

    const r = p.paginate(20) // 20 < 25 (最小行单元)
    expect(r.requiresNewPage).toBe(true)
    expect(r.consumedRows).toBe(0)
    expect(r.done).toBe(false)

    const r2 = p.paginate(100) // 整页可用高
    expect(r2.requiresNewPage).toBe(false)
    expect(r2.consumedRows).toBe(4)
  })

  it('空表 → done=true, 不产生内容', () => {
    const p = createTablePaginator([], [100], opts)
    const r = p.paginate(100)
    expect(r.done).toBe(true)
    expect(r.consumedRows).toBe(0)
    expect(r.fragment.bodyRows.length).toBe(0)
    expect(r.requiresNewPage).toBe(false)
  })
})

describe('TablePaginator P1 单行内切', () => {
  it('单行超高 (4 行内容) 切成两片, 内容不丢', () => {
    const p = createTablePaginator([makeRow('tall', 200, 50)], [100], opts)

    const r1 = p.paginate(100)
    expect(r1.requiresNewPage).toBe(false)
    expect(r1.done).toBe(false)
    expect(r1.consumedRows).toBe(0) // 未完成该行
    expect(r1.fragment.bodyRows[0].height).toBe(100)
    expect(r1.fragment.bodyRows[0].cells[0].items.length).toBe(2) // 0,50

    const r2 = p.paginate(100)
    expect(r2.consumedRows).toBe(1) // 末片完成 → 推进
    expect(r2.done).toBe(true)
    expect(r2.fragment.bodyRows[0].height).toBe(100)
    expect(r2.fragment.bodyRows[0].cells[0].items.length).toBe(2) // 100,150 (重锚 0,50)
    expect(r2.fragment.bodyRows[0].cells[0].items[0].y).toBe(0)
    expect(r2.fragment.bodyRows[0].cells[0].items[1].y).toBe(50)
  })

  it('两个超高行连续 → 不 0 进度 (无死循环), consumedRows 合计 = 2', () => {
    const rows = [makeRow('a', 200, 50), makeRow('b', 200, 50)]
    const p = createTablePaginator(rows, [100], opts)

    let total = 0
    let last = null as null | ReturnType<ReturnType<typeof createTablePaginator>['paginate']>
    for (let i = 0; i < 8; i++) {
      last = p.paginate(100)
      total += last.consumedRows
      if (last.done) break
    }
    expect(last!.done).toBe(true)
    expect(total).toBe(2)
  })
})

describe('TablePaginator P2 rowspan 守卫', () => {
  it('含 rowspan 的超高行整行独占一页 (允许溢出), 不做行内切', () => {
    const p = createTablePaginator([rowspanRow('rs', 200)], [100], opts)
    const r = p.paginate(100)
    expect(r.requiresNewPage).toBe(false)
    expect(r.done).toBe(true)
    expect(r.consumedRows).toBe(1)
    expect(r.fragment.bodyRows[0].height).toBe(200) // 整行, 溢出 100
    expect(r.fragment.bodyRows[0].cells[0].rowspan).toBe(2)
    expect(r.fragment.bodyRows[0].cells[0].items.length).toBe(1) // 未切
  })
})

describe('TablePaginator rowspan span 跨页 (行级)', () => {
  it('rowspan span 跨越页边界 → 整组移到下一页 (不溢出/不缺列)', () => {
    const rows = [
      makeRow('f0', 24, 24),
      makeRow('f1', 24, 24),
      makeRow('f2', 24, 24),
      // row 3: rowspan=2 起始行 (span 覆盖 row3 + row4)
      {
        height: 24,
        cells: [{ id: 'a', x: 0, y: 0, width: 100, height: 49, rowspan: 2, items: [textItem('a_0', 0, 20)] }],
      },
      makeRow('cont', 24, 24), // row 4: span 续行
      makeRow('f3', 24, 24),
    ]
    const p = createTablePaginator(rows, [100], opts)

    const r1 = p.paginate(100)
    // 3 个 filler 占 75, rowspan span (50) 放不下 → 整组移到下一页
    expect(r1.fragment.bodyRows.length).toBe(3)
    expect(r1.consumedRows).toBe(3)
    expect(r1.done).toBe(false)

    const r2 = p.paginate(100)
    // span (row3+row4) 整组 + filler f3 同页
    expect(r2.fragment.bodyRows.length).toBe(3)
    expect(r2.fragment.bodyRows[0].cells[0].rowspan).toBe(2)
    expect(r2.fragment.bodyRows[0].cells[0].height).toBe(49) // span 完整, 未溢出
    expect(r2.consumedRows).toBe(3)
    expect(r2.done).toBe(true)
  })
})

describe('TablePaginator repeatHeader', () => {
  it('每片 headerRows 单独存储, 逻辑 body 行不重复', () => {
    const header = makeRow('h', 24, 24)
    const body = Array.from({ length: 4 }, (_, i) => makeRow(`b${i}`, 24, 24))
    const p = createTablePaginator([header, ...body], [100], {
      repeatHeader: true, headerCount: 1, pageContentHeight: 100,
    })

    // header unit = 25 → availForBody = 75 → 每页 3 个 body 行
    const r1 = p.paginate(100)
    expect(r1.fragment.headerRows.length).toBe(1)
    expect(r1.fragment.headerRows[0].cells[0].items[0].text).toBe('h_0')
    expect(r1.fragment.bodyRows.length).toBe(3)
    expect(r1.consumedRows).toBe(3)
    expect(r1.done).toBe(false)

    const r2 = p.paginate(100)
    expect(r2.fragment.headerRows.length).toBe(1)
    expect(r2.fragment.bodyRows.length).toBe(1)
    expect(r2.consumedRows).toBe(1)
    expect(r2.done).toBe(true)

    // 逻辑行号只数 bodyRows: r1 覆盖 [1,4), r2 覆盖 [4,5)
    expect(r1.fragment.logicalStart).toBe(1)
    expect(r1.fragment.logicalEnd).toBe(4)
    expect(r2.fragment.logicalStart).toBe(4)
    expect(r2.fragment.logicalEnd).toBe(5)
  })
})

describe('TablePaginator minRowsBeforeBreak', () => {
  it('续页只剩 < minRows 时回溯, 避免孤行', () => {
    // 5 行, 每页可放 4 行 (unit 25), minRows=2 → 回溯成 3+2
    const rows = Array.from({ length: 5 }, (_, i) => makeRow(`r${i}`, 24, 24))
    const p = createTablePaginator(rows, [100], {
      repeatHeader: false, headerCount: 0, pageContentHeight: 100, minRowsBeforeBreak: 2,
    })

    const r1 = p.paginate(100)
    expect(r1.fragment.bodyRows.length).toBe(3)
    expect(r1.consumedRows).toBe(3)
    expect(r1.done).toBe(false)

    const r2 = p.paginate(100)
    expect(r2.fragment.bodyRows.length).toBe(2)
    expect(r2.consumedRows).toBe(2)
    expect(r2.done).toBe(true)
  })

  it('续页 ≥ minRows 时不回溯 (无影响)', () => {
    const rows = Array.from({ length: 6 }, (_, i) => makeRow(`r${i}`, 24, 24))
    const p = createTablePaginator(rows, [100], {
      repeatHeader: false, headerCount: 0, pageContentHeight: 100, minRowsBeforeBreak: 2,
    })

    const r1 = p.paginate(100)
    expect(r1.fragment.bodyRows.length).toBe(4) // 4 行本可放满, 续页 2 行 ≥ minRows
    expect(r1.done).toBe(false)

    const r2 = p.paginate(100)
    expect(r2.fragment.bodyRows.length).toBe(2)
    expect(r2.done).toBe(true)
  })
})
