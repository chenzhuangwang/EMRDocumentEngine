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
//
// locale 同理走 ctx 注入而非读 `locale` 单例 —— 日期/时间域的**格式**随界面
// 语言变 (zh-CN '2026/9/22' vs en-US '9/22/2026'), 它是"事实"的一部分。
// 缺省 'zh-CN' 保持既有行为 (既有测试不传 locale, 断言的是中文格式)。
// ================================================================

import type { FieldType } from '../core/DocumentModel'
import type { Locale } from '../../i18n/index'

/** 域文本缺省语言 —— 与引擎默认语言一致 (LocaleManager.current 初值) */
const DEFAULT_FIELD_LOCALE: Locale = 'zh-CN'

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
  /** 日期/时间域的格式语言 (由调用方注入; 缺省 zh-CN) */
  locale?: Locale
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
  const lc = ctx.locale ?? DEFAULT_FIELD_LOCALE
  switch (fieldType) {
    case 'page_number': return String(ctx.pageNumber)
    case 'total_pages': return String(ctx.totalPages)
    case 'current_date': return ctx.now.toLocaleDateString(lc)
    case 'current_time': return ctx.now.toLocaleTimeString(lc, { hour: '2-digit', minute: '2-digit' })
    case 'document_title': return ctx.documentTitle || ''
    case 'author_name': return ctx.authorName || 'user'
    case 'last_saved_date': return ctx.now.toLocaleDateString(lc)
    case 'print_date': return ctx.now.toLocaleDateString(lc)
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
  /**
   * 日期/时间域的格式语言 —— **必须与渲染期 resolveFieldText 的 ctx.locale 同源**,
   * 否则量宽与绘制宽会漂移 (en-US 的 '9/22/2026' 比 zh-CN 的 '2026/9/22' 窄,
   * 用中文样本量宽会在域后拖出空白)。缺省 zh-CN。
   */
  locale?: Locale
}

/** 宽度样本: 固定日期, 仅用于量宽 (与 toLocaleDateString 走同一格式化路径) */
const SAMPLE_DATE = new Date(2026, 11, 28, 10, 30, 0)

/**
 * 页码/总页数域的预留位数 (1–4) — 唯一实现。
 *
 * `representativeFieldText` 用它决定样本串 ('8' / '88' / …), 布局的段落行
 * 缓存键与页眉页脚签名也用它 —— 位数变化会改预留宽, 键里必须出现同一口径的
 * 分段, 否则增量布局会静默复用旧行 (契约 §16.1)。
 */
export function fieldReserveDigits(totalPagesHint: number): number {
  return Math.min(4, Math.max(1, String(Math.max(1, Math.floor(totalPagesHint))).length))
}

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
  const lc = ctx.locale ?? DEFAULT_FIELD_LOCALE
  switch (fieldType) {
    case 'page_number':
    case 'total_pages': {
      // 位数按页数估计 (至少 1 位) — 3 页文档预留 '8', '1'/'3' 正好填满
      const digits = fieldReserveDigits(ctx.totalPagesHint)
      return '8'.repeat(digits)
    }
    case 'current_date':
    case 'last_saved_date':
    case 'print_date':
      // 用最大形状 (2 位月/日) 取样, 避免实际日期更长时与后续文字重叠
      return SAMPLE_DATE.toLocaleDateString(lc)
    case 'current_time':
      return SAMPLE_DATE.toLocaleTimeString(lc, { hour: '2-digit', minute: '2-digit' })
    case 'document_title':
      return ctx.documentTitle || ''
    case 'author_name':
      return ctx.authorName || 'user'
    // 未知类型保持占位符显示 (与 resolveFieldText 的 default 分支一致)
    default:
      return fallbackText || (fieldType ? `[${fieldType}]` : '')
  }
}
