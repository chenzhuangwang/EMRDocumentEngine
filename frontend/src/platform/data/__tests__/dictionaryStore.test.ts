// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// platform 码表目录/工厂 (契约 §12.6.4)
//
// 覆盖: 目录 → store 装载 / resolve 语义 (未知 = 不展开) /
//       id 形状约束 / 实例隔离 (§7.6) / numericValue 样例存在。
// ================================================================

import { describe, it, expect } from 'vitest'
import { createDictionaryStore } from '../dictionaryStore'
import {
  DICTIONARY_CATALOG, DICTIONARY_ID, dictionaryEntryById, dictionaryIds,
} from '../dictionaryCatalog'

describe('platform 码表目录 (契约 §12.6.4)', () => {
  it('createDictionaryStore 装入全部目录条目', () => {
    const store = createDictionaryStore()
    expect(store.size).toBe(DICTIONARY_CATALOG.length)
  })

  it('已知 id → 返回候选; 未知 id → undefined (未加载 = 退回自由文本)', () => {
    const store = createDictionaryStore()
    expect(store.resolve(DICTIONARY_ID.GENDER)?.map(o => o.name)).toEqual(
      ['男', '女', '未知的性别', '未说明的性别'],
    )
    expect(store.resolve('ffffffffffffffffffffffffffffffff')).toBeUndefined()
  })

  it('全部码表 id 为 32 位 hex 且互不重复', () => {
    const ids = dictionaryIds()
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/)
  })

  it('候选 value 在各自码表内唯一 (VR-9 严格成员校验的前提)', () => {
    for (const entry of DICTIONARY_CATALOG) {
      const values = entry.candidates.map(o => o.value)
      expect(new Set(values).size).toBe(values.length)
    }
  })

  it('每次调用返回独立实例 — 候选是实例级状态 (§7.6)', () => {
    const a = createDictionaryStore()
    const b = createDictionaryStore()
    expect(a).not.toBe(b)
    a.clear()
    expect(a.resolve(DICTIONARY_ID.GENDER)).toBeUndefined()
    expect(b.resolve(DICTIONARY_ID.GENDER)).toBeDefined()
  })

  it('疼痛分级条目为每个候选带 numericValue (layer E 只读派生)', () => {
    const entry = dictionaryEntryById(DICTIONARY_ID.PAIN_SCALE)
    expect(entry).toBeDefined()
    const opts = entry?.candidates ?? []
    expect(opts.length).toBeGreaterThan(0)
    expect(opts.every(o => typeof o.numericValue === 'number')).toBe(true)
  })

  it('dictionaryEntryById 未知 id → undefined', () => {
    expect(dictionaryEntryById('nope')).toBeUndefined()
  })
})
