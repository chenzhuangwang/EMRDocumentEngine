// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// PrintHistoryService — 打印历史记录 (TASK-469, v7.0)
//
// localStorage 存储最近 20 条打印记录
// 支持断点恢复: 记录打印时间和页码范围
// ============================================================

const STORAGE_KEY = 'emr-print-history'
const MAX_ENTRIES = 20

// ---- 类型 ----

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

// ---- 服务 ----

export class PrintHistoryService {
  /** 获取所有打印记录 */
  getHistory(): PrintRecord[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  }

  /** 添加打印记录 */
  addRecord(record: PrintRecord): void {
    const history = this.getHistory()
    history.unshift(record)
    if (history.length > MAX_ENTRIES) history.length = MAX_ENTRIES
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
  }

  /** 更新记录状态 (打印完成/续打断点) */
  updateRecord(id: string, patch: Partial<PrintRecord>): void {
    const history = this.getHistory()
    const idx = history.findIndex(r => r.id === id)
    if (idx >= 0) {
      history[idx] = { ...history[idx], ...patch }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
    }
  }

  /** 获取指定文档的最近打印记录 */
  getByDocument(documentId: string): PrintRecord[] {
    return this.getHistory().filter(r => r.documentId === documentId)
  }

  /** 查找未完成的打印 (续打断点) */
  findIncomplete(): PrintRecord | null {
    return this.getHistory().find(r => !r.completed) || null
  }

  /** 查找续打断点 */
  findResumePoint(documentId: string): PrintRecord | null {
    return this.getHistory().find(
      r => r.documentId === documentId && !r.completed,
    ) || null
  }

  /** 清除所有历史 */
  clear(): void {
    localStorage.removeItem(STORAGE_KEY)
  }
}

/** 全局单例 */
export const printHistory = new PrintHistoryService()
