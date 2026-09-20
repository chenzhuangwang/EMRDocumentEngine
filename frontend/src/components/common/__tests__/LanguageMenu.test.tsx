// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// LanguageMenu — 语言切换入口的接线验证
//
// 为什么要有这条: 引擎侧与 hook 侧都测过了, 但"菜单点下去真的换了语言"这一段
// 是本仓库最容易断的接缝 (机制齐备、零接线)。这里用真实 Radix 组件跑一遍。
//
// ⚠ 用**键盘**开菜单, 不是 pointerDown: jsdom 没有实现 PointerEvent
// (实测 `typeof PointerEvent === 'undefined'`), fireEvent.pointerDown 造出的事件
// 带不上 `button: 0`, 而 Radix Trigger 的指针分支要求
// `event.button === 0 && event.ctrlKey === false` —— 于是菜单永远不开, 测试会
// 误报成"组件坏了"。Radix 的键盘路径 (Enter/Space/ArrowDown) 在 jsdom 下完好,
// 而且它本来就是真实用户路径之一, 拿它验证接线是等价的。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { locale } from '@/engine'
import { bootstrapLocale, LOCALE_STORAGE_KEY } from '@/i18n/bootstrap'
import { LanguageMenu } from '../LanguageMenu'

const trigger = () => screen.getByRole('button', { name: /语言|Language/i })
// Radix 开菜单后有一次聚焦/宏任务更新, 一并等掉, 否则会报 act(...) 警告
const openMenu = async () => {
  await act(async () => {
    fireEvent.keyDown(trigger(), { key: 'Enter' })
    await new Promise((r) => setTimeout(r, 0))
  })
}

beforeEach(() => {
  localStorage.clear()
  locale.setLocale('zh-CN')
  document.documentElement.lang = ''
})

// 语言复位放 beforeEach —— 放 afterEach 会在 RTL 卸载组件之前触发订阅更新, 白报 act 警告
afterEach(() => {
  localStorage.clear()
})

describe('LanguageMenu', () => {
  it('触发按钮显示当前语言', () => {
    bootstrapLocale()
    render(<LanguageMenu />)
    expect(trigger().textContent).toContain('简体中文')
  })

  it('选中 English → 引擎语言、localStorage、<html lang> 三者同步', async () => {
    bootstrapLocale()
    render(<LanguageMenu />)

    await openMenu()
    // Radix 关闭菜单/归还焦点都排在宏任务里, 一次 flush 掉 (0ms 不够, 它有嵌套定时器)
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /English/ }))
      await new Promise((r) => setTimeout(r, 30))
    })

    expect(locale.getLocale()).toBe('en-US')
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en-US')
    expect(document.documentElement.lang).toBe('en-US')
  })

  it('切回简体中文同样落到三处', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en-US')
    bootstrapLocale()
    render(<LanguageMenu />)

    await openMenu()
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /简体中文/ }))
      await new Promise((r) => setTimeout(r, 30))
    })

    expect(locale.getLocale()).toBe('zh-CN')
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh-CN')
    expect(document.documentElement.lang).toBe('zh-CN')
  })
})
