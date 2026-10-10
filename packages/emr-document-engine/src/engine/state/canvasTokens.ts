// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// canvasTokens — 引擎画布主题 token 表 (canvas theme, 4 预设 × 28 token)
//
// 与 chromeTokens.ts 同形: 所有 token 值是 "R G B" 三元组字符串, 渲染时通过
//   withAlpha(t.pageBg, 0.5) → 'rgb(<r> <g> <b> / 0.5)'
// 拼出最终 fillStyle/strokeStyle; 无 alpha 时用 asRgb(t.pageBg) → 'rgb(<r>, <g>, <b>)'。
//
// 为什么不直接存 hex: 与 chromeTokens 同构, 让"透明度修饰符友好"形态成为
// 单一来源; 也避免与 chrome 19 token 在四元组/三元组上漂移。
//
// 本文件 **不得** 引入任何运行时副作用 —— tailwind/jiti 不读它, 但
// EditorTheme / DomPlatformHost / 各 Particle 都在运行期 import, 任何模块
// 解析副作用会污染首帧。
// ============================================================

import type { ThemePreset } from './EditorTheme'

/** 单预设下的 28 token 集合。所有值形态为 "R G B" (空格分隔, 0-255)。 */
export type CanvasTokenSet = Record<CanvasTokenName, string>

export type CanvasTokenName =
  // ---- 基础面 / 墨 ----
  | 'pageBg'           // 纸面 (LayeredRenderer 静态层每页 fillRect)
  | 'canvasBg'         // 画布桌面 (容器 CSS / EditorTheme 旧 canvasBg)
  | 'textInk'          // 正文 ink 默认色
  | 'secondaryInk'     // 次级 ink (列表标记 / 控件 fallback)
  | 'fallbackInk'      // DOM overlay 文本默认
  | 'cursorColor'      // 光标
  // ---- 选区 / 交互高亮 ----
  | 'selectionBg'      // 选区底 (正文 / HF, alpha 0.2)
  | 'selectionBgCell'  // 单元格框选底 (alpha 0.16)
  | 'selectionBorder'  // 选区边框 + 列宽拖拽 + 设计模式控件 (alpha 0.85 / 0.10)
  // ---- 页眉页脚编辑态 ----
  | 'hfFocusRing'      // HF 编辑虚线框
  | 'hfMask'           // HF 编辑蒙层 (alpha 0.15)
  | 'hfDivider'        // HF 分隔线 + 页面 L 标记
  // ---- 修订 / 不可见字符 ----
  | 'revisionInsert'   // 修订-插入
  | 'revisionDelete'   // 修订-删除
  | 'revisionModify'   // 修订-修改
  | 'invisibleChar'    // 不可见字符 (空格 / 制表符 / 换行)
  // ---- 批注 ----
  | 'commentHighlight' // 批注高亮底 (alpha 0.45)
  // ---- 表格 ----
  | 'tableBorder'      // 表格 cell 边框
  | 'tableHeaderBg'    // 表头底
  // ---- 控件 / SmartText ----
  | 'placeholder'      // 占位灰 (空态 / 控件空)
  | 'frameFilled'      // 控件填充态框
  | 'frameReadonly'    // 控件只读框
  | 'frameMasked'      // 脱敏红框
  | 'glyphSelected'    // 选中 glyph
  | 'glyphUnselected'  // 未选 glyph
  // ---- 脚注 / 图片 ----
  | 'footnoteRef'      // 脚注引用默认色
  | 'imagePlaceholder'       // 图片占位底
  | 'imagePlaceholderBorder' // 图片占位虚线边

export const CANVAS_TOKEN_NAMES: readonly CanvasTokenName[] = [
  'pageBg', 'canvasBg', 'textInk', 'secondaryInk', 'fallbackInk', 'cursorColor',
  'selectionBg', 'selectionBgCell', 'selectionBorder',
  'hfFocusRing', 'hfMask', 'hfDivider',
  'revisionInsert', 'revisionDelete', 'revisionModify', 'invisibleChar',
  'commentHighlight',
  'tableBorder', 'tableHeaderBg',
  'placeholder', 'frameFilled', 'frameReadonly', 'frameMasked',
  'glyphSelected', 'glyphUnselected',
  'footnoteRef', 'imagePlaceholder', 'imagePlaceholderBorder',
]

/**
 * 4 预设 × 28 token。**standard 预设严格对齐今天 Draw / 各 Particle 的硬编码 hex**,
 * 使批量替换后 standard 视觉零回归 (除 `cursorColor` 这一处已知差: 旧 `'#000000'`
 * → 新 `17 24 39`, 与 EditorTheme 现 `cursorColor: '#1F2937'` 对齐 — 设计意图)。
 */
export const CANVAS_TOKENS: Record<ThemePreset, CanvasTokenSet> = {
  standard: {
    // 基础面 / 墨 (与今天硬编码完全对齐)
    pageBg: '255 255 255',           // #FFFFFF (LayeredRenderer:184)
    canvasBg: '245 245 245',         // #F5F5F5 (EditorTheme.canvasBg 旧值)
    textInk: '31 41 55',             // #1F2937 (EditorTheme.textColor / TableParticle:85)
    secondaryInk: '55 65 81',        // #374151 (ListParticle:41 / ControlParticle:142)
    fallbackInk: '55 65 81',         // #374151 (Draw:1552,1553)
    cursorColor: '17 24 39',         // #111827 (Draw:646 原 '#000000' → 设计意图改为深灰)
    // 选区 (RGB 三元组, 渲染时 withAlpha 拼)
    selectionBg: '59 130 246',       // Draw:832,1000 rgba(59,130,246,0.2)
    selectionBgCell: '59 130 246',   // Draw:1082 rgba(59,130,246,0.16)
    selectionBorder: '37 99 235',    // Draw:776,1083,1124,1125
    // HF
    hfFocusRing: '147 197 253',      // #93C5FD (Draw:688,742)
    hfMask: '107 114 128',           // #6B7280 (Draw:718 + 0.15)
    hfDivider: '204 204 204',        // #CCCCCC (Draw:1226 / LayeredRenderer:340)
    // 修订
    revisionInsert: '22 163 74',     // #16A34A
    revisionDelete: '220 38 38',     // #DC2626
    revisionModify: '37 99 235',     // #2563EB
    invisibleChar: '147 197 253',    // #93C5FD
    // 批注 (黄色跨预设保留, dark 下仍亮)
    commentHighlight: '255 230 100', // rgba(255,230,100,0.45)
    // 表格
    tableBorder: '156 163 175',      // #9CA3AF
    tableHeaderBg: '243 244 246',    // #F3F4F6
    // 控件
    placeholder: '156 163 175',      // #9CA3AF
    frameFilled: '107 114 128',      // #6B7280
    frameReadonly: '209 213 219',    // #D1D5DB
    frameMasked: '248 113 113',      // #F87171
    glyphSelected: '37 99 235',      // #2563EB
    glyphUnselected: '156 163 175',  // #9CA3AF
    // 脚注 / 图片
    footnoteRef: '37 99 235',        // #2563EB
    imagePlaceholder: '229 231 235', // #E5E7EB
    imagePlaceholderBorder: '156 163 175', // #9CA3AF
  },

  eyeCare: {
    // 暖色低对比 —— 与 chrome eyeCare 纸面一致
    pageBg: '245 240 232',           // #F5F0E8
    canvasBg: '234 227 217',         // #EAE3D9
    textInk: '61 50 38',             // #3D3226
    secondaryInk: '92 75 58',        // #5C4B3A
    fallbackInk: '92 75 58',
    cursorColor: '61 50 38',
    // 暖色系, 选区蓝改成暖棕避免冷蓝牌片
    selectionBg: '180 140 100',
    selectionBgCell: '180 140 100',
    selectionBorder: '120 85 50',
    hfFocusRing: '180 140 100',
    hfMask: '130 110 88',
    hfDivider: '205 192 172',
    revisionInsert: '22 130 60',     // 暖绿
    revisionDelete: '200 60 50',     // 暖红
    revisionModify: '120 85 50',     // 暖棕
    invisibleChar: '180 140 100',
    commentHighlight: '255 230 100', // 黄色跨预设保留
    tableBorder: '150 132 120',
    tableHeaderBg: '232 224 210',
    placeholder: '150 132 120',
    frameFilled: '130 110 88',
    frameReadonly: '205 192 172',
    frameMasked: '220 100 100',
    glyphSelected: '92 75 58',
    glyphUnselected: '150 132 120',
    footnoteRef: '92 75 58',
    imagePlaceholder: '222 212 196',
    imagePlaceholderBorder: '150 132 120',
  },

  print: {
    // 灰阶 + 高对比 —— "所见即打印"
    pageBg: '255 255 255',
    canvasBg: '255 255 255',         // 与纸面同白
    textInk: '0 0 0',
    secondaryInk: '34 34 34',
    fallbackInk: '34 34 34',
    cursorColor: '0 0 0',
    // 选区改成纯黑系 (alpha 0.15/0.85)
    selectionBg: '0 0 0',
    selectionBgCell: '0 0 0',
    selectionBorder: '0 0 0',
    hfFocusRing: '0 0 0',
    hfMask: '85 85 85',
    hfDivider: '153 153 153',        // 比 standard 更深的分隔线, 适合打印
    revisionInsert: '0 0 0',         // 打印无修订色语义, 收成黑
    revisionDelete: '0 0 0',
    revisionModify: '0 0 0',
    invisibleChar: '0 0 0',
    commentHighlight: '255 230 100', // 黄色批注高亮仍保留 (打印上有助批阅)
    tableBorder: '153 153 153',
    tableHeaderBg: '229 229 229',
    placeholder: '153 153 153',
    frameFilled: '85 85 85',
    frameReadonly: '187 187 187',
    frameMasked: '220 38 38',
    glyphSelected: '0 0 0',
    glyphUnselected: '153 153 153',
    footnoteRef: '0 0 0',
    imagePlaceholder: '229 229 229',
    imagePlaceholderBorder: '153 153 153',
  },

  dark: {
    // 暗色外壳 + 亮蓝 accent (对齐 chromeTokens.dark.surface)
    pageBg: '30 30 30',              // #1E1E1E
    canvasBg: '45 45 45',            // #2D2D2D
    textInk: '229 229 229',          // #E5E5E5
    secondaryInk: '204 204 204',     // #CCCCCC
    fallbackInk: '204 204 204',
    cursorColor: '237 237 237',      // #EDEDED
    // 选区仍用蓝 (alpha 0.4 在深底上对比足够)
    selectionBg: '59 130 246',
    selectionBgCell: '59 130 246',
    selectionBorder: '96 165 250',   // 边框调亮 (primary-400)
    hfFocusRing: '147 197 253',
    hfMask: '128 128 128',
    hfDivider: '77 77 77',
    // 修订色亮调
    revisionInsert: '134 239 172',
    revisionDelete: '248 113 113',
    revisionModify: '147 197 253',
    invisibleChar: '147 197 253',
    commentHighlight: '255 230 100', // 黄色批注高亮仍保留
    tableBorder: '128 128 128',
    tableHeaderBg: '58 58 58',
    placeholder: '128 128 128',
    frameFilled: '156 163 175',     // 控件填充态在深底要更亮
    frameReadonly: '75 75 75',
    frameMasked: '248 113 113',
    glyphSelected: '147 197 253',
    glyphUnselected: '128 128 128',
    footnoteRef: '147 197 253',
    imagePlaceholder: '58 58 58',
    imagePlaceholderBorder: '128 128 128',
  },
}

/** standard 预设 —— 首帧 / 未 bootstrap 时兜底值 */
export const STANDARD_CANVAS_TOKENS: CanvasTokenSet = CANVAS_TOKENS.standard

// ---- 工具 ----

/** "R G B" 三元组 → 'rgb(R, G, B)' (无 alpha) */
export function asRgb(rgb: string | null | undefined): string {
  if (!rgb) return 'rgb(0, 0, 0)'
  return `rgb(${rgb.replace(/\s+/g, ', ')})`
}

/** "R G B" 三元组 + alpha → 'rgb(R G B / α)' (CSS Color Level 4 形态, Canvas 2D 接受) */
export function withAlpha(rgb: string | null | undefined, alpha: number): string {
  if (!rgb) return 'rgb(0 0 0 / 0)'
  return `rgb(${rgb} / ${alpha})`
}

/** 运行时收窄 —— 外部输入 (localStorage / 网络) 可能给任意字符串 */
export function isCanvasTokenName(name: unknown): name is CanvasTokenName {
  // hasOwnProperty 而非 `in`: `in` 会沿原型链命中 'toString'
  return typeof name === 'string'
    && Object.prototype.hasOwnProperty.call(CANVAS_TOKENS.standard, name)
}