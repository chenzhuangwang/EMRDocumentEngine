// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// StatusBar — 控件量表评分标识 (契约 §12.6.2 layer E)
//
// 量表分是只读派生语义, 与「文书质控合规分」是两套独立口径 —— 标识只在
// 确有可计分控件时出现, 其余情况完全不出现在状态栏 (现有文档零影响)。
// ============================================================

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EditorContext, type EditorContextValue } from '../../editor/EditorProvider'
import { StatusBar } from '../StatusBar'
import { EditorStore } from '@/engine/state/EditorStore'
import type { ScoreResult } from '@/engine'

function renderStatusBar(scaleScore?: ScoreResult | null) {
  const store = new EditorStore()
  const value: EditorContextValue = { editorRef: { current: null }, ready: true, store }
  render(
    <EditorContext.Provider value={value}>
      <StatusBar wordCount={0} scaleScore={scaleScore} />
    </EditorContext.Provider>,
  )
}

function score(p: Partial<ScoreResult>): ScoreResult {
  return { total: 0, items: [], uncounted: 0, counted: 0, ...p }
}

describe('StatusBar 量表评分标识 (§12.6.2 layer E)', () => {
  it('未传 scaleScore → 不渲染评分标识', () => {
    renderStatusBar()
    expect(screen.queryByTitle(/量表评分/)).toBeNull()
  })

  it('scaleScore 为 null → 不渲染', () => {
    renderStatusBar(null)
    expect(screen.queryByTitle(/量表评分/)).toBeNull()
  })

  it('counted === 0 (无控件携带 numericValue) → 不渲染', () => {
    renderStatusBar(score({ total: 0, counted: 0 }))
    expect(screen.queryByTitle(/量表评分/)).toBeNull()
  })

  it('counted > 0 → 显示总分', () => {
    renderStatusBar(score({ total: 12, counted: 2 }))
    expect(screen.getByText('12 分')).toBeTruthy()
    expect(screen.getByTitle(/量表评分 12 分/)).toBeTruthy()
  })

  it('总分 0 但确有可计分控件 → 仍渲染 (0 分是有效结果)', () => {
    renderStatusBar(score({ total: 0, counted: 1 }))
    expect(screen.getByText('0 分')).toBeTruthy()
  })

  it('tooltip 明确与质控合规分区分, 并说明未计分控件数', () => {
    renderStatusBar(score({ total: 5, counted: 1, uncounted: 3 }))
    const el = screen.getByTitle(/量表评分 5 分/)
    expect(el.getAttribute('title')).toContain('文书质控合规分')
    expect(el.getAttribute('title')).toContain('3 个控件已填但候选项未配数值')
  })

  it('无未计分控件时 tooltip 不提该句', () => {
    renderStatusBar(score({ total: 5, counted: 1, uncounted: 0 }))
    const el = screen.getByTitle(/量表评分 5 分/)
    expect(el.getAttribute('title')).not.toContain('未配数值')
  })
})
