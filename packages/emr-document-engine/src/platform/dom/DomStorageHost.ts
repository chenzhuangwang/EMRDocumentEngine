// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// DomStorageHost — IndexedDB 持久化宿主实现 (契约 §27.1)
//
// 自动保存快照的 IndexedDB 传输层。engine 经 StorageHost 注入语义化
// 能力, 不触碰 indexedDB / IDB* 类型 (契约 §28)。
//
// 依赖方向: platform/dom → engine/host (单向, 契约 §27)
// ============================================================

import type { StorageHost, SaveSnapshot } from '../../engine/host/EditorHost'

const DB_NAME = 'emr-editor-autosave'
const STORE_NAME = 'snapshots'
const DB_VERSION = 1

export class DomIndexedDBStorage implements StorageHost {
  private db: IDBDatabase | null = null

  /** 打开/建库 (建 store + documentId/savedAt 索引), 就绪后 resolve */
  init(): Promise<void> {
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

  put(snapshot: SaveSnapshot): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(snapshot)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  list(documentId: string): Promise<SaveSnapshot[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly')
      const idx = tx.objectStore(STORE_NAME).index('documentId')
      const req = idx.getAll(documentId)
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
  }

  remove(ids: string[]): Promise<void> {
    if (ids.length === 0) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite')
      for (const id of ids) tx.objectStore(STORE_NAME).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  close(): void {
    this.db?.close()
    this.db = null
  }
}
