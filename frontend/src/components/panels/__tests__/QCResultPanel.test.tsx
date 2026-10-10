// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// QCResultPanel (契约 §12.2)
//
// 重点: **只有带定位的问题才可点跳转**。文档级问题 (标题/字数/段落数) 没有
// 具体位置, 做成可点按钮就是"点了没反应" —— 比不做成按钮更误导。
// ============================================================

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QCResultPanel } from '../QCResultPanel'
import type { QCResult } from '@emrde/document-engine'

function result(issues: QCResult['issues']): QCResult {
  return {
    documentId: 'd1', score: 80, grade: 'B', issues,
    stats: { errors: 0, warnings: issues.length, infos: 0 },
    checkedAt: Date.UTC(2026, 8, 16, 10, 0, 0),
  }
}

const LOCATABLE = {
  ruleId: 'qc_004', ruleName: 'SmartText 必填字段校验', severity: 'warning' as const,
  message: '标记为 required 的 SmartTextNode 不能为空',
  nodeId: 'st1', paragraphPath: ['doc', 'p1'],
}
const DOC_LEVEL = {
  ruleId: 'qc_005', ruleName: '文档字数不低于最低阈值', severity: 'info' as const,
  message: '文档正文至少包含 10 个字符',
}

describe('QCResultPanel', () => {
  it('result 为 null → 提示尚未检查, 并给出「开始检查」入口', () => {
    const onRecheck = vi.fn()
    render(<QCResultPanel result={null} onRecheck={onRecheck} />)
    expect(screen.getByText('尚未进行质控检查')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '开始检查' }))
    expect(onRecheck).toHaveBeenCalled()
  })

  it('渲染评分/等级/统计', () => {
    render(<QCResultPanel result={result([LOCATABLE])} />)
    expect(screen.getByText('80')).toBeTruthy()
    expect(screen.getByText('文书质控评分')).toBeTruthy()
  })

  it('带定位的问题 → 可点击跳转', () => {
    const onIssueClick = vi.fn()
    render(<QCResultPanel result={result([LOCATABLE])} onIssueClick={onIssueClick} />)
    const btn = screen.getByRole('button', { name: /SmartText 必填字段校验/ })
    expect((btn as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(btn)
    expect(onIssueClick).toHaveBeenCalledWith(LOCATABLE)
  })

  it('文档级问题 (无 paragraphPath) → 不可点, 点击不触发跳转', () => {
    const onIssueClick = vi.fn()
    render(<QCResultPanel result={result([DOC_LEVEL])} onIssueClick={onIssueClick} />)
    const btn = screen.getByRole('button', { name: /文档字数不低于最低阈值/ })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(btn)
    expect(onIssueClick).not.toHaveBeenCalled()
  })

  it('无问题 → 通过提示', () => {
    render(<QCResultPanel result={result([])} />)
    expect(screen.getByText('文书质控通过，无问题')).toBeTruthy()
  })
})
