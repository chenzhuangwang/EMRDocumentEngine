// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// AutoCorrectEngine 单元测试 (R71)
// ============================================================

import { describe, it, expect } from 'vitest'
import { AutoCorrectEngine } from '../AutoCorrectEngine'

describe('AutoCorrectEngine', () => {
  it('should replace i.v.g.t.t. with 静脉滴注', () => {
    const engine = new AutoCorrectEngine()
    const result = engine.check('i.v.g.t.t.')
    expect(result.changed).toBe(true)
    expect(result.corrected).toBe('静脉滴注')
  })

  it('should replace i.m. with 肌肉注射', () => {
    const engine = new AutoCorrectEngine()
    const result = engine.check('i.m.')
    expect(result.changed).toBe(true)
    expect(result.corrected).toBe('肌肉注射')
  })

  it('should replace b.i.d. with 每日2次', () => {
    const engine = new AutoCorrectEngine()
    const result = engine.check('b.i.d.')
    expect(result.corrected).toBe('每日2次')
  })

  it('should replace Bp with 血压 (case sensitive)', () => {
    const engine = new AutoCorrectEngine()
    const result = engine.check('Bp')
    expect(result.changed).toBe(true)
    expect(result.corrected).toBe('血压')
  })

  it('should not replace bp (lowercase, case sensitive rule)', () => {
    const engine = new AutoCorrectEngine()
    const result = engine.check('bp')
    expect(result.changed).toBe(false)
    expect(result.corrected).toBe('bp')
  })

  it('should detect match at cursor position', () => {
    const engine = new AutoCorrectEngine()
    const fullText = '患者 i.v.g.t.t. 治疗'
    // cursor right after "i.v.g.t.t." (before space)
    const cursor = fullText.indexOf('i.v.g.t.t.') + 'i.v.g.t.t.'.length
    const result = engine.checkAtCursor(fullText, cursor)
    expect(result).not.toBeNull()
    expect(result!.replacement).toBe('静脉滴注')
  })

  it('should return null when no match at cursor', () => {
    const engine = new AutoCorrectEngine()
    const result = engine.checkAtCursor('普通文本没有匹配', 8)
    expect(result).toBeNull()
  })

  it('should handle empty text', () => {
    const engine = new AutoCorrectEngine()
    const result = engine.check('')
    expect(result.changed).toBe(false)
  })
})
