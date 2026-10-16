// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// FormulaAuthoringGate — 「公式撰写面只兑现了一半」的 CI 硬闸门 (契约 §12.12.9)
//
// §12.12.9 有一句是硬的:
//
//     BOTH Control Config Dialogs MUST expose formula authoring … Exposing it
//     in one only would repeat the §12.5 mistake, where one contract clause was
//     honoured for half the controls.
//
// 而这句话的失败形态在本仓**已经发生过一次**(语义身份只给了输入域弹框), 且它
// 不会红任何测试: 弹框照常打开、照常应用, 只是其中一个少了整块撰写面。组件用例
// 覆盖不了它 —— 用例是照着某个弹框写的, "另一个弹框也存在这条路"这件事没有断言
// 能自然长出来。
//
// 所以把它变成静态事实, 三条:
//   A. 应用里**每一处** <ControlInputDialog / <ControlChoiceDialog 的用法都必须
//      传 referenceKeys 与 onPreviewFormula。少一个, 那个入口的「计算」tab 就成了
//      一个空盒子 (键清单列不出来、试算不做) —— 界面不报错, 作者以为文档里没有键。
//   B. 两个弹框文件都渲染同一个 FormulaField (§11: 第二次实现即须抽取)。
//   C. 两个弹框的 TAB_ORDER 里都有 'formula' —— tab 不在顺序表里等于点不到。
//
// 改白名单时想清楚: 放行一处等于承认那个入口**不该**能写公式。那不是白名单, 那是
// 契约不该那么写。
// ============================================================

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cwd } from 'node:process'

/** 应用源码根 (vitest 的 cwd 是 frontend/) */
const APP_SRC = join(cwd(), 'src')

/** 递归列出目录下的 .ts/.tsx 文件, 跳过 __tests__ (夹具里的用法不是产品入口) */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      walk(full, out)
    } else if (/\.tsx?$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

/** 取出「一个自闭合 JSX 元素」的源码片段 (从 < 起到它自己的 /> 止) */
function jsxElements(source: string, tag: string): string[] {
  const out: string[] = []
  const re = new RegExp(`<${tag}\\b`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    const end = source.indexOf('/>', m.index)
    out.push(source.slice(m.index, end === -1 ? m.index + 800 : end))
  }
  return out
}

describe('FormulaAuthoringGate (契约 §12.12.9)', () => {
  it('每一处控件配置弹框的用法都接上了公式撰写面', () => {
    const files = walk(APP_SRC)
    let usages = 0
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const tag of ['ControlInputDialog', 'ControlChoiceDialog']) {
        for (const el of jsxElements(source, tag)) {
          usages++
          expect(
            el.includes('referenceKeys='),
            `${file}: <${tag}> 没传 referenceKeys —— 那个入口的「计算」tab 列不出可引用的键`,
          ).toBe(true)
          expect(
            el.includes('onPreviewFormula='),
            `${file}: <${tag}> 没传 onPreviewFormula —— 那个入口的作者看不到试算与错误`,
          ).toBe(true)
        }
      }
    }
    // 至少 4 处: 两个弹框 × (向导 create / 右键属性 edit)
    expect(usages, '没有扫到任何弹框用法 — 闸门本身失效了, 别把它当成绿').toBeGreaterThanOrEqual(4)
  })

  it('两个弹框都渲染同一个 FormulaField, 且 tab 在顺序表里', () => {
    for (const rel of ['components/dialogs/ControlInputDialog.tsx', 'components/dialogs/ControlChoiceDialog.tsx']) {
      const source = readFileSync(join(APP_SRC, rel), 'utf8')
      expect(source.includes('<FormulaField'), `${rel}: 没渲染 FormulaField`).toBe(true)
      // tab 不在 TAB_ORDER 里 = 点不到 (Content 存在也没用)
      const order = /const TAB_ORDER[^\n]*/.exec(source)?.[0] ?? ''
      expect(order, `${rel}: TAB_ORDER 里没有 'formula'`).toContain("'formula'")
    }
  })

  it('FormulaField 只有一份实现 (§11: 第二次实现即须抽取)', () => {
    const impls = walk(APP_SRC).filter((f) => /export function FormulaField\b/.test(readFileSync(f, 'utf8')))
    expect(impls.map((f) => f.slice(APP_SRC.length + 1).replace(/\\/g, '/')))
      .toEqual(['components/dialogs/controlConfigShared.tsx'])
  })
})
