// ============================================================
// AutoSaveManager — 自动保存引擎 (R34, v6.0)
//
// IndexedDB 环形保留 3 版 + 防抖 3000ms
// 页面加载时检测 IndexedDB 残留数据 → 提示恢复
// ============================================================

import type { DocumentTree } from './document/DocumentModel'

const DB_NAME = 'emr-editor-autosave'
const STORE_NAME = 'snapshots'
const DB_VERSION = 1
const MAX_VERSIONS = 3
const DEBOUNCE_MS = 3000

interface SaveSnapshot {
  id: string
  documentId: string
  title: string
  tree: DocumentTree
  savedAt: number
  version: number
}

export type SaveEventType = 'saving' | 'saved' | 'error'
export type SaveEventListener = (type: SaveEventType, error?: Error) => void

export class AutoSaveManager {
  private db: IDBDatabase | null = null
  private documentId: string
  private title: string
  private serialize: () => string
  private timer: ReturnType<typeof setTimeout> | null = null
  private listeners: SaveEventListener[] = []
  private _lastSavedAt = 0

  constructor(documentId: string, title: string, serialize: () => string) {
    this.documentId = documentId
    this.title = title
    this.serialize = serialize
  }

  // ---- 初始化 ----

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex('documentId', 'documentId', { unique: false })
          store.createIndex('savedAt', 'savedAt', { unique: false })
        }
      }
      req.onsuccess = () => { this.db = req.result; resolve() }
      req.onerror = () => reject(req.error)
    })
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
    if (!this.db) return
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

      await this.putSnapshot(snapshot)
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
    if (!this.db) return null
    const snapshots = await this.getSnapshots(this.documentId)
    if (snapshots.length === 0) return null

    // 最近一次保存
    const latest = snapshots.reduce((a, b) => a.savedAt > b.savedAt ? a : b)
    return latest
  }

  /** 恢复草稿后清除 IndexedDB 记录 */
  async clearRecovery(): Promise<void> {
    if (!this.db) return
    const snapshots = await this.getSnapshots(this.documentId)
    const tx = this.db.transaction(STORE_NAME, 'readwrite')
    for (const s of snapshots) tx.objectStore(STORE_NAME).delete(s.id)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  /** 上次成功保存的时间戳 */
  get lastSavedAt(): number { return this._lastSavedAt }

  // ---- 事件 ----

  onSave(cb: SaveEventListener): void { this.listeners.push(cb) }
  offSave(cb: SaveEventListener): void { this.listeners = this.listeners.filter(l => l !== cb) }

  private notify(type: SaveEventType, error?: Error): void {
    for (const cb of this.listeners) cb(type, error)
  }

  /** 销毁: 清理定时器, 关闭 DB */
  destroy(): void {
    if (this.timer) clearTimeout(this.timer)
    this.db?.close()
    this.db = null
  }

  // ---- IndexedDB 操作 ----

  private putSnapshot(snapshot: SaveSnapshot): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(snapshot)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  private getSnapshots(documentId: string): Promise<SaveSnapshot[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly')
      const idx = tx.objectStore(STORE_NAME).index('documentId')
      const req = idx.getAll(documentId)
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
  }

  private async pruneOldVersions(): Promise<void> {
    const snapshots = await this.getSnapshots(this.documentId)
    if (snapshots.length <= MAX_VERSIONS) return
    // 按时间排序, 删最旧的
    snapshots.sort((a, b) => a.savedAt - b.savedAt)
    const toDelete = snapshots.slice(0, snapshots.length - MAX_VERSIONS)
    const tx = this.db!.transaction(STORE_NAME, 'readwrite')
    for (const s of toDelete) tx.objectStore(STORE_NAME).delete(s.id)
    await new Promise<void>((resolve) => { tx.oncomplete = () => resolve() })
  }
}
