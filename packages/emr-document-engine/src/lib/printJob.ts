// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// printJob — 打印任务的范围解析与历史记录构造 (纯函数)
//
// 抽出来的理由: EditorPage 是页面组件, 测试要拉起整个编辑器; 而这里的规则
// (范围钳制、completed 判定) 恰恰是最容易出错、也最该被钉死的部分。
//
// `completed` 的语义值得写清楚: 它不是"浏览器有没有弹完打印窗口"(那个 JS
// 拿不到可靠信号), 而是**这一轮是否打到了文档末页**。没打到就是"未打完",
// 于是 PrintHistoryService.findResumePoint 能据此给出续打断点 —— 这正是
// 那个服务设计时想要的数据, 只是此前没有任何地方产生它。
// ============================================================

/**
 * 一次打印任务的记录形状 —— **权威定义在这里**, 不在 services/PrintHistoryService.ts。
 *
 * 理由 (契约 §32.1): 本文件随 ./export 入口分发, 而 PrintHistoryService 是应用侧
 * 的 localStorage 服务, 不进分包。类型若定义在 service 侧, 分包就反向依赖应用
 * 服务层, 分发出去的 .d.ts 会留下外部项目解析不了的说明符。
 *
 * PrintRecord 描述的是"一次打印任务是什么", 与"记录存到哪里"(localStorage /
 * IndexedDB / 后端) 是两件事。service 侧改为从本文件 import 并 re-export, 既有
 * 经服务模块引用 PrintRecord 的引用点不破。
 */
export interface PrintRecord {
  id: string
  documentId: string
  documentTitle: string
  /** 打印时间戳 */
  printedAt: number
  /** 页码范围 */
  pageRange: { start: number; end: number }
  /** 打印份数 */
  copies: number
  /** 是否双面打印 */
  duplex: boolean
  /** 是否完成 */
  completed: boolean
  /** 续打断点: 未完成时记录最后成功打印的页码 */
  lastCompletedPage?: number
}

/**
 * 文档在打印历史里的键。
 *
 * **写入与查询必须走同一个函数** —— 未保存文档的 `docId` 是 `undefined`,
 * 若写入时兜底成 `'unsaved'` 而查询时直接传 `undefined`, 两者永远匹配不上,
 * 未保存文档的续打断点会静默失效 (实测踩到过)。
 */
export function printDocKey(documentId?: string): string {
  return documentId ?? 'unsaved'
}

export interface PrintRange {
  start: number
  end: number
}

/**
 * 把用户在对话框里填的范围钳到 `[1, totalPages]`。
 *
 * 用户可以在数字框里填 0、-3 或 999 —— 钳制而不是信任输入, 否则切片会静默
 * 变成空数组 (打印窗口拿到空图列 = 什么都不打, 也没有报错)。
 */
export function resolvePrintRange(requested: PrintRange, totalPages: number): PrintRange {
  if (totalPages <= 0) return { start: 1, end: 0 }
  const start = Math.max(1, Math.min(Math.trunc(requested.start) || 1, totalPages))
  const end = Math.max(start, Math.min(Math.trunc(requested.end) || totalPages, totalPages))
  return { start, end }
}

/** 按范围取出要打印的页 (1-based, 含两端) */
export function selectPrintPages<T>(pages: readonly T[], range: PrintRange): T[] {
  return pages.slice(range.start - 1, range.end)
}

/** 这一轮是否打到了文档末页 —— 决定它是"完成"还是留下一枚续打断点 */
export function isPrintFinished(range: PrintRange, totalPages: number): boolean {
  return totalPages > 0 && range.end >= totalPages
}

export interface PrintJobContext {
  documentId?: string
  documentTitle: string
  settings: { copies: number; duplex: boolean }
  range: PrintRange
  totalPages: number
  /** 便于测试注入; 生产不传 */
  now?: number
  id?: string
}

/** 构造一条打印历史记录 */
export function buildPrintRecord(ctx: PrintJobContext): PrintRecord {
  const finished = isPrintFinished(ctx.range, ctx.totalPages)
  const now = ctx.now ?? Date.now()
  return {
    id: ctx.id ?? `print_${now}`,
    documentId: printDocKey(ctx.documentId),
    documentTitle: ctx.documentTitle,
    printedAt: now,
    pageRange: { ...ctx.range },
    copies: ctx.settings.copies,
    duplex: ctx.settings.duplex,
    completed: finished,
    // 只有没打完才写断点 —— 打完还留断点会让下次打开误报"续打"
    ...(finished ? {} : { lastCompletedPage: ctx.range.end }),
  }
}
