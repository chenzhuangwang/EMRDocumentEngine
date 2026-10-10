// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// TableGrowOverlay — 可增长表「+ 添加行」入口 (契约 §12.9)
//
// 覆盖: 只在 edit/form 出现 / 无可增长表不渲染 / 取不到矩形不渲染 /
// 点击经 Editor.appendTableRow (文档变更走命令) / 几何跟随表尾。
// ================================================================

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EditorContext, type EditorContextValue } from '../EditorProvider'
import { TableGrowOverlay } from '../TableGrowOverlay'
import { EditorStore } from '@emrde/document-engine'
import type { Editor, EditorMode } from '@emrde/document-engine'

interface Hooks {
  editor: Editor
  appendTableRow: ReturnType<typeof vi.fn>
  setRect: (r: { left: number; top: number; width: number; height: number } | null) => void
}

function renderOverlay(opts: {
  mode: EditorMode
  tables?: string[]
  rect?: { left: number; top: number; width: number; height: number } | null
}): Hooks {
  let rect = opts.rect === undefined
    ? { left: 100, top: 200, width: 400, height: 120 }
    : opts.rect

  const appendTableRow = vi.fn()
  const editor = {
    listGrowableTables: () => opts.tables ?? ['t1'],
    getTableClientRect: () => rect,
    appendTableRow,
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Editor

  const store = new EditorStore()
  store.setMode(opts.mode)
  const value: EditorContextValue = { editorRef: { current: editor }, ready: true, store }
  render(
    <EditorContext.Provider value={value}>
      <TableGrowOverlay />
    </EditorContext.Provider>,
  )
  return { editor, appendTableRow, setRect: (r) => { rect = r } }
}

/** rAF 循环在 jsdom 走定时器, 需要等它跑一拍 */
async function findButton(): Promise<HTMLElement | null> {
  try {
    return await screen.findByTitle(/在表尾添加一行/, {}, { timeout: 2000 })
  } catch {
    return null
  }
}

describe('TableGrowOverlay (契约 §12.9)', () => {
  it('edit 模式 + 有可增长表 → 渲染「添加行」', async () => {
    renderOverlay({ mode: 'edit' })
    const btn = await findButton()
    expect(btn).not.toBeNull()
    expect(btn!.textContent).toContain('添加行')
  })

  it('form 模式同样出现 (填写态是主场景)', async () => {
    renderOverlay({ mode: 'form' })
    expect(await findButton()).not.toBeNull()
  })

  it.each<EditorMode>(['readonly', 'clean', 'print'])(
    '%s 模式 → 什么都不渲染 (既无入口也无标记)',
    async (mode) => {
      renderOverlay({ mode })
      await new Promise((r) => setTimeout(r, 60))
      expect(screen.queryByTitle(/在表尾添加一行/)).toBeNull()
      expect(document.querySelector('[data-table-growable-marker]')).toBeNull()
    },
  )

  it('design 模式 → 渲染只读标记, 但**不**渲染添加行按钮', async () => {
    renderOverlay({ mode: 'design' })
    await waitFor(() => {
      expect(document.querySelector('[data-table-growable-marker]')).not.toBeNull()
    })
    // 关键: 设计态看到的只是"这张表声明了可增长"的事实, 不是入口
    expect(screen.queryByTitle(/在表尾添加一行/)).toBeNull()
  })

  it('design 标记不可交互 (pointer-events:none, 非 button)', async () => {
    renderOverlay({ mode: 'design' })
    const marker = await waitFor(() => {
      const el = document.querySelector('[data-table-growable-marker]') as HTMLElement | null
      expect(el).not.toBeNull()
      return el!
    })
    expect(marker.tagName).toBe('DIV')
    expect(marker.style.pointerEvents).toBe('none')
    expect(marker.title).toContain('右键可切换')
  })

  it('design 标记点击不会追加行 (只读)', async () => {
    const h = renderOverlay({ mode: 'design' })
    const marker = await waitFor(() => {
      const el = document.querySelector('[data-table-growable-marker]') as HTMLElement | null
      expect(el).not.toBeNull()
      return el!
    })
    fireEvent.click(marker)
    expect(h.appendTableRow).not.toHaveBeenCalled()
  })

  it('文档里没有可增长表 → 不渲染', async () => {
    renderOverlay({ mode: 'edit', tables: [] })
    await new Promise((r) => setTimeout(r, 60))
    expect(screen.queryByTitle(/在表尾添加一行/)).toBeNull()
  })

  it('取不到表格矩形 (未布局) → 不渲染, 不抛', async () => {
    renderOverlay({ mode: 'edit', rect: null })
    await new Promise((r) => setTimeout(r, 60))
    expect(screen.queryByTitle(/在表尾添加一行/)).toBeNull()
  })

  it('点击 → 经 Editor.appendTableRow 追加 (文档变更走命令)', async () => {
    const h = renderOverlay({ mode: 'edit' })
    const btn = await findButton()
    fireEvent.click(btn!)
    expect(h.appendTableRow).toHaveBeenCalledWith('t1')
  })

  it('按钮贴在表尾右下角 (位置由 getTableClientRect 派生)', async () => {
    renderOverlay({
      mode: 'edit',
      rect: { left: 100, top: 200, width: 400, height: 120 },
    })
    const btn = await findButton()
    // left = rect.left + rect.width - 88 = 412; top = rect.top + rect.height + 4 = 324
    expect(btn!.style.left).toBe('412px')
    expect(btn!.style.top).toBe('324px')
  })

  it('多个可增长表 → 各一个入口', async () => {
    renderOverlay({ mode: 'edit', tables: ['t1', 't2'] })
    await waitFor(() => {
      expect(screen.getAllByTitle(/在表尾添加一行/).length).toBe(2)
    })
  })
})
