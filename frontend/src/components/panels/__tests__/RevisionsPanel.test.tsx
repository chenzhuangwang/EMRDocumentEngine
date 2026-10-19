// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// RevisionsPanel (契约 §12.13)
//
// 面板只做三件事: 列出修订、点条目定位、逐处接受/拒绝。
// 数据全部来自 Editor.listRevisions() 的只读读模型 —— 面板不查文档。
// ============================================================

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RevisionsPanel } from '../RevisionsPanel'
import type { RevisionListEntry } from '@emrde/document-engine'

const AT = new Date(2023, 2, 27, 16, 15, 30).getTime()

function entry(over: Partial<RevisionListEntry> = {}): RevisionListEntry {
  return {
    nodeId: 't1', paraId: 'p1', paragraphPath: ['doc', 'p1'], offset: 2,
    type: 'insert', text: '新增的字', author: '姜波', at: AT,
    ...over,
  }
}

describe('RevisionsPanel', () => {
  it('没有修订 → 空态提示', () => {
    render(<RevisionsPanel revisions={[]} />)
    expect(screen.getByText('没有修订')).toBeTruthy()
  })

  it('按类型给徽标: 插入/删除/修改', () => {
    render(<RevisionsPanel revisions={[
      entry({ nodeId: 'a', type: 'insert' }),
      entry({ nodeId: 'b', type: 'delete' }),
      entry({ nodeId: 'c', type: 'modify' }),
    ]} />)
    expect(screen.getByText('插入')).toBeTruthy()
    expect(screen.getByText('删除')).toBeTruthy()
    expect(screen.getByText('修改')).toBeTruthy()
  })

  it('显示文字片段与"作者 · 时间"', () => {
    render(<RevisionsPanel revisions={[entry({ text: '阿斯蒂芬' })]} />)
    expect(screen.getByText('阿斯蒂芬')).toBeTruthy()
    expect(screen.getByText('姜波 · 2023-03-27 16:15')).toBeTruthy()
  })

  it('缺作者或时间时不拼空段 (只剩另一段)', () => {
    render(<RevisionsPanel revisions={[entry({ author: undefined })]} />)
    expect(screen.getByText('2023-03-27 16:15')).toBeTruthy()
  })

  it('点条目 → 定位回调收到该条', () => {
    const onSelect = vi.fn()
    const e = entry()
    render(<RevisionsPanel revisions={[e]} onSelect={onSelect} />)
    fireEvent.click(screen.getByTitle('新增的字'))
    expect(onSelect).toHaveBeenCalledWith(e)
  })

  it('逐处接受/拒绝 → 回调收到该条 (不在这里改文档)', () => {
    const onAccept = vi.fn()
    const onReject = vi.fn()
    const e = entry()
    render(<RevisionsPanel revisions={[e]} onAccept={onAccept} onReject={onReject} />)
    fireEvent.click(screen.getByRole('button', { name: '接受' }))
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }))
    expect(onAccept).toHaveBeenCalledWith(e)
    expect(onReject).toHaveBeenCalledWith(e)
  })

  it('文字为空的修订节点显示占位符 (不是空白行)', () => {
    render(<RevisionsPanel revisions={[entry({ text: '' })]} />)
    expect(screen.getByText('—')).toBeTruthy()
  })
})
