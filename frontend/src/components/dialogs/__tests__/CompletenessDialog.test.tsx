// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// CompletenessDialog 组件测试 (契约 §12.11 / 设计 §2.2.5)
//
// 锁住的是**产品决策**而非外观: 缺必填项时弹确认框, 三个出口
// (跳到第一处 / 仍然保存 / 取消), **不硬拦**。
//
// 查询口径: Radix Dialog 经 Portal 挂到 document.body, 故按语义查询
// (getByRole / getByText), 不做 DOM 结构直查。
// ================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CompletenessDialog } from '../CompletenessDialog'
import type { MissingField } from '@emrde/document-engine'
import { bootstrapLocale } from '@/i18n/bootstrap'
import { locale } from '@emrde/document-engine'

const MISSING: MissingField[] = [
  { nodeId: 'st1', paragraphPath: ['doc', 'p1'], name: '主诉' },
  { nodeId: 'st2', paragraphPath: ['doc', 'p2'], name: '病案号' },
]

beforeEach(() => { bootstrapLocale() })
afterEach(() => { locale.setLocale('zh-CN') })

function renderDialog(missing: MissingField[] = MISSING) {
  const onJump = vi.fn()
  const onSaveAnyway = vi.fn()
  const onClose = vi.fn()
  render(
    <CompletenessDialog
      open missing={missing}
      onJump={onJump} onSaveAnyway={onSaveAnyway} onClose={onClose}
    />,
  )
  return { onJump, onSaveAnyway, onClose }
}

describe('CompletenessDialog (契约 §12.11)', () => {
  it('列出全部未填项, 并在标题里给出条数', () => {
    renderDialog()
    expect(screen.getByText('主诉')).toBeTruthy()
    expect(screen.getByText('病案号')).toBeTruthy()
    expect(screen.getByText(/有 2 个必填项尚未填写/)).toBeTruthy()
  })

  it('点击条目 → onJump 带该条定位 (宿主据此跳转)', () => {
    const { onJump } = renderDialog()
    fireEvent.click(screen.getByText('病案号'))
    expect(onJump).toHaveBeenCalledTimes(1)
    expect(onJump).toHaveBeenCalledWith(MISSING[1])
  })

  it('「跳到第一处」→ onJump 带第一条 (不是最后点过的那条)', () => {
    const { onJump } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '跳到第一处' }))
    expect(onJump).toHaveBeenCalledWith(MISSING[0])
  })

  it('「仍然保存」→ onSaveAnyway (**不**触发 onJump, 也不触发 onClose)', () => {
    const { onJump, onSaveAnyway, onClose } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '仍然保存' }))
    expect(onSaveAnyway).toHaveBeenCalledTimes(1)
    expect(onJump).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('「取消」→ onClose, 既不保存也不跳转', () => {
    const { onJump, onSaveAnyway, onClose } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSaveAnyway).not.toHaveBeenCalled()
    expect(onJump).not.toHaveBeenCalled()
  })

  it('无名控件显示占位文案, 不显示空行', () => {
    renderDialog([{ nodeId: 'st9', paragraphPath: ['doc', 'p9'], name: '' }])
    expect(screen.getByText('(未命名控件)')).toBeTruthy()
  })

  it('单条未填 → 条数文案用单数口径 (n=1)', () => {
    renderDialog([MISSING[0]])
    expect(screen.getByText(/有 1 个必填项尚未填写/)).toBeTruthy()
  })
})
