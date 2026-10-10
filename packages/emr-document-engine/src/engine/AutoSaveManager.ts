// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// AutoSaveManager — 自动保存引擎 (R34, v6.0)
//
// 环形保留 3 版 + 防抖 3000ms
// 页面加载时检测残留数据 → 提示恢复
//
// 持久化经 StorageHost (PlatformHost.storage) 注入, 引擎不再触碰
// indexedDB / IDB* 类型 (契约 §28)。引擎只做域逻辑: 快照构造、防抖、
// 保留策略、恢复决策; 传输 (open/put/list/delete/close) 交平台。
// ============================================================

import type { StorageHost, SaveSnapshot } from './host/EditorHost'

const MAX_VERSIONS = 3
const DEBOUNCE_MS = 3000

export type SaveEventType = 'saving' | 'saved' | 'error'
export type SaveEventListener = (type: SaveEventType, error?: Error) => void

export class AutoSaveManager {
  private storage: StorageHost
  private ready = false
  private documentId: string
  private title: string
  private serialize: () => string
  private timer: ReturnType<typeof setTimeout> | null = null
  private listeners: SaveEventListener[] = []
  private _lastSavedAt = 0

  constructor(documentId: string, title: string, serialize: () => string, storage: StorageHost) {
    this.documentId = documentId
    this.title = title
    this.serialize = serialize
    this.storage = storage
  }

  // ---- 初始化 ----

  async init(): Promise<void> {
    await this.storage.init()
    this.ready = true
  }

  // ---- 防抖保存 ----

  /** 标记脏数据, 3s 后自动保存 */
  markDirty(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.save(), DEBOUNCE_MS)
  }

  /** 立即保存 (页面卸载/手动保存时调用) */
  async saveNow(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    await this.save()
  }

  private async save(): Promise<void> {
    if (!this.ready) return
    this.timer = null

    try {
      this.notify('saving')
      const snapshot: SaveSnapshot = {
        id: `${this.documentId}_${Date.now()}`,
        documentId: this.documentId,
        title: this.title,
        // 深克隆去环: serialize 已内嵌全部节点 payload (见 DocumentSerializer)
        tree: JSON.parse(this.serialize()),
        savedAt: Date.now(),
        version: 0,
      }

      await this.storage.put(snapshot)
      await this.pruneOldVersions()
      this._lastSavedAt = snapshot.savedAt
      this.notify('saved')
    } catch (err) {
      console.error('[AutoSave] 保存失败:', err)
      this.notify('error', err as Error)
    }
  }

  // ---- 恢复检测 ----

  /** 检查是否有未恢复的草稿 */
  async checkRecovery(): Promise<SaveSnapshot | null> {
    if (!this.ready) return null
    const snapshots = await this.storage.list(this.documentId)
    if (snapshots.length === 0) return null

    // 最近一次保存
    const latest = snapshots.reduce((a, b) => a.savedAt > b.savedAt ? a : b)
    return latest
  }

  /** 恢复草稿后清除记录 */
  async clearRecovery(): Promise<void> {
    if (!this.ready) return
    const snapshots = await this.storage.list(this.documentId)
    if (snapshots.length === 0) return
    await this.storage.remove(snapshots.map(s => s.id))
  }

  /** 上次成功保存的时间戳 */
  get lastSavedAt(): number { return this._lastSavedAt }

  // ---- 事件 ----

  onSave(cb: SaveEventListener): void { this.listeners.push(cb) }
  offSave(cb: SaveEventListener): void { this.listeners = this.listeners.filter(l => l !== cb) }

  private notify(type: SaveEventType, error?: Error): void {
    for (const cb of this.listeners) cb(type, error)
  }

  /** 销毁: 清理定时器, 关闭底层存储 */
  destroy(): void {
    if (this.timer) clearTimeout(this.timer)
    this.storage.close()
    this.ready = false
  }

  // ---- 保留策略 ----

  private async pruneOldVersions(): Promise<void> {
    const snapshots = await this.storage.list(this.documentId)
    if (snapshots.length <= MAX_VERSIONS) return
    // 按时间排序, 删最旧的
    snapshots.sort((a, b) => a.savedAt - b.savedAt)
    const toDelete = snapshots.slice(0, snapshots.length - MAX_VERSIONS)
    await this.storage.remove(toDelete.map(s => s.id))
  }
}
