// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// PrintDialog — 打印历史与续打断点的接线
//
// 重点在两处曾经断掉的地方:
// ① 对话框是**常驻挂载**的 (Radix 只切 open), `useState` 初值只在首挂载生效 ——
//    不按 open 重算的话, 续打断点/页码范围会一直带着上一次打开的值。
// ② 历史记录此前根本没人读 (PrintHistoryService 零调用), 断点提示框因此
//    永远不可能出现。
// ============================================================

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PrintDialog, type PrintSettings } from '../PrintDialog'
import type { PrintRecord } from '@/services/PrintHistoryService'

function record(over?: Partial<PrintRecord>): PrintRecord {
  return {
    id: 'r1',
    documentId: 'doc1',
    documentTitle: '入院记录',
    printedAt: Date.now(),
    pageRange: { start: 1, end: 4 },
    copies: 2,
    duplex: false,
    completed: false,
    lastCompletedPage: 4,
    ...over,
  }
}

/** 数字框顺序: [0]=起始页 [1]=结束页 [2]=份数 */
const spin = (i: number) => screen.getAllByRole('spinbutton')[i] as HTMLInputElement

describe('PrintDialog — 最近打印', () => {
  it('有历史 → 列出页码范围 / 份数 / 未打完标记', () => {
    render(
      <PrintDialog
        open totalPages={10} onClose={vi.fn()}
        history={[record(), record({ id: 'r2', pageRange: { start: 5, end: 10 }, completed: true, lastCompletedPage: undefined })]}
      />,
    )

    expect(screen.getByText('最近打印')).toBeTruthy()
    expect(screen.getByText('第 1–4 页')).toBeTruthy()
    expect(screen.getByText('第 5–10 页')).toBeTruthy()
    expect(screen.getByText('未打完')).toBeTruthy()
  })

  it('无历史 (未传 / 空数组) → 整块不渲染', () => {
    const { rerender } = render(<PrintDialog open totalPages={10} onClose={vi.fn()} />)
    expect(screen.queryByText('最近打印')).toBeNull()

    rerender(<PrintDialog open totalPages={10} onClose={vi.fn()} history={[]} />)
    expect(screen.queryByText('最近打印')).toBeNull()
  })

  it('只列最近 3 条', () => {
    const history = [1, 2, 3, 4, 5].map((n) =>
      record({ id: `r${n}`, pageRange: { start: n, end: n } }))
    render(<PrintDialog open totalPages={10} onClose={vi.fn()} history={history} />)

    expect(screen.getByText('第 1–1 页')).toBeTruthy()
    expect(screen.getByText('第 3–3 页')).toBeTruthy()
    expect(screen.queryByText('第 4–4 页')).toBeNull()
  })
})

describe('PrintDialog — 续打断点', () => {
  it('给了 resumeFromPage → 显示续打提示, 且起始页跟着挪到断点', () => {
    render(
      <PrintDialog open totalPages={10} onClose={vi.fn()}
        initialSettings={{ resumeFromPage: 5 }} />,
    )

    expect(screen.getByText(/续打: 从第 5 页开始/)).toBeTruthy()
    expect(spin(0).value).toBe('5')
  })

  it('取消续打 → 提示消失, 起始页收回第 1 页 (否则数字框与"从头打印"对不上)', () => {
    render(
      <PrintDialog open totalPages={10} onClose={vi.fn()}
        initialSettings={{ resumeFromPage: 5 }} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '取消续打' }))

    expect(screen.queryByText(/续打: 从第/)).toBeNull()
    expect(spin(0).value).toBe('1')
  })

  it('没有断点 → 不显示续打提示', () => {
    render(<PrintDialog open totalPages={10} onClose={vi.fn()} />)
    expect(screen.queryByText(/续打: 从第/)).toBeNull()
  })
})

describe('PrintDialog — 重新打开必须按新的 initialSettings 起算', () => {
  it('常驻挂载下 open 再次为 true → 采纳新的断点', () => {
    const { rerender } = render(
      <PrintDialog open totalPages={10} onClose={vi.fn()} initialSettings={{ resumeFromPage: null }} />,
    )
    expect(spin(0).value).toBe('1')

    // 关掉再开 —— 这次带上了新的断点
    rerender(
      <PrintDialog open={false} totalPages={10} onClose={vi.fn()} initialSettings={{ resumeFromPage: null }} />,
    )
    rerender(
      <PrintDialog open totalPages={10} onClose={vi.fn()} initialSettings={{ resumeFromPage: 7 }} />,
    )

    expect(spin(0).value).toBe('7')
    expect(screen.getByText(/续打: 从第 7 页开始/)).toBeTruthy()
  })

  it('重开时用户上次改的页码不会残留', () => {
    const { rerender } = render(<PrintDialog open totalPages={10} onClose={vi.fn()} />)
    fireEvent.change(spin(0), { target: { value: '3' } })
    fireEvent.change(spin(2), { target: { value: '9' } })

    rerender(<PrintDialog open={false} totalPages={10} onClose={vi.fn()} />)
    rerender(<PrintDialog open totalPages={10} onClose={vi.fn()} />)

    expect(spin(0).value).toBe('1')
    expect(spin(2).value).toBe('1')
  })
})

describe('PrintDialog — 打印设置回传', () => {
  it('点打印 → onPrint 拿到当前设置 (含页码范围与续打点)', () => {
    const onPrint = vi.fn<(s: PrintSettings) => void>()
    render(
      <PrintDialog open totalPages={10} onClose={vi.fn()} onPrint={onPrint}
        initialSettings={{ resumeFromPage: 5 }} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '打印' }))

    expect(onPrint).toHaveBeenCalledOnce()
    const got = onPrint.mock.calls[0][0]
    expect(got.pageRange).toEqual({ start: 5, end: 10 })
    expect(got.resumeFromPage).toBe(5)
  })

  it('如实说明打印机/份数/单双面由系统窗口生效 (页码范围才是本应用生效的)', () => {
    render(<PrintDialog open totalPages={10} onClose={vi.fn()} />)
    expect(screen.getByText(/请在随后弹出的系统打印窗口中设置/)).toBeTruthy()
  })
})
