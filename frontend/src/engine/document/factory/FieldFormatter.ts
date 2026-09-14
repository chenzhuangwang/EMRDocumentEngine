// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// FieldFormatter — 域代码 → 显示文本 (纯函数, 契约 §12)
//
// 唯一实现: 渲染 (Draw) 与导出 (HTML/TXT) 共用同一份域解析语义,
// 避免第二份漂移实现。
//
// 纯净性: 不读全局时间/文档, 时间与文档事实由调用方经 ctx 注入
// (引擎不得依赖宿主环境, §1/§28)。
// ================================================================

import type { FieldType } from '../core/DocumentModel'

export interface FieldTextContext {
  /** 当前页页码 (1-based) — page_number 域 */
  pageNumber: number
  /** 文档总页数 — total_pages 域 */
  totalPages: number
  /** 文档标题 — document_title 域 */
  documentTitle?: string
  /** 当前用户 — author_name 域 */
  authorName?: string
  /** 时间基准 — 日期/时间类域 (由调用方注入, 保持本函数纯净) */
  now: Date
}

/**
 * 解析域代码显示文本。
 * 无 fieldType → 原样返回 fallbackText (普通文本项)。
 * 未知 fieldType → fallbackText, 否则 `[fieldType]`。
 */
export function resolveFieldText(
  fieldType: FieldType | string | undefined,
  fallbackText: string | undefined,
  ctx: FieldTextContext,
): string {
  if (!fieldType) return fallbackText || ''
  switch (fieldType) {
    case 'page_number': return String(ctx.pageNumber)
    case 'total_pages': return String(ctx.totalPages)
    case 'current_date': return ctx.now.toLocaleDateString('zh-CN')
    case 'current_time': return ctx.now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    case 'document_title': return ctx.documentTitle || ''
    case 'author_name': return ctx.authorName || 'user'
    case 'last_saved_date': return ctx.now.toLocaleDateString('zh-CN')
    case 'print_date': return ctx.now.toLocaleDateString('zh-CN')
    default: return fallbackText || `[${fieldType}]`
  }
}

/** 布局预留宽所需的上下文 (与页面/时间无关的估计) */
export interface FieldReserveContext {
  /**
   * 页数估计 — 决定 page_number / total_pages 预留的位数。
   * 调用方传上一轮布局的页数 (首轮传 1); 位数变化时调用方应重排一次。
   */
  totalPagesHint: number
  documentTitle?: string
  authorName?: string
}

/** 宽度样本: 固定日期, 仅用于量宽 (与 toLocaleDateString 走同一格式化路径) */
const SAMPLE_DATE = new Date(2026, 11, 28, 10, 30, 0)

/**
 * 域代码在**布局期**的代表性显示值 — 用于量宽。
 *
 * 为什么需要: 渲染期才逐页解析域值, 而布局只跑一次。若按占位符 ('[总页数]')
 * 量宽, 预留宽远大于实际绘制的 '3' → 域后面拖出一大片空白; 反之若按 0 宽,
 * 多位页码会与后续文字重叠。这里按域类型给出与解析结果**同形**的代表值,
 * 使一次布局的预留宽≈逐页绘制宽。
 *
 * 不得与 resolveFieldText 的形状漂移: 新增域类型必须同时在此给出代表值。
 */
export function representativeFieldText(
  fieldType: FieldType | string | undefined,
  fallbackText: string | undefined,
  ctx: FieldReserveContext,
): string {
  switch (fieldType) {
    case 'page_number':
    case 'total_pages': {
      // 位数按页数估计 (至少 1 位) — 3 页文档预留 '8', '1'/'3' 正好填满
      const digits = Math.min(4, Math.max(1, String(Math.max(1, Math.floor(ctx.totalPagesHint))).length))
      return '8'.repeat(digits)
    }
    case 'current_date':
    case 'last_saved_date':
    case 'print_date':
      // 用最大形状 (2 位月/日) 取样, 避免实际日期更长时与后续文字重叠
      return SAMPLE_DATE.toLocaleDateString('zh-CN')
    case 'current_time':
      return SAMPLE_DATE.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    case 'document_title':
      return ctx.documentTitle || ''
    case 'author_name':
      return ctx.authorName || 'user'
    // 未知类型保持占位符显示 (与 resolveFieldText 的 default 分支一致)
    default:
      return fallbackText || (fieldType ? `[${fieldType}]` : '')
  }
}
