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
//
// 采用度 (2026-09 接线审计后):
//   Level 1 safeRenderParticle — 已接 (Draw 正文/图片/打印逐项)
//   Level 2 safeRenderPage     — 已接 (Draw 逐页 + 打印离屏)
//   Level 3 safeLoadDocument   — 已接 (Editor.setDocument 的唯一入口)
//   setErrorReporter           — 已接 (main.tsx 装到 store → StatusBar 可见)
// ============================================================

/** 单页占位图的绘制范围 (与调用时 ctx 的 transform 同一坐标空间) */
export interface PageRect {
  x: number
  y: number
  width: number
  height: number
}

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

/**
 * 主动上报一条错误 (走同一个 reporter)。
 *
 * 给"引擎之外但同属一条链"的调用方用 —— 例如 UI 层导入文件时的解析失败:
 * 它发生在 Editor.setDocument 之前, 兜不到 Level 3, 但用户同样需要一个说法,
 * 而不是"点了导入什么也没发生"。集中在这里也免得各处再写 console 分支。
 */
export function reportError(err: EditorError): void {
  globalReporter(err)
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
 *
 * `rect` 是这一页在**当前 ctx transform 空间**里的矩形。
 * - 不给 (离屏单页渲染, 如打印): 整张 canvas 就是这一页, 占满整张是对的。
 * - 给了 (屏幕多页画布): **必须**只覆盖该页那一块。否则一页出错会把整屏
 *   刷成红底, 那是比不接容错更糟的回归。
 */
export function safeRenderPage(
  renderFn: () => void,
  pageIndex: number,
  ctx?: CanvasRenderingContext2D | null,
  rect?: PageRect,
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
        const box = rect
          ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
          : { x: 0, y: 0, w: ctx.canvas.width, h: ctx.canvas.height }
        ctx.save()
        ctx.fillStyle = '#FEF2F2'
        ctx.fillRect(box.x, box.y, box.w, box.h)
        ctx.fillStyle = '#DC2626'
        ctx.font = '14px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(`页面 ${pageIndex + 1} 渲染失败`, box.x + box.w / 2, box.y + box.h / 2)
        ctx.restore()
      } catch { /* 静默 */ }
    }
    return false
  }
}

/**
 * Level 3: 安全加载文档
 *
 * 加载/解析失败 → 用调用方给的**回落值**顶上 + 报告错误。
 *
 * 为什么不在这里自己造一个"最小空文档": 那等于把 DocumentModel 的默认值
 * (pageSetup 尺寸/页边距/body 形状…) 抄第二份 —— 模型改了它不会跟着改, 是
 * 一个必然漂移的第二事实源。落回什么由调用方定义, 只借这里的 try/report。
 */
export function safeLoadDocument<T>(
  loadFn: () => T,
  recover: () => T,
  message = '文档加载失败, 已回退到空白文档',
): { value: T; recovered: boolean } {
  try {
    return { value: loadFn(), recovered: false }
  } catch (err) {
    globalReporter({
      code: EditorErrorCode.E_DOCUMENT_CORRUPTED,
      message,
      cause: err,
    })
    try {
      return { value: recover(), recovered: true }
    } catch (recoverErr) {
      // 回落本身也失败。**不能默默把两个错误都吞掉**: 那会让"容错"变成
      // "什么都失败且没人知道"。先把回落失败单独报出去, 再抛原始错误 (根因)。
      globalReporter({
        code: EditorErrorCode.E_DOCUMENT_CORRUPTED,
        message: '回落文档同样加载失败',
        cause: recoverErr,
      })
      throw err
    }
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
