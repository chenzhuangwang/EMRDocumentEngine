// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// chromeToken 表 — 纯数据, 零运行时依赖
//
// 为什么单独一个文件: tailwind.config.ts (构建期, 由 jiti 加载) 与
// platform/chrome/chromeTheme.ts (运行期) 都要读这张表。放在此处后两边共用同一
// 份数值, 不存在"配置里抄一遍 token"的漂移可能。
// 因此本文件 **不得** 引入任何运行时 import —— 连类型 import 也走 engine
// 的纯类型模块, 保证 jiti 求值时不触发任何模块解析。
// ============================================================

import type { ThemePreset } from '@emrde/document-engine'

/**
 * 每个 chrome token 存 **"R G B" 三元组**而非完整颜色。
 *
 * 原因: Tailwind 的透明度修饰符 (如 `bg-chrome` 后缀 `/80`) 只有在配色写成
 * `rgb(var(--x) / <alpha-value>)` 时才会生效; 若变量直接存 `#fff`,
 * `/<alpha-value>` 无处插入, 斜杠透明度会**静默失效**并渲染成不透明色。
 */
export type ChromeTokenSet = Record<ChromeTokenName, string>

/** token 名即 CSS 变量名后缀: `surface` → `--emr-surface` */
export type ChromeTokenName =
  // 面 (背景)
  | 'surface'         // 主面板底 (原 bg-white)
  | 'surface-subtle'  // 次级底 (原 bg-gray-50)
  | 'surface-muted'   // 三级底 / hover 底 (原 bg-gray-100)
  | 'surface-strong'  // 强分隔底 (原 bg-gray-200)
  | 'desk'            // 画布桌面色 (原 bg-[#E5E7EB])
  // 墨 (文字), 7 级不塌陷 —— 塌陷会改变视觉层次, 产生极难发现的隐性回归
  | 'ink'             // 原 text-gray-900
  | 'ink-strong'      // 原 text-gray-800
  | 'ink-body'        // 原 text-gray-700
  | 'ink-secondary'   // 原 text-gray-600
  | 'ink-tertiary'    // 原 text-gray-500
  | 'ink-muted'       // 原 text-gray-400
  | 'ink-disabled'    // 原 text-gray-300
  // 线 (边框 / 分隔)
  | 'line'            // 原 border-gray-200
  | 'line-subtle'     // 原 border-gray-100 / border-gray-50 / divide-gray-50
  | 'line-strong'     // 原 border-gray-300
  // 主色底 (选中/强调面)。**浅底牌片必须主题化**: primary-50/100/200 是固定
  // 浅色 hex, 深色外壳下会变成一块块近白的亮块 —— 与"按钮没换"同样刺眼。
  | 'accent'          // 原 bg-primary-50
  | 'accent-strong'   // 原 bg-primary-100
  | 'accent-stronger' // 原 bg-primary-200
  // 主色字/图标 (含浅底牌片上的字, 以及无底色外壳面上的品牌字)
  //
  // 一个 token 够用的理由: 每个预设里 accent 与 surface 的明暗**同向**
  // (浅色系两边都浅, 深色系两边都深), 所以"对浅底显深、对深底显浅"的同一个
  // 颜色同时满足两种落点。深色下 accent-ink(#93C5FD) 在 accent(#1E3A5F) 上
  // ≈6.3:1, 在 surface(#252525) 上 ≈8.6:1; 实测过, 不是推测。
  | 'accent-ink'

export const CHROME_TOKEN_NAMES: readonly ChromeTokenName[] = [
  'surface', 'surface-subtle', 'surface-muted', 'surface-strong', 'desk',
  'ink', 'ink-strong', 'ink-body', 'ink-secondary', 'ink-tertiary',
  'ink-muted', 'ink-disabled',
  'line', 'line-subtle', 'line-strong',
  'accent', 'accent-strong', 'accent-stronger', 'accent-ink',
]

/**
 * 4 预设 × 19 token。
 *
 * **standard 的数值刻意取自今天 Tailwind 灰度的原值** —— 使 P1 的大批量
 * class 替换在 standard 下**解析出同一颜色**, 把回归风险压到最低
 * (验收口径是浏览器 computed style 一致, 不是 CSS 源码字符串相同)。
 *
 * 命名空间刻意避开引擎既有的 8 个画布变量 (`--emr-page-bg` /
 * `--emr-canvas-bg` / `--emr-text-color` / `--emr-chrome-bg` /
 * `--emr-chrome-text` / `--emr-selection-bg` / `--emr-cursor-color` /
 * `--emr-hf-bg`), 将来画布主题化时两套变量互不覆盖 (契约 §27.1)。
 */
export const CHROME_TOKENS: Record<ThemePreset, ChromeTokenSet> = {
  standard: {
    'surface': '255 255 255',        // #FFFFFF
    'surface-subtle': '249 250 251', // gray-50
    'surface-muted': '243 244 246',  // gray-100
    'surface-strong': '229 231 235', // gray-200
    'desk': '229 231 235',           // #E5E7EB
    'ink': '17 24 39',               // gray-900
    'ink-strong': '31 41 55',        // gray-800
    'ink-body': '55 65 81',          // gray-700
    'ink-secondary': '75 85 99',     // gray-600
    'ink-tertiary': '107 114 128',   // gray-500
    'ink-muted': '156 163 175',      // gray-400
    'ink-disabled': '209 213 219',   // gray-300
    'line': '229 231 235',           // gray-200
    'line-subtle': '243 244 246',    // gray-100
    'line-strong': '209 213 219',    // gray-300
    'accent': '239 246 255',         // primary-50
    'accent-strong': '219 234 254',  // primary-100
    'accent-stronger': '191 219 254',// primary-200
    'accent-ink': '29 78 216',       // primary-700
  },

  eyeCare: {
    'surface': '245 240 232',        // #F5F0E8 (对齐 EditorTheme.eyeCare.pageBg)
    'surface-subtle': '237 229 216', // #EDE5D8 (对齐 hfBg)
    'surface-muted': '234 227 217',  // #EAE3D9 (对齐 canvasBg)
    'surface-strong': '222 212 196', // #DED4C4
    'desk': '234 227 217',
    'ink': '61 50 38',               // #3D3226 (对齐 textColor)
    'ink-strong': '74 60 45',        // #4A3C2D
    'ink-body': '92 75 58',          // #5C4B3A (对齐 chromeText)
    'ink-secondary': '110 92 72',    // #6E5C48
    'ink-tertiary': '130 110 88',    // #826E58
    'ink-muted': '150 132 112',      // #968470
    'ink-disabled': '172 156 138',   // #AC9C8A
    'line': '222 212 196',
    'line-subtle': '232 224 210',
    'line-strong': '205 192 172',
    // 护眼是暖色系, 主色底也随之偏暖 —— 否则冷蓝牌片会在一片暖棕里跳出来
    'accent': '232 220 200',         // #E8DCC8
    'accent-strong': '218 203 178',  // #DACBB2
    'accent-stronger': '201 184 156',// #C9B89C
    'accent-ink': '92 75 58',        // #5C4B3A (对齐 chromeText)
  },

  print: {
    'surface': '255 255 255',
    'surface-subtle': '250 250 250', // #FAFAFA (对齐 hfBg)
    'surface-muted': '245 245 245',
    'surface-strong': '229 229 229',
    'desk': '255 255 255',           // 打印预设下桌面与纸面同白 (对齐 canvasBg)
    'ink': '0 0 0',                  // 对齐 EditorTheme.print.textColor
    'ink-strong': '17 17 17',        // #111111
    'ink-body': '34 34 34',          // #222222
    'ink-secondary': '51 51 51',     // #333333
    'ink-tertiary': '85 85 85',      // #555555
    'ink-muted': '119 119 119',      // #777777
    'ink-disabled': '153 153 153',   // #999999
    'line': '51 51 51',
    'line-subtle': '102 102 102',
    'line-strong': '0 0 0',
    // 打印预设是全黑白, 主色也收成灰阶 —— 留彩色会破坏"所见即打印"的预期
    'accent': '229 229 229',         // #E5E5E5
    'accent-strong': '209 209 209',  // #D1D1D1
    'accent-stronger': '179 179 179',// #B3B3B3
    'accent-ink': '0 0 0',
  },

  dark: {
    'surface': '37 37 37',           // #252525 (对齐 EditorTheme.dark.chromeBg)
    'surface-subtle': '30 30 30',    // #1E1E1E (对齐 pageBg)
    'surface-muted': '45 45 45',     // #2D2D2D (对齐 canvasBg)
    'surface-strong': '58 58 58',    // #3A3A3A
    'desk': '24 24 24',              // #181818 —— 比纸面更深, 深色下要能看出画布边界
    'ink': '237 237 237',            // #EDEDED
    'ink-strong': '229 229 229',     // #E5E5E5 (对齐 textColor)
    'ink-body': '204 204 204',       // #CCCCCC (对齐 chromeText)
    'ink-secondary': '179 179 179',  // #B3B3B3
    'ink-tertiary': '153 153 153',   // #999999
    'ink-muted': '128 128 128',      // #808080
    'ink-disabled': '102 102 102',   // #666666
    'line': '58 58 58',
    'line-subtle': '45 45 45',
    'line-strong': '77 77 77',
    // 浅底牌片在深色下换成暗蓝底 + 亮蓝字。
    // 对比度实测: accent-ink(#93C5FD) on accent(#1E3A5F) ≈ 6.3:1 (AA 通过);
    // 反例是原来的 primary-50 浅底 —— 在外壳上就是一块亮斑。
    'accent': '30 58 95',            // #1E3A5F
    'accent-strong': '37 71 116',    // #254774
    'accent-stronger': '44 84 135',  // #2C5487
    'accent-ink': '147 197 253',     // primary-300
  },
}

/** standard 预设 —— tailwind.config.ts 用它做 `var()` 兜底值 (首帧/未 bootstrap 时) */
export const STANDARD_CHROME_TOKENS: ChromeTokenSet = CHROME_TOKENS.standard

/** token 名 → CSS 变量名 */
export function chromeCssVar(name: ChromeTokenName): string {
  return `--emr-${name}`
}
