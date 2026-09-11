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
