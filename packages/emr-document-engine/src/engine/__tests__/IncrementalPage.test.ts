// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

import { describe, it, expect } from 'vitest'
import { IncrementalLayout } from '../layout/incremental/IncrementalLayout'
import { PageStartTable } from '../layout/page/PageStartTable'

// ---- IncrementalLayout ----

describe('IncrementalLayout', () => {
  it('should invalidate cached paragraph', () => {
    const il = new IncrementalLayout()
    il.set('p1', { paragraphId: 'p1', lines: [], totalHeight: 0 })
    il.invalidate('p1')
    expect(il.get('p1')).toBeUndefined()
  })

  it('should invalidate all', () => {
    const il = new IncrementalLayout()
    il.set('a', { paragraphId: 'a', lines: [], totalHeight: 0 })
    il.set('b', { paragraphId: 'b', lines: [], totalHeight: 0 })
    il.invalidateAll()
    expect(il.size).toBe(0)
  })
})

// ---- PageStartTable ----

describe('PageStartTable', () => {
  it('should rebuild and query pages', () => {
    const t = new PageStartTable()
    t.rebuild([{ id: 'p1', pageIndex: 0 }, { id: 'p2', pageIndex: 0 }, { id: 'p3', pageIndex: 1 }])
    expect(t.getPage('p1')).toBe(0)
    expect(t.getPage('p3')).toBe(1)
  })

  it('should find first paragraph on page via binary search', () => {
    const t = new PageStartTable()
    t.rebuild([{ id: 'p1', pageIndex: 0 }, { id: 'p2', pageIndex: 1 }, { id: 'p3', pageIndex: 2 }])
    expect(t.findFirstParagraphOnPage(1)).toBe('p2')
    expect(t.findFirstParagraphOnPage(0)).toBe('p1')
  })

  it('should return -1 for unknown paragraph', () => {
    const t = new PageStartTable()
    expect(t.getPage('unknown')).toBe(-1)
  })

  it('should shift pages from a given paragraph', () => {
    const t = new PageStartTable()
    t.rebuild([{ id: 'a', pageIndex: 0 }, { id: 'b', pageIndex: 1 }, { id: 'c', pageIndex: 2 }])
    t.shiftFrom('b', 1) // b and c shift +1
    expect(t.getPage('a')).toBe(0)
    expect(t.getPage('b')).toBe(2)
    expect(t.getPage('c')).toBe(3)
  })
})
