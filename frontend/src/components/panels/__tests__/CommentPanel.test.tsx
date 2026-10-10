// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// CommentPanel 新建批注 (契约 §12.2)
//
// 背景: 面板此前只能读/回复/解决, **没有任何创建入口** (且 Editor.createComment
// 零调用)。本文件锁住: 入口只在提供 onNewComment 时出现 / 提交回传内容并在
// 失败时给出提示 (不做"点了没反应") / 列表显示锚定摘录。
// ============================================================

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CommentPanel } from '../CommentPanel'
import type { CommentThread } from '@emrde/document-engine'

const THREAD: CommentThread = {
  id: 't1',
  rangeStart: { path: ['doc', 'p1'], offset: 2 },
  rangeEnd: { path: ['doc', 'p1'], offset: 6 },
  author: '李医生',
  createdAt: Date.UTC(2026, 8, 16, 10, 0, 0),
  status: 'open',
  baseVersion: 1,
  anchorStatus: 'valid',
  comments: [{ id: 'c1', author: '李医生', createdAt: Date.UTC(2026, 8, 16, 10, 0, 0), content: '这里措辞要改' }],
}

function renderPanel(props: Omit<Parameters<typeof CommentPanel>[0], 'threads'>) {
  render(<CommentPanel threads={[THREAD]} {...props} />)
}

describe('CommentPanel — 新建批注入口', () => {
  it('未提供 onNewComment → 不出现「新建」入口', () => {
    renderPanel({})
    expect(screen.queryByRole('button', { name: /新建/ })).toBeNull()
  })

  it('提供 onNewComment → 出现入口, 点击展开输入框', () => {
    renderPanel({ onNewComment: vi.fn(() => true) })
    fireEvent.click(screen.getByRole('button', { name: /新建/ }))
    expect(screen.getByPlaceholderText(/批注内容/)).toBeTruthy()
  })

  it('提交 → 回传内容并收起输入框', () => {
    const onNewComment = vi.fn(() => true)
    renderPanel({ onNewComment })
    fireEvent.click(screen.getByRole('button', { name: /新建/ }))
    fireEvent.change(screen.getByPlaceholderText(/批注内容/), { target: { value: '建议补充剂量' } })
    fireEvent.click(screen.getByRole('button', { name: '添加批注' }))

    expect(onNewComment).toHaveBeenCalledWith('建议补充剂量')
    expect(screen.queryByPlaceholderText(/批注内容/)).toBeNull()
  })

  it('锚定失败 (返回 false) → 显示提示且**不收起**输入框 (不留"点了没反应")', () => {
    const onNewComment = vi.fn(() => false)
    renderPanel({ onNewComment })
    fireEvent.click(screen.getByRole('button', { name: /新建/ }))
    fireEvent.change(screen.getByPlaceholderText(/批注内容/), { target: { value: '跨段选择' } })
    fireEvent.click(screen.getByRole('button', { name: '添加批注' }))

    expect(onNewComment).toHaveBeenCalled()
    expect(screen.getByText(/请先在文档中选中同一段落内的文字/)).toBeTruthy()
    expect(screen.getByPlaceholderText(/批注内容/)).toBeTruthy()   // 未收起, 内容还在
  })

  it('空内容 → 提交按钮禁用, 不回调', () => {
    const onNewComment = vi.fn(() => true)
    renderPanel({ onNewComment })
    fireEvent.click(screen.getByRole('button', { name: /新建/ }))
    fireEvent.click(screen.getByRole('button', { name: '添加批注' }))
    expect(onNewComment).not.toHaveBeenCalled()
  })

  it('列表显示锚定摘录 (否则看不出批注标的是哪段字)', () => {
    renderPanel({ getThreadExcerpt: () => '主诉头痛' })
    expect(screen.getByText(/锚定：「主诉头痛」/)).toBeTruthy()
  })

  it('无摘录时不渲染该行', () => {
    renderPanel({ getThreadExcerpt: () => '' })
    expect(screen.queryByText(/锚定：/)).toBeNull()
  })
})
