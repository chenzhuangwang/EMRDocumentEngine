// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// SectionStructureOverlay — 节结构叠加层 (契约 §31.14)
//
// 组件层验收: 开关 / 模式门控 / 每段一条线 / 选中框 / 点击选节 /
// 卸载后停轮询。引擎能力与可视化的正交性由 engine 侧 SectionAuthoring 锁定,
// 此处只测 UI 行为。
//
// 几何轮询走 rAF (jsdom 下回退 setTimeout), 故用 findBy* 等它跑一拍 ——
// 与 TableGrowOverlay.test.tsx 同一手法。
// ============================================================

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EditorContext, type EditorContextValue } from '../EditorProvider'
import { SectionStructureOverlay } from '../SectionStructureOverlay'
import { EditorStore } from '@/engine/state/EditorStore'
import type { Editor, EditorMode } from '@/engine'

type Rect = {
  pageIndex: number; left: number; top: number; width: number; height: number
  contentLeft: number; contentRight: number
}

const RECT_ONE_PAGE: Rect[] = [
  { pageIndex: 0, left: 100, top: 200, width: 400, height: 120, contentLeft: 90, contentRight: 700 },
]
const RECT_TWO_PAGES: Rect[] = [
  ...RECT_ONE_PAGE,
  { pageIndex: 1, left: 100, top: 20, width: 400, height: 60, contentLeft: 90, contentRight: 700 },
]

interface Hooks {
  selectSection: ReturnType<typeof vi.fn>
  getSectionClientRects: ReturnType<typeof vi.fn>
}

function renderOverlay(opts: {
  mode?: EditorMode
  showSectionStructure?: boolean
  selectedSectionId?: string | null
  sections?: Array<{ id: string; depth: number; parentId?: string | null; sectionCode?: string }>
  rects?: Record<string, Rect[]>
}): Hooks {
  const sections = opts.sections ?? [{ id: 'sec-1', depth: 1, sectionCode: 'chapter-001' }]
  const rects = opts.rects ?? { 'sec-1': RECT_ONE_PAGE }
  const selectSection = vi.fn()
  const getSectionClientRects = vi.fn((id: string) => rects[id] ?? [])

  const editor = {
    listSections: () => sections,
    getSectionClientRects,
    selectSection,
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Editor

  const store = new EditorStore()
  store.setMode(opts.mode ?? 'edit')
  if (opts.showSectionStructure === false) store.setShowSectionStructure(false)
  if (opts.selectedSectionId) store.setSelectedSectionId(opts.selectedSectionId)

  const value: EditorContextValue = { editorRef: { current: editor }, ready: true, store }
  render(
    <EditorContext.Provider value={value}>
      <SectionStructureOverlay />
    </EditorContext.Provider>,
  )
  return { selectSection, getSectionClientRects }
}

const rule = (id: string) => document.querySelector(`[data-section-rule="${id}"]`)
const box = (id: string) => document.querySelector(`[data-section-box="${id}"]`)

/** 等几何轮询跑一拍 (rAF → jsdom 定时器) */
async function settle(): Promise<void> {
  await waitFor(() => { expect(true).toBe(true) }, { timeout: 50 })
}

describe('SectionStructureOverlay — 门控', () => {
  it('开关关闭 → 不渲染', async () => {
    renderOverlay({ showSectionStructure: false })
    await settle()
    expect(rule('sec-1')).toBeNull()
  })

  it('只读模式 → 不渲染 (与 TableGrowOverlay 同一门控理由)', async () => {
    renderOverlay({ mode: 'readonly' })
    await settle()
    expect(rule('sec-1')).toBeNull()
  })

  it('无节 → 不渲染', async () => {
    renderOverlay({ sections: [] })
    await settle()
    expect(document.querySelector('[data-section-rule]')).toBeNull()
  })

  it('空节 (无矩形) → 无线可画, 不渲染该节', async () => {
    renderOverlay({ sections: [{ id: 'sec-empty', depth: 1 }], rects: {} })
    await settle()
    expect(document.querySelector('[data-section-rule]')).toBeNull()
  })
})

describe('SectionStructureOverlay — 渲染与交互', () => {
  it('每页一段竖线, 并显示 sectionCode 标签', async () => {
    renderOverlay({ rects: { 'sec-1': RECT_TWO_PAGES } })
    expect(await screen.findByText('chapter-001', {}, { timeout: 2000 })).toBeTruthy()
    expect(document.querySelectorAll('[data-section-rule="sec-1"]')).toHaveLength(2)
  })

  it('点击竖线 → selectSection(该节 id)', async () => {
    const { selectSection } = renderOverlay({})
    await screen.findByText('chapter-001', {}, { timeout: 2000 })
    fireEvent.click(rule('sec-1')!)
    expect(selectSection).toHaveBeenCalledWith('sec-1')
  })

  it('被选中的节额外渲染高亮框', async () => {
    renderOverlay({ selectedSectionId: 'sec-1' })
    await screen.findByText('chapter-001', {}, { timeout: 2000 })
    expect(box('sec-1')).toBeTruthy()
  })

  it('未选中时不渲染高亮框', async () => {
    renderOverlay({ selectedSectionId: null })
    await screen.findByText('chapter-001', {}, { timeout: 2000 })
    expect(box('sec-1')).toBeNull()
  })

  it('匿名节显示兜底文案 (不显示空标签)', async () => {
    renderOverlay({ sections: [{ id: 'sec-1', depth: 1 }] })
    expect(await screen.findByText('匿名节', {}, { timeout: 2000 })).toBeTruthy()
  })
})
