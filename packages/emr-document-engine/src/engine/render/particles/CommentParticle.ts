// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// commentHighlight — 批注高亮颜色的唯一来源
//
// 历史: 本文件曾是 CommentParticle (R32), 实现 IParticle 但从未接入
// particleRegistry, 布局也不为 comment_marker 产出 SLIF item —— render()
// 永远不跑。批注高亮的实际绘制在 Draw.drawCommentHighlightsForPage
// (按 doc.comments 的 range 逐 item 解析, 屏幕与打印共用)。2026-10-21
// 经裁决删除死工厂 createCommentParticle 与 barrel 导出, 只保留 Draw
// 仍在使用的颜色常量/主题化函数。
// ============================================================

import type { CanvasTokenSet } from '../../state/canvasTokens'
import { withAlpha } from '../../state/canvasTokens'

/**
 * 批注高亮颜色 — 兼容旧常量 (Draw 仍 import 作 fallback) + 主题化函数。
 *
 * 保留导出 `COMMENT_HIGHLIGHT` 是因为:
 *   - Draw.drawCommentHighlightsForPage 仍是批注高亮唯一入口;
 *   - 当前 Draw 尚未注入 tokenSet, 故仍读旧常量;
 *   - 后续 Draw 改读 tokenSet 后, 本常量保留作为 fallback, 不破坏 ABI。
 */
export const COMMENT_HIGHLIGHT = 'rgba(255, 230, 100, 0.45)'

/** 淡底色 — 强调层关闭 / 已解决批注仍保留的「这里有批注」提示 (契约 §12.14) */
export const COMMENT_HIGHLIGHT_FAINT = 'rgba(255, 230, 100, 0.16)'

/** tokenSet → 批注高亮色 hex (alpha 0.45) */
export function commentHighlight(t: CanvasTokenSet | undefined): string {
  const v = t?.commentHighlight
  return v ? withAlpha(v, 0.45) : COMMENT_HIGHLIGHT
}

/** tokenSet → 淡底色 (alpha 0.16) */
export function commentHighlightFaint(t: CanvasTokenSet | undefined): string {
  const v = t?.commentHighlight
  return v ? withAlpha(v, 0.16) : COMMENT_HIGHLIGHT_FAINT
}

/** 选中态高亮 (alpha 0.62) — 面板选中某条批注时使用 */
export function commentHighlightActive(t: CanvasTokenSet | undefined): string {
  const v = t?.commentHighlight
  return v ? withAlpha(v, 0.62) : COMMENT_HIGHLIGHT
}

/**
 * 虚线批注框颜色 (契约 §12.14)。高亮 token 本身是浅黄, 直接做描边在纸上
 * 对比度不足; 框用更深的琥珀色, 与黄色气泡同一色系。
 */
export const COMMENT_BORDER = 'rgba(180, 83, 9, 0.9)'

export function commentBorder(_t: CanvasTokenSet | undefined): string {
  return COMMENT_BORDER
}

/**
 * 淡化的插入点标记色 (契约 §12.14)。点批注没有「文字底色」可留, 强调层
 * 关闭或已解决时若连标记也一起藏掉, 锚点就完全看不见了 —— 因此点标记
 * 始终绘制, 只降低不透明度。
 */
export const COMMENT_BORDER_FAINT = 'rgba(180, 83, 9, 0.45)'

export function commentBorderFaint(_t: CanvasTokenSet | undefined): string {
  return COMMENT_BORDER_FAINT
}
