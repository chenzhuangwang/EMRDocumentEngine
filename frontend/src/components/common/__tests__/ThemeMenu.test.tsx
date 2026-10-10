// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ThemeMenu — 主题菜单文案随语言切换
//
// 历史问题: ThemeMenu 的 title 与四项 label/hint 曾是一份组件内的
// zh/en 双语字面量 (另一份在 platform/chrome/chromeTheme 的 CHROME_PRESETS 里),
// 与 engine/i18n 语言包重复。那份副本不会跟着语言包更新, 也没有任何用例
// 覆盖 ThemeMenu —— 改成走 t() 后由本文件兜住。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { locale } from '@emrde/document-engine'
import { bootstrapLocale } from '@/i18n/bootstrap'
import { ThemeMenu } from '../ThemeMenu'

const trigger = () => screen.getByRole('button', { name: /主题|Theme/i })

const openMenu = async () => {
  await act(async () => {
    fireEvent.keyDown(trigger(), { key: 'Enter' })
    await new Promise((r) => setTimeout(r, 0))
  })
}

beforeEach(() => {
  localStorage.clear()
  bootstrapLocale()
})

afterEach(() => {
  localStorage.clear()
  locale.setLocale('zh-CN')
})

describe('ThemeMenu 文案随语言切换', () => {
  it('触发按钮 aria-label: zh-CN「界面主题」→ en-US「Interface Theme」', () => {
    render(<ThemeMenu />)
    expect(screen.getByRole('button', { name: '界面主题' })).toBeTruthy()

    act(() => { locale.setLocale('en-US') })

    expect(screen.getByRole('button', { name: 'Interface Theme' })).toBeTruthy()
  })

  it('菜单项 label/hint 随语言变 (四项预设全走 i18n 键)', async () => {
    render(<ThemeMenu />)
    await openMenu()
    expect(screen.getByRole('menuitem', { name: /标准/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /默认灰度/ })).toBeTruthy()

    act(() => { locale.setLocale('en-US') })

    expect(screen.getByRole('menuitem', { name: /Standard/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Default grayscale/ })).toBeTruthy()
    // 中文不该残留
    expect(screen.queryByRole('menuitem', { name: /标准/ })).toBeNull()
  })

  it('CHROME_PRESETS 不再携带显示名 (文案单源在 i18n)', async () => {
    const { CHROME_PRESETS } = await import('@/platform/chrome/chromeTheme')
    for (const p of CHROME_PRESETS) {
      expect(Object.keys(p)).toEqual(['preset'])
    }
  })
})
