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

/** tokenSet → 批注高亮色 hex (alpha 0.45) */
export function commentHighlight(t: CanvasTokenSet | undefined): string {
  const v = t?.commentHighlight
  return v ? withAlpha(v, 0.45) : COMMENT_HIGHLIGHT
}
