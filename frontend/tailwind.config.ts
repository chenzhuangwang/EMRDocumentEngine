// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

import {
  STANDARD_CHROME_TOKENS,
  type ChromeTokenName,
} from './src/platform/chrome/chromeTokens'

/**
 * chrome 中性色 token → Tailwind 配色。
 *
 * 写成 `rgb(var(--x, <standard 原值>) / <alpha-value>)` 而非裸 `var()`:
 * 1. `/80` 透明度修饰符只有这个形状才生效, 裸 `var()` 会让 `bg-chrome/80`
 *    静默退化成不透明 (PerfPanel / ReadingMode 用到半透明层);
 * 2. 第二参兜底 = standard 原值, 使 bootstrap 未跑到 / JS 失效时仍渲染出
 *    与今天一致的灰度, 不至于白底变透明。
 *
 * 数值单一来源 = chromeTokens.ts (同一份表也被 chromeTheme.ts 用于运行时写
 * CSS 变量), 此处不重复抄写数值。
 *
 * `chrome` 是"面 + 墨"的语义别名 (bg-chrome = 主面板底); `line` 单独成组,
 * 因为 Tailwind 的 border-/divide- 不读 chrome 组里的 surface 键。二者与
 * chromeTokens.ts 的 token 名一一对应, 且都 **不碰** 品牌色/语义色
 * (primary / success / warning / error / revision 保持字面 hex 不动)。
 */
const chromeColor = (name: ChromeTokenName) =>
  `rgb(var(--emr-${name}, ${STANDARD_CHROME_TOKENS[name]}) / <alpha-value>)`

const chromeColors = {
  chrome: {
    DEFAULT: chromeColor('surface'),
    subtle: chromeColor('surface-subtle'),
    muted: chromeColor('surface-muted'),
    strong: chromeColor('surface-strong'),
    desk: chromeColor('desk'),
    ink: chromeColor('ink'),
    'ink-strong': chromeColor('ink-strong'),
    'ink-body': chromeColor('ink-body'),
    'ink-secondary': chromeColor('ink-secondary'),
    'ink-tertiary': chromeColor('ink-tertiary'),
    'ink-muted': chromeColor('ink-muted'),
    'ink-disabled': chromeColor('ink-disabled'),
    // 主色底/字: 浅底牌片在深色下必须换成暗底亮字, 否则是一块块亮斑
    accent: chromeColor('accent'),
    'accent-strong': chromeColor('accent-strong'),
    'accent-stronger': chromeColor('accent-stronger'),
    'accent-ink': chromeColor('accent-ink'),
  },
  line: {
    DEFAULT: chromeColor('line'),
    subtle: chromeColor('line-subtle'),
    strong: chromeColor('line-strong'),
  },
}

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ...chromeColors,
        primary: {
          50: '#EFF6FF',
          100: '#DBEAFE',
          200: '#BFDBFE',
          300: '#93C5FD',
          400: '#60A5FA',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
          800: '#1E40AF',
          900: '#1E3A8A',
        },
        gray: {
          50: '#F9FAFB',
          100: '#F3F4F6',
          200: '#E5E7EB',
          300: '#D1D5DB',
          400: '#9CA3AF',
          500: '#6B7280',
          600: '#4B5563',
          700: '#374151',
          800: '#1F2937',
          900: '#111827',
        },
        success: {
          100: '#DCFCE7',
          500: '#22C55E',
        },
        warning: {
          100: '#FEF3C7',
          500: '#F59E0B',
        },
        error: {
          100: '#FEE2E2',
          500: '#EF4444',
        },
        revision: {
          insert: '#16A34A',
          delete: '#DC2626',
          modify: '#2563EB',
          'insert-bg': '#DCFCE7',
          'delete-bg': '#FEE2E2',
          'modify-bg': '#DBEAFE',
        },
      },
      fontFamily: {
        ui: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        content: ['"Noto Serif CJK SC"', '"Songti SC"', 'SimSun', 'serif'],
      },
      spacing: {
        'header': '48px',
        'toolbar': '40px',
        'statusbar': '28px',
        'sidebar': '240px',
        'properties': '280px',
      },
    },
  },
  plugins: [],
}
