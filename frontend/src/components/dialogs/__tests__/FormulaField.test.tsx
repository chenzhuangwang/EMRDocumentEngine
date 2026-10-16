// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// FormulaField 组件测试 (契约 §12.12.9)
//
// 本组件是**两个**控件配置弹框共用的撰写面, 所以它的行为在这里测一次;
// 每个弹框自己的接线 (tab → draft → payload) 在那两个弹框的用例里**成对**测。
//
// 试算一律注入假函数: 本组件不认识求值器 (§12.12.9 的"UI MUST NOT 伸进
// evaluation/ 内部"), 它只做"码 → 文案"。真求值器的行为在引擎侧用例里。
// ================================================================

import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { FormulaField } from '../controlConfigShared'
import type { ReferenceKey } from '../controlConfigShared'
import type { CalcResult } from '@emrde/document-engine'

const KEYS: ReferenceKey[] = [
  { key: 'DE_SBP', name: '收缩压', ambiguous: false },
  { key: 'DE_DBP', name: '舒张压', ambiguous: false },
  { key: 'CTL_INPUT', name: '通用输入', ambiguous: true },
]

/** 受控外壳 —— 插入按钮改的是受控值, 得让值真的回灌才看得见 */
function Harness({ initial = '', preview, referenceKeys = KEYS }: {
  initial?: string
  preview?: (f: string) => CalcResult
  referenceKeys?: readonly ReferenceKey[]
}) {
  const [v, setV] = useState(initial)
  return <FormulaField value={v} onChange={setV} referenceKeys={referenceKeys} preview={preview} />
}

const area = () => screen.getByPlaceholderText(/收缩压/) as HTMLTextAreaElement

describe('FormulaField (契约 §12.12.9)', () => {
  it('初值回填 + 写法说明在位 (引用按绑定键)', () => {
    render(<Harness initial="[DE_SBP] + [DE_DBP]" />)
    expect(area().value).toBe('[DE_SBP] + [DE_DBP]')
    expect(screen.getByText(/绑定键/)).toBeTruthy()
  })

  it('点可引用键 → 把 [键] 插进公式 (键就是绑定键, 手打是错字温床)', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /收缩压/ }))
    expect(area().value).toBe('[DE_SBP]')
    fireEvent.click(screen.getByRole('button', { name: /舒张压/ }))
    expect(area().value).toBe('[DE_SBP][DE_DBP]')
  })

  it('撞键的键标出来 (引用它必报歧义, 引擎不挑一个)', () => {
    render(<Harness />)
    // 未撞键的两个: 只有名字 + 键, 不带"撞键"字样
    expect(screen.getByRole('button', { name: /收缩压/ }).textContent).not.toContain('撞键')
    // 撞键的那个: 标出来并给出为什么
    const dup = screen.getByRole('button', { name: /通用输入/ })
    expect(dup.textContent).toContain('撞键')
    expect(dup.getAttribute('title')).toMatch(/歧义/)
  })

  it('文档里没有可引用键 → 空态说明, 而不是一个空盒子', () => {
    render(<Harness referenceKeys={[]} />)
    expect(screen.getByText(/还没有带身份键的控件/)).toBeTruthy()
  })

  it('值公式 → 显示试算结果', () => {
    const preview = vi.fn((): CalcResult => ({ ok: true, role: 'value', value: 120 }))
    render(<Harness initial="[DE_SBP] + [DE_DBP]" preview={preview} />)
    expect(preview).toHaveBeenCalledWith('[DE_SBP] + [DE_DBP]')
    expect(screen.getByText(/试算结果/).textContent).toContain('120')
  })

  it('触发式公式 → 说明它让哪个控件显示还是隐藏', () => {
    render(<Harness
      initial="[SEX] == 'M' ? HIDE([DE_OBST]) : SHOW([DE_OBST])"
      preview={() => ({ ok: true, role: 'visibility', directive: { key: 'DE_OBST', visible: false } })}
    />)
    expect(screen.getByText(/触发式/).textContent).toContain('隐藏')
    expect(screen.getByText(/触发式/).textContent).toContain('DE_OBST')
  })

  it('求值失败 → 显示**分类**文案, 不是一句"公式有误"', () => {
    render(<Harness
      initial="[DE_NOPE] + 1"
      preview={() => ({ ok: false, error: { code: 'unresolved_reference', message: 'no control has key' } })}
    />)
    expect(screen.getByText(/找不到/)).toBeTruthy()
    // 引擎给的人读 message 不直接上屏 —— 那会把切语言的界面漏成英文
    expect(screen.queryByText(/no control has key/)).toBeNull()
  })

  it('撞键错误另外带上候选数 (作者据此去改键)', () => {
    render(<Harness
      initial="[CTL_INPUT] + 1"
      preview={() => ({ ok: false, error: { code: 'ambiguous_reference', message: 'x', candidateNodeIds: ['a', 'b'] } })}
    />)
    expect(screen.getByText(/命中多个控件/).textContent).toContain('(2)')
  })

  it('公式为空 → 不试算 (没有公式不是错误)', () => {
    const preview = vi.fn((): CalcResult => ({ ok: true, role: 'value', value: 1 }))
    render(<Harness initial="   " preview={preview} />)
    expect(preview).not.toHaveBeenCalled()
    expect(screen.queryByText(/试算结果/)).toBeNull()
  })

  it('没有注入试算函数 → 不显示试算行 (不假装成功)', () => {
    render(<Harness initial="[DE_SBP] + 1" />)
    expect(screen.queryByText(/试算结果/)).toBeNull()
  })
})
