// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

import { describe, it, expect } from 'vitest'
import {
  resolvePrintRange, selectPrintPages, isPrintFinished, buildPrintRecord, printDocKey,
} from '../printJob'

describe('resolvePrintRange — 用户输入不可信, 一律钳制', () => {
  it('正常范围原样通过', () => {
    expect(resolvePrintRange({ start: 2, end: 5 }, 10)).toEqual({ start: 2, end: 5 })
  })

  it('start < 1 → 钳到 1; end > totalPages → 钳到末页', () => {
    expect(resolvePrintRange({ start: 0, end: 999 }, 10)).toEqual({ start: 1, end: 10 })
    expect(resolvePrintRange({ start: -3, end: 4 }, 10)).toEqual({ start: 1, end: 4 })
  })

  it('end < start → 收敛成单页 (而不是切片成空数组)', () => {
    // 切片为空 = 交给打印窗口一张图都没有: 什么都不打, 也不报错。必须收敛。
    expect(resolvePrintRange({ start: 7, end: 3 }, 10)).toEqual({ start: 7, end: 7 })
  })

  it('NaN / 小数 (数字框可以填出这些) 不产生非法范围', () => {
    expect(resolvePrintRange({ start: NaN, end: NaN }, 10)).toEqual({ start: 1, end: 10 })
    expect(resolvePrintRange({ start: 2.7, end: 5.9 }, 10)).toEqual({ start: 2, end: 5 })
  })

  it('totalPages 为 0 → 空范围 (end < start, 调用方切片得空数组)', () => {
    expect(resolvePrintRange({ start: 1, end: 5 }, 0)).toEqual({ start: 1, end: 0 })
  })
})

describe('selectPrintPages — 1-based 含两端', () => {
  const pages = ['p1', 'p2', 'p3', 'p4', 'p5']

  it('取中间一段', () => {
    expect(selectPrintPages(pages, { start: 2, end: 4 })).toEqual(['p2', 'p3', 'p4'])
  })

  it('单页', () => {
    expect(selectPrintPages(pages, { start: 3, end: 3 })).toEqual(['p3'])
  })

  it('全范围 = 原数组', () => {
    expect(selectPrintPages(pages, { start: 1, end: 5 })).toEqual(pages)
  })
})

describe('isPrintFinished — 打到末页才算完成', () => {
  it('end 到末页 → true', () => {
    expect(isPrintFinished({ start: 1, end: 10 }, 10)).toBe(true)
    expect(isPrintFinished({ start: 5, end: 10 }, 10)).toBe(true)
  })

  it('没到末页 → false (会留下续打断点)', () => {
    expect(isPrintFinished({ start: 1, end: 4 }, 10)).toBe(false)
  })

  it('空文档不算完成', () => {
    expect(isPrintFinished({ start: 1, end: 0 }, 0)).toBe(false)
  })
})

describe('buildPrintRecord', () => {
  const base = {
    documentId: 'doc1',
    documentTitle: '入院记录',
    settings: { copies: 2, duplex: true },
    now: 1_700_000_000_000,
    id: 'rec1',
  }

  it('打到末页 → completed=true 且**不写**断点', () => {
    const rec = buildPrintRecord({ ...base, range: { start: 1, end: 10 }, totalPages: 10 })

    expect(rec.completed).toBe(true)
    expect(rec.lastCompletedPage).toBeUndefined()
    expect(rec.pageRange).toEqual({ start: 1, end: 10 })
    expect(rec.copies).toBe(2)
    expect(rec.duplex).toBe(true)
  })

  it('没打到末页 → completed=false 且断点 = 本轮最后一页', () => {
    const rec = buildPrintRecord({ ...base, range: { start: 1, end: 4 }, totalPages: 10 })

    expect(rec.completed).toBe(false)
    expect(rec.lastCompletedPage).toBe(4)
  })

  it('无文档 id (未保存文档) → 落到占位 id, 不写 undefined', () => {
    const rec = buildPrintRecord({
      ...base, documentId: undefined, range: { start: 1, end: 1 }, totalPages: 1,
    })
    expect(rec.documentId).toBe('unsaved')
  })

  it('写入与查询必须用同一个键 —— 否则未保存文档的续打断点永远查不到', () => {
    // 实测踩到过: 写入兜底成 'unsaved', 查询却直接传 undefined, 两者永不匹配
    expect(printDocKey(undefined)).toBe('unsaved')
    expect(printDocKey('doc1')).toBe('doc1')

    const rec = buildPrintRecord({
      ...base, documentId: undefined, range: { start: 1, end: 1 }, totalPages: 5,
    })
    expect(rec.documentId).toBe(printDocKey(undefined))
  })

  it('pageRange 是副本 —— 之后改原对象不影响已记录的条目', () => {
    const range = { start: 1, end: 3 }
    const rec = buildPrintRecord({ ...base, range, totalPages: 10 })

    range.end = 9
    expect(rec.pageRange.end).toBe(3)
  })
})
