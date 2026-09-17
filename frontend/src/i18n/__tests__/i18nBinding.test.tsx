// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// i18n UI 绑定 — bootstrap 落盘/<html lang> + useTranslation 重渲染
//
// 这两条才是"切语言能不能真的生效"的**接线**验证。引擎侧的
// setLocale/subscribe 早就有了 (LoaderThemeI18n.test.ts 覆盖), 但本仓库的
// 高频陷阱正是"机制齐备、零接线" —— 只测引擎等于没测这条链路。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { locale } from '@/engine'
import {
  bootstrapLocale,
  readStoredLocale,
  storeLocale,
  isLocale,
  LOCALE_STORAGE_KEY,
  LOCALES,
  NOT_WIRED_NOTICE,
} from '../bootstrap'
import { useTranslation } from '../useTranslation'

/** 一个最小消费组件: 显示当前语言 + 一条翻译 */
function Probe() {
  const { t, locale: current } = useTranslation()
  return <span data-testid="probe">{current}|{t('common.save')}</span>
}

const probeText = () => screen.getByTestId('probe').textContent

beforeEach(() => {
  localStorage.clear()
  locale.setLocale('zh-CN')
  document.documentElement.lang = ''
})

// 清 localStorage 就够了; 语言复位放 beforeEach ——
// 放这里会在 RTL 卸载组件之前触发一次订阅更新, 白报一条 act(...) 警告。
afterEach(() => {
  localStorage.clear()
})

describe('readStoredLocale', () => {
  it('无记录 → zh-CN', () => {
    expect(readStoredLocale()).toBe('zh-CN')
  })

  it('脏数据 → zh-CN, 不抛', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, '{"not":"a locale"}')
    expect(readStoredLocale()).toBe('zh-CN')
    expect(isLocale('fr-FR')).toBe(false)
    expect(isLocale(null)).toBe(false)
    // 原型链上的键不算
    expect(isLocale('toString')).toBe(false)
  })

  it('写入后可读回', () => {
    storeLocale('en-US')
    expect(readStoredLocale()).toBe('en-US')
  })
})

describe('bootstrapLocale', () => {
  it('把语言写进引擎与 <html lang>', () => {
    storeLocale('en-US')
    bootstrapLocale()

    expect(locale.getLocale()).toBe('en-US')
    expect(document.documentElement.lang).toBe('en-US')
  })

  it('index.html 写死的 lang="zh-CN" 会被纠正 (它是启动时的谎报)', () => {
    bootstrapLocale()
    expect(document.documentElement.lang).toBe('zh-CN')

    storeLocale('en-US')
    bootstrapLocale()
    expect(document.documentElement.lang).toBe('en-US')
  })

  it('bootstrap 之后任何 setLocale 都会同步 lang 与 localStorage', () => {
    bootstrapLocale()

    locale.setLocale('en-US')

    expect(document.documentElement.lang).toBe('en-US')
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en-US')
  })
})

describe('useTranslation', () => {
  it('返回当前语言与翻译', () => {
    bootstrapLocale()
    render(<Probe />)
    expect(probeText()).toBe('zh-CN|保存')
  })

  it('语言变更后组件重渲染出新文案 (订阅真的接到 UI 了)', () => {
    bootstrapLocale()
    render(<Probe />)
    expect(probeText()).toBe('zh-CN|保存')

    act(() => { locale.setLocale('en-US') })

    expect(probeText()).toBe('en-US|Save')
  })

  it('setLocale 同值不触发重渲染', () => {
    bootstrapLocale()
    let renders = 0
    function Counting() {
      renders++
      useTranslation()
      return null
    }
    render(<Counting />)
    const before = renders

    act(() => { locale.setLocale('zh-CN') })

    expect(renders).toBe(before)
  })

  it('extend 覆盖的文案也会立即反映到界面', () => {
    bootstrapLocale()
    render(<Probe />)

    act(() => { locale.extend({ 'common.save': '存储' }) })

    expect(probeText()).toBe('zh-CN|存储')
  })
})

describe('切换菜单的诚实标注', () => {
  it('两种语言都带「未全量接入」—— 本批只做基建, 文案未替换', () => {
    // 守住这个事实: 引擎语言包能翻, 硬编码的界面文案翻不了。
    // 等文案替换批次落地后, 这条测试连同 NOT_WIRED_NOTICE 一起删。
    expect(NOT_WIRED_NOTICE).toBe('未全量接入')
    expect(LOCALES.map((l) => l.locale)).toEqual(['zh-CN', 'en-US'])
  })
})
