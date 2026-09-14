// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// AutoSaveManager 域逻辑测试 (P6 — 持久化解耦到 StorageHost)
//
// 用内存版 StorageHost 桩驱动 AutoSaveManager, 验证与存储解耦后:
//   1. saveNow() 持久化快照 (documentId/title/tree 正确)
//   2. 保留策略: 写入 >3 条后 prune 只留最新 3 条
//   3. checkRecovery() 返回 savedAt 最新的一条
//   4. clearRecovery() 清空该文档全部快照
//   5. markDirty() 3s 防抖后触发保存
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { AutoSaveManager } from '../AutoSaveManager'
import type { StorageHost, SaveSnapshot } from '../host/EditorHost'
import type { DocumentTree } from '../document/core/DocumentModel'

/** 内存版 StorageHost — Map 存快照, list 按 documentId 过滤 */
class MemStorage implements StorageHost {
  private map = new Map<string, SaveSnapshot>()

  init(): Promise<void> { return Promise.resolve() }

  put(snapshot: SaveSnapshot): Promise<void> {
    this.map.set(snapshot.id, snapshot)
    return Promise.resolve()
  }

  list(documentId: string): Promise<SaveSnapshot[]> {
    return Promise.resolve([...this.map.values()].filter(s => s.documentId === documentId))
  }

  remove(ids: string[]): Promise<void> {
    for (const id of ids) this.map.delete(id)
    return Promise.resolve()
  }

  close(): void { this.map.clear() }
}

function makeManager() {
  const mem = new MemStorage()
  const manager = new AutoSaveManager(
    'doc-1',
    '测试文档',
    () => JSON.stringify({ id: 'doc-1', title: '测试文档', body: [], pageSetup: {} }),
    mem,
  )
  return { manager, mem }
}

function snap(id: string, savedAt: number): SaveSnapshot {
  return {
    id,
    documentId: 'doc-1',
    title: '测试文档',
    tree: { id: 'doc-1' } as unknown as DocumentTree,
    savedAt,
    version: 0,
  }
}

afterEach(() => { vi.useRealTimers() })

describe('AutoSaveManager', () => {
  it('saveNow() 持久化快照', async () => {
    const { manager, mem } = makeManager()
    await manager.init()

    await manager.saveNow()

    const all = await mem.list('doc-1')
    expect(all).toHaveLength(1)
    expect(all[0].documentId).toBe('doc-1')
    expect(all[0].title).toBe('测试文档')
    expect((all[0].tree as { id?: string }).id).toBe('doc-1')
    expect(manager.lastSavedAt).toBeGreaterThan(0)
  })

  it('保留策略: 写入 >3 条后只留最新 3 条', async () => {
    vi.useFakeTimers()
    const { manager, mem } = makeManager()
    await manager.init()

    for (let i = 0; i < 4; i++) {
      vi.setSystemTime(new Date(1000 + i * 1000))
      await manager.saveNow()
    }

    const all = await mem.list('doc-1')
    expect(all).toHaveLength(3)
    const times = all.map(s => s.savedAt).sort((a, b) => a - b)
    expect(times).toEqual([2000, 3000, 4000])
  })

  it('checkRecovery() 返回 savedAt 最新的一条', async () => {
    const { manager, mem } = makeManager()
    await manager.init()

    await mem.put(snap('doc-1_old', 1000))
    await mem.put(snap('doc-1_new', 3000))
    await mem.put(snap('doc-1_mid', 2000))

    const latest = await manager.checkRecovery()
    expect(latest).not.toBeNull()
    expect(latest!.id).toBe('doc-1_new')
  })

  it('clearRecovery() 清空该文档全部快照', async () => {
    const { manager, mem } = makeManager()
    await manager.init()

    await mem.put(snap('doc-1_a', 1000))
    await mem.put(snap('doc-1_b', 2000))

    await manager.clearRecovery()

    expect(await mem.list('doc-1')).toHaveLength(0)
  })

  it('markDirty() 3s 防抖后触发保存', async () => {
    vi.useFakeTimers()
    const { manager, mem } = makeManager()
    await manager.init()

    manager.markDirty()
    expect(await mem.list('doc-1')).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(3000)
    expect(await mem.list('doc-1')).toHaveLength(1)
  })
})
