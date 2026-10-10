// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// Toolbar 文案随语言切换 (i18n 端到端接线闸门 — Toolbar 篇)
//
// 为什么单开一条: i18nBinding.test.tsx 的端到端用例只渲染了 ModeSwitcher
// 一个真实组件, 而 Toolbar 是文案最集中的地方 (字体/标题/编号/域代码四组
// 下拉的 label 全在这里)。历史 bug: 四个下拉用
//   const isEN = t('headerBar.brand') === 'EMR Editor' ? false : true
// 「猜」当前语言, 而 'EMR Editor' 在 zh-CN / en-US 两个语言包里**都是**这个
// 值, 该表达式恒为 false —— 切到 English 后这四组下拉仍显示中文, tsc /
// 全量 vitest / vite build 全绿, 因为没有任何用例渲染过 Toolbar。
//
// 本文件用**真实 Toolbar** 兜住: 断言各下拉的触发按钮文案随 locale 变。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
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
  return { container, store }
}

/** 下拉触发按钮: 取按钮内的 label span 文本 */
function triggerTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('button'))
    .map((b) => b.textContent?.trim() ?? '')
    .filter(Boolean)
}

describe('Toolbar 文案随语言切换 (真实组件接线)', () => {
  it('字体下拉触发按钮: zh-CN 显示「宋体」, en-US 显示「SimSun」', () => {
    const { container } = renderToolbar()

    expect(triggerTexts(container)).toContain('宋体')

    act(() => { locale.setLocale('en-US') })

    const after = triggerTexts(container)
    expect(after).toContain('SimSun')
    // 关键断言: 中文 label 必须消失 —— 只断言 "出现英文" 会漏掉
    // "两种语言都渲染了" 这类错误
    expect(after).not.toContain('宋体')
  })

  it('标题样式下拉触发按钮: zh-CN 显示「正文」, en-US 显示「Body」', () => {
    const { container } = renderToolbar()

    expect(triggerTexts(container)).toContain('正文')

    act(() => { locale.setLocale('en-US') })

    const after = triggerTexts(container)
    expect(after).toContain('Body')
    expect(after).not.toContain('正文')
  })

  it('切回 zh-CN 后中文 label 回来 (不是单向的)', () => {
    const { container } = renderToolbar()

    act(() => { locale.setLocale('en-US') })
    expect(triggerTexts(container)).toContain('SimSun')

    act(() => { locale.setLocale('zh-CN') })
    expect(triggerTexts(container)).toContain('宋体')
  })

  it('Toolbar 不再用 t(headerBar.brand) 猜语言 (该值两个语言包相同, 恒假)', () => {
    locale.setLocale('zh-CN')
    const zh = locale.t('headerBar.brand')
    locale.setLocale('en-US')
    const en = locale.t('headerBar.brand')
    // 记录事实: 一旦哪天 brand 真的分语言了, 这条会提醒改判定方式
    expect(zh).toBe('EMR Editor')
    expect(en).toBe('EMR Editor')
  })
})
