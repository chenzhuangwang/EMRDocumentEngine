// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ErrorRecovery — 错误降级体系 (R54, v6.0)
//
// 三级容错: safeRenderParticle / safeRenderPage / safeLoadDocument
// 架构 §17.10, TASK-754
// ============================================================

import type { DocumentTree } from './document/core/DocumentModel'

// ---- 错误码 ----

export const EditorErrorCode = {
  E_RENDER_CONTEXT_LOST: 'E_RENDER_CONTEXT_LOST',
  E_DOCUMENT_CORRUPTED: 'E_DOCUMENT_CORRUPTED',
  E_LAYOUT_FAILED: 'E_LAYOUT_FAILED',
  E_PARTICLE_RENDER_FAILED: 'E_PARTICLE_RENDER_FAILED',
  E_IMAGE_LOAD_FAILED: 'E_IMAGE_LOAD_FAILED',
  E_UNKNOWN: 'E_UNKNOWN',
} as const

export type EditorErrorCode = (typeof EditorErrorCode)[keyof typeof EditorErrorCode]

export interface EditorError {
  code: EditorErrorCode
  message: string
  cause?: unknown
  context?: Record<string, unknown>
}

// ---- 错误报告 ----

export type ErrorReporter = (err: EditorError) => void

let globalReporter: ErrorReporter = (err) => {
  console.error(`[${err.code}] ${err.message}`, err.context || '', err.cause || '')
}

export function setErrorReporter(reporter: ErrorReporter): void {
  globalReporter = reporter
}

// ---- 三级容错 ----

/**
 * Level 1: 安全渲染粒子
 * 单个粒子渲染失败不影响其他粒子
 */
export function safeRenderParticle(
  renderFn: () => void,
  nodeId: string,
): boolean {
  try {
    renderFn()
    return true
  } catch (err) {
    globalReporter({
      code: EditorErrorCode.E_PARTICLE_RENDER_FAILED,
      message: `粒子渲染失败: nodeId=${nodeId}`,
      cause: err,
      context: { nodeId },
    })
    return false
  }
}

/**
 * Level 2: 安全渲染页面
 * 单页渲染失败 → 绘制错误提示占位页
 */
export function safeRenderPage(
  renderFn: () => void,
  pageIndex: number,
  ctx?: CanvasRenderingContext2D | null,
): boolean {
  try {
    renderFn()
    return true
  } catch (err) {
    globalReporter({
      code: EditorErrorCode.E_RENDER_CONTEXT_LOST,
      message: `页面渲染失败: pageIndex=${pageIndex}`,
      cause: err,
      context: { pageIndex },
    })

    // 绘制错误占位页
    if (ctx) {
      try {
        ctx.save()
        ctx.fillStyle = '#FEF2F2'
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
        ctx.fillStyle = '#DC2626'
        ctx.font = '14px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(`页面 ${pageIndex + 1} 渲染失败`, ctx.canvas.width / 2, ctx.canvas.height / 2)
        ctx.restore()
      } catch { /* 静默 */ }
    }
    return false
  }
}

/**
 * Level 3: 安全加载文档
 * 文档加载/解析失败 → 返回默认空文档 + 报告错误
 */
export function safeLoadDocument(
  parseFn: () => DocumentTree,
  fallbackTitle = '恢复的文档',
): { doc: DocumentTree; recovered: boolean } {
  try {
    return { doc: parseFn(), recovered: false }
  } catch (err) {
    globalReporter({
      code: EditorErrorCode.E_DOCUMENT_CORRUPTED,
      message: '文档加载失败，返回空文档',
      cause: err,
    })

    // 返回最小可用的空文档
    const fallbackDoc: DocumentTree = {
      type: 'document' as const,
      id: 'recovered_' + Date.now(),
      title: fallbackTitle,
      body: { mode: 'flow', children: [] },
      header: [],
      footer: [],
      pageSetup: {
        width: 794,
        height: 1123,
        marginTop: 72,
        marginBottom: 72,
        marginLeft: 90,
        marginRight: 90,
        orientation: 'portrait' as const,
      },
    }

    return { doc: fallbackDoc, recovered: true }
  }
}

/**
 * 错误边界工具: 异步任务容错
 * 失败返回 null 而不是抛异常
 */
export async function safeAsync<T>(
  task: () => Promise<T>,
  errorCode: EditorErrorCode = EditorErrorCode.E_UNKNOWN,
  message = '异步任务失败',
): Promise<T | null> {
  try {
    return await task()
  } catch (err) {
    globalReporter({ code: errorCode, message, cause: err })
    return null
  }
}
