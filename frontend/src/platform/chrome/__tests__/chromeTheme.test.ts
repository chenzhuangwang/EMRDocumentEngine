// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

import { describe, it, expect, beforeEach } from 'vitest'
import {
  applyChromeTheme,
  readStoredChromePreset,
  storeChromePreset,
  isThemePreset,
  CHROME_PRESETS,
  CHROME_THEME_STORAGE_KEY,
} from '../chromeTheme'
import { CHROME_TOKENS, CHROME_TOKEN_NAMES } from '../chromeTokens'

/** 取 :root 上某个 chrome 变量的当前值 */
const readVar = (name: string) =>
  document.documentElement.style.getPropertyValue(`--emr-${name}`)

beforeEach(() => {
  document.documentElement.removeAttribute('style')
  delete document.documentElement.dataset.theme
  localStorage.clear()
})

describe('applyChromeTheme', () => {
  it('写入全部 chrome 变量与 data-theme', () => {
    applyChromeTheme('dark')

    for (const name of CHROME_TOKEN_NAMES) {
      expect(readVar(name), name).toBe(CHROME_TOKENS.dark[name])
    }
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('同步 color-scheme —— 浏览器自绘的滚动条/下拉框只看这一个开关', () => {
    applyChromeTheme('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')

    for (const preset of ['standard', 'eyeCare', 'print'] as const) {
      applyChromeTheme(preset)
      expect(document.documentElement.style.colorScheme, preset).toBe('light')
    }
  })

  it('变量值是 R G B 三元组 —— 这是 Tailwind 的 /透明度 生效的前提', () => {
    applyChromeTheme('standard')

    for (const name of CHROME_TOKEN_NAMES) {
      expect(readVar(name), name).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/)
    }
  })

  it('不碰引擎的 8 个画布变量 (两套命名空间必须互不覆盖)', () => {
    // 先由引擎侧写下一个画布变量, 再切 chrome 主题, 它不能被冲掉
    document.documentElement.style.setProperty('--emr-canvas-bg', '#F5F5F5')
    applyChromeTheme('dark')

    expect(readVar('canvas-bg')).toBe('#F5F5F5')
    // 且 chrome 的 token 名与画布变量名无一重合
    const canvasVars = new Set([
      '--emr-page-bg', '--emr-canvas-bg', '--emr-text-color', '--emr-chrome-bg',
      '--emr-chrome-text', '--emr-selection-bg', '--emr-cursor-color', '--emr-hf-bg',
    ])
    for (const name of CHROME_TOKEN_NAMES) {
      expect(canvasVars.has(`--emr-${name}`), name).toBe(false)
    }
  })

  it('幂等 —— StrictMode 双跑 / 重复调用不产生副作用', () => {
    applyChromeTheme('eyeCare')
    const first = CHROME_TOKEN_NAMES.map(readVar)
    applyChromeTheme('eyeCare')

    expect(CHROME_TOKEN_NAMES.map(readVar)).toEqual(first)
  })

  it('未知 preset 不抛, 且整套回落 standard (不留半套变量)', () => {
    expect(() => applyChromeTheme('neon' as never)).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('standard')
    for (const name of CHROME_TOKEN_NAMES) {
      expect(readVar(name), name).toBe(CHROME_TOKENS.standard[name])
    }
  })
})

describe('standard 预设 = 今天的 Tailwind 灰度原值', () => {
  // 这组 hex 是**独立抄自 tailwind.config.ts 的调色板**, 不是从 chromeTokens
  // 反推的 —— 它守的是"大批量替换后 standard 下视觉不变"这条验收口径。
  // 谁要是改了 standard 的某个数值, 这里会红, 而不是等到肉眼发现颜色变了。
  const TAILWIND_GRAY: Record<string, string> = {
    white: '255 255 255',
    'gray-50': '249 250 251',
    'gray-100': '243 244 246',
    'gray-200': '229 231 235',
    'gray-300': '209 213 219',
    'gray-400': '156 163 175',
    'gray-500': '107 114 128',
    'gray-600': '75 85 99',
    'gray-700': '55 65 81',
    'gray-800': '31 41 55',
    'gray-900': '17 24 39',
  }

  const EXPECTED: Record<string, keyof typeof TAILWIND_GRAY> = {
    'surface': 'white',
    'surface-subtle': 'gray-50',
    'surface-muted': 'gray-100',
    'surface-strong': 'gray-200',
    'desk': 'gray-200',
    'ink': 'gray-900',
    'ink-strong': 'gray-800',
    'ink-body': 'gray-700',
    'ink-secondary': 'gray-600',
    'ink-tertiary': 'gray-500',
    'ink-muted': 'gray-400',
    'ink-disabled': 'gray-300',
    'line': 'gray-200',
    'line-subtle': 'gray-100',
    'line-strong': 'gray-300',
  }

  it('15 个 standard token 逐个等于对应的 Tailwind 灰度', () => {
    for (const [token, gray] of Object.entries(EXPECTED)) {
      expect(CHROME_TOKENS.standard[token as never], token).toBe(TAILWIND_GRAY[gray])
    }
  })

  it('7 级 ink 不塌陷 —— 任意两级都不同值', () => {
    const inks = [
      'ink', 'ink-strong', 'ink-body', 'ink-secondary',
      'ink-tertiary', 'ink-muted', 'ink-disabled',
    ] as const
    const values = inks.map((k) => CHROME_TOKENS.standard[k])

    expect(new Set(values).size).toBe(inks.length)
  })

  it('4 个 accent token 逐个等于对应的 primary 原色', () => {
    // 同样独立抄自 tailwind.config.ts 的 primary 调色板
    expect(CHROME_TOKENS.standard.accent).toBe('239 246 255')          // primary-50
    expect(CHROME_TOKENS.standard['accent-strong']).toBe('219 234 254')// primary-100
    expect(CHROME_TOKENS.standard['accent-stronger']).toBe('191 219 254') // primary-200
    expect(CHROME_TOKENS.standard['accent-ink']).toBe('29 78 216')     // primary-700
  })
})

describe('深色预设的可读性 (浅底牌片不能留亮斑)', () => {
  const rgb = (triple: string) => triple.split(' ').map(Number)
  /** WCAG 相对亮度 */
  const lum = (t: string) => {
    const [r, g, b] = rgb(t).map((v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }

  it('dark: accent 底本身就是暗的, 不再是亮斑', () => {
    // 亮度过高 = 深色外壳上的一块亮块。0.5 是"明显发亮"的经验线,
    // 原来的 primary-50(#EFF6FF) 亮度约 0.90, 远在线上。
    expect(lum(CHROME_TOKENS.dark.accent)).toBeLessThan(0.5)
    expect(lum(CHROME_TOKENS.dark['accent-strong'])).toBeLessThan(0.5)
    expect(lum(CHROME_TOKENS.dark['accent-stronger'])).toBeLessThan(0.5)
  })

  it('dark: accent-ink 在 accent 底与 surface 面上都过 AA (4.5:1)', () => {
    const ink = CHROME_TOKENS.dark['accent-ink']

    expect(contrast(ink, CHROME_TOKENS.dark.accent)).toBeGreaterThan(4.5)
    expect(contrast(ink, CHROME_TOKENS.dark['accent-strong'])).toBeGreaterThan(4.5)
    expect(contrast(ink, CHROME_TOKENS.dark.surface)).toBeGreaterThan(4.5)
  })
})

describe('预设表', () => {
  it('CHROME_PRESETS 覆盖全部 4 个 preset, 且与 token 表键集一致', () => {
    expect(CHROME_PRESETS.map((p) => p.preset).sort())
      .toEqual(Object.keys(CHROME_TOKENS).sort())
  })
})

describe('持久化', () => {
  it('无记录 → standard', () => {
    expect(readStoredChromePreset()).toBe('standard')
  })

  it('写入后可读回', () => {
    for (const { preset } of CHROME_PRESETS) {
      storeChromePreset(preset)
      expect(readStoredChromePreset()).toBe(preset)
    }
  })

  it('脏数据 → standard, 不进 DOM', () => {
    localStorage.setItem(CHROME_THEME_STORAGE_KEY, '{"not":"a preset"}')
    expect(readStoredChromePreset()).toBe('standard')
  })

  it('isThemePreset 收窄', () => {
    expect(isThemePreset('dark')).toBe(true)
    expect(isThemePreset('neon')).toBe(false)
    expect(isThemePreset(null)).toBe(false)
    expect(isThemePreset(undefined)).toBe(false)
    // 原型链上的键不算
    expect(isThemePreset('toString')).toBe(false)
  })
})
