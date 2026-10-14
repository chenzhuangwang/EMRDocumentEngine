// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ToolbarLayoutGate — 工具栏「双滚动条」的 CI 硬闸门
//
// 历史缺陷 (两层原因, 缺一不可):
//
// ① 外层 div 只写了 `overflow-x-auto`。按 CSS Overflow 规范, 一轴为 `auto`
//    而另一轴为 `visible` 时, **`visible` 计算为 `auto`** —— 于是纵向也变成
//    可滚动。工具栏内容恒宽于视口 → 横向滚动条恒定出现并占掉 ~15px 高度,
//    直接吃掉 32px 按钮的余量。
// ② 滚动容器里的 flex 子女默认 `shrink:1` —— 内容恒宽于视口时它们被迫收窄到
//    内容宽度以下, 按钮里的中文标签 (「导出」) 于是折成两行 (实测 span
//    20px→40px), 撑破 44px 的工具栏, 纵向溢出由此产生。`overflow-y-hidden`
//    只是把它藏起来看不见, 局促感依旧。
//
// tsc / vite build / 全量 vitest 全绿, 因为没有任何用例看过工具栏的滚动声明
// 与 flex 收缩声明。所以把这两件事都钉成会红的事实。
// 改这条之前先想清楚: 去掉 `overflow-y-hidden` 或 `shrink-0` 等于把上述缺陷放回来。
// ============================================================

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd } from 'node:process'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { EditorContext, type EditorContextValue } from '../../editor/EditorProvider'
import { Toolbar } from '../Toolbar'
import { EditorStore } from '@emrde/document-engine'
import { bootstrapLocale } from '@/i18n/bootstrap'
import { locale } from '@emrde/document-engine'
import type { Editor } from '@emrde/document-engine'

beforeEach(() => {
  localStorage.clear()
  bootstrapLocale()
})

afterEach(() => {
  localStorage.clear()
  locale.setLocale('zh-CN')
})

function renderToolbar() {
  const store = new EditorStore()
  const value: EditorContextValue = {
    editorRef: { current: null as unknown as Editor },
    ready: false,
    store,
  }
  const { container } = render(
    <EditorContext.Provider value={value}>
      <Toolbar />
    </EditorContext.Provider>,
  )
  return container
}

/** 外层工具栏滚动容器 = 带 overflow-x-auto 的那个 div */
function toolbarScroller(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('div.overflow-x-auto')
  if (!el) throw new Error('工具栏外层滚动容器未找到 (overflow-x-auto 不见了?)')
  return el
}

describe('ToolbarLayoutGate — 工具栏滚动声明', () => {
  it('纵向必须 overflow-y-hidden (否则 visible→auto, 双滚动条回归)', () => {
    const el = toolbarScroller(renderToolbar())
    expect(el.className).toContain('overflow-y-hidden')
  })

  it('横向仍是 overflow-x-auto (单行 + 横向滚动是刻意保留的)', () => {
    const el = toolbarScroller(renderToolbar())
    expect(el.className).toContain('overflow-x-auto')
  })

  it('滚动条走 scrollbar-thin (6px 细条, 复用 index.css 既有 utility)', () => {
    const el = toolbarScroller(renderToolbar())
    expect(el.className).toContain('scrollbar-thin')
  })

  it('单行不换行: 滚动容器须 whitespace-nowrap', () => {
    // 工具栏里的中文标签 (「导出」等) 若允许换行, 一旦被压窄就折成两行,
    // 行高 20px→40px, 直接撑破 44px 的工具栏 → 纵向溢出。零收缩 + 不换行
    // 一起保证「横向滚动是唯一溢出出口」。
    const el = toolbarScroller(renderToolbar())
    expect(el.className).toContain('whitespace-nowrap')
  })
})

describe('ToolbarLayoutGate — flex 子女不得收缩 (index.css @layer components)', () => {
  // 走 node:fs 直读 —— vitest 默认把 CSS 桩掉, `?raw` / `import.meta.glob`
  // 两条路都**静默**返回空串, 断言会假绿。同 ChromeTokenGate.test.ts 的做法。
  const css = readFileSync(join(cwd(), 'src/index.css'), 'utf8')

  /** 取出某个 class 的规则体 */
  function ruleBody(cls: string): string {
    const m = css.match(new RegExp(`\\${cls}\\s*\\{([^}]*)\\}`))
    if (!m) throw new Error(`${cls} 规则未找到 (被改名/删了?)`)
    return m[1]
  }

  it('.toolbar-btn-group 必须 shrink-0 (否则中文标签被压折行)', () => {
    expect(ruleBody('.toolbar-btn-group')).toContain('shrink-0')
  })

  it('.toolbar-divider 必须 shrink-0 (1px 分隔线被压到 0 就消失)', () => {
    expect(ruleBody('.toolbar-divider')).toContain('shrink-0')
  })

  it('闸门自身没读空 (读不到 CSS 时假绿比没闸门更危险)', () => {
    expect(css.length).toBeGreaterThan(1000)
  })
})
