// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// 域代码文案随语言变 (i18n 引擎层接线闸门 — FieldFormatter 篇)
//
// 这条守住的是一个**用户可见的 bug**: 域代码的日期/时间此前硬编码
// `toLocaleDateString('zh-CN')`, 于是 en-US 界面下插入日期域, 画布上渲染出
// 的仍是中文格式 '2026/9/22'。FieldTextContext 里当时连 locale 字段都没有,
// 调用方想注入都没地方传 —— 所以这里同时断言**接口**与**行为**。
//
// 量宽与绘制必须同源: representativeFieldText (布局期) 与 resolveFieldText
// (渲染期) 用同一个 locale, 否则域后文字会重叠或拖出空白。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveFieldText, representativeFieldText } from '../document/factory/FieldFormatter'
import { locale } from '../i18n/index'
import type { Locale } from '../i18n/index'

const NOW = new Date(2026, 8, 22, 15, 30, 0)   // 2026-09-22 15:30

const ctxOf = (lc?: Locale) => ({
  pageNumber: 3, totalPages: 9, documentTitle: '入院记录', now: NOW, locale: lc,
})

beforeEach(() => { locale.setLocale('zh-CN') })
afterEach(() => { locale.setLocale('zh-CN') })

describe('resolveFieldText — 日期/时间域随 locale 变格式', () => {
  it('缺省 (不传 locale) → 中文格式, 与既有行为一致', () => {
    expect(resolveFieldText('current_date', undefined, ctxOf())).toBe('2026/9/22')
    expect(resolveFieldText('current_time', undefined, ctxOf())).toBe('15:30')
  })

  it('zh-CN → 2026/9/22', () => {
    expect(resolveFieldText('current_date', undefined, ctxOf('zh-CN'))).toBe('2026/9/22')
  })

  it('en-US → 9/22/2026 (不再是中文格式)', () => {
    const out = resolveFieldText('current_date', undefined, ctxOf('en-US'))
    expect(out).toBe('9/22/2026')
    // 关键: 与 zh-CN 的结果**不同** —— 只断言"有输出"会漏掉"两种语言一样"
    expect(out).not.toBe(resolveFieldText('current_date', undefined, ctxOf('zh-CN')))
  })

  it('last_saved_date / print_date 同样跟随 locale', () => {
    expect(resolveFieldText('last_saved_date', undefined, ctxOf('en-US'))).toBe('9/22/2026')
    expect(resolveFieldText('print_date', undefined, ctxOf('en-US'))).toBe('9/22/2026')
  })

  it('非日期域不受 locale 影响 (页码/标题/作者)', () => {
    expect(resolveFieldText('page_number', undefined, ctxOf('en-US'))).toBe('3')
    expect(resolveFieldText('total_pages', undefined, ctxOf('en-US'))).toBe('9')
    expect(resolveFieldText('document_title', undefined, ctxOf('en-US'))).toBe('入院记录')
    expect(resolveFieldText('author_name', undefined, ctxOf('en-US'))).toBe('user')
  })
})

describe('representativeFieldText — 量宽与绘制同源', () => {
  it('日期样本随 locale 变 (否则量宽与绘制宽漂移)', () => {
    const zh = representativeFieldText('current_date', '[日期]', { totalPagesHint: 1, locale: 'zh-CN' })
    const en = representativeFieldText('current_date', '[日期]', { totalPagesHint: 1, locale: 'en-US' })
    expect(zh).toBe('2026/12/28')
    expect(en).toBe('12/28/2026')
    expect(en).not.toBe(zh)
  })

  it('缺省 → 中文样本 (既有测试不传 locale, 断言的是中文格式)', () => {
    expect(representativeFieldText('current_date', '[日期]', { totalPagesHint: 1 }))
      .toMatch(/^\d{4}\/\d{1,2}\/\d{1,2}$/)
  })
})
