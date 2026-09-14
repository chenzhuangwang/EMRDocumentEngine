// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ScriptResolver + CoordinateSystem 测试 (R89-R90)
// ============================================================

import { describe, it, expect } from 'vitest'
import { ScriptResolver, scriptResolver, DEFAULT_MULTILANG_CONFIG } from '../layout/text/ScriptResolver'
import { CoordinateSystem } from '../state/CoordinateSystem'

// ---- ScriptResolver ----

describe('ScriptResolver', () => {
  it('should detect Hans (Chinese) script', () => {
    const sr = new ScriptResolver(DEFAULT_MULTILANG_CONFIG)
    const script = sr.detectScript('中')
    expect(script).toBe('Hans')
  })

  it('should detect Latin script', () => {
    const sr = new ScriptResolver(DEFAULT_MULTILANG_CONFIG)
    expect(sr.detectScript('A')).toBe('Latin')
  })

  it('should detect Kana (Japanese) script', () => {
    const sr = new ScriptResolver(DEFAULT_MULTILANG_CONFIG)
    expect(sr.detectScript('あ')).toBe('Kana')
  })

  it('should detect Hangul (Korean) script', () => {
    const sr = new ScriptResolver(DEFAULT_MULTILANG_CONFIG)
    expect(sr.detectScript('한')).toBe('Hangul')
  })

  it('should resolve mixed script runs', () => {
    const runs = scriptResolver.resolveScriptRuns('Hello世界')
    expect(runs.length).toBeGreaterThanOrEqual(2)
  })

  it('should get dominant script by char count', () => {
    // '你好' (2 Hans) vs 'World' (5 Latin) → Latin wins
    expect(scriptResolver.getDominantScript('你好World')).toBe('Latin')
    // '你好世界' (4 Hans) vs 'Hi' (2 Latin) → Hans wins
    expect(scriptResolver.getDominantScript('你好世界Hi')).toBe('Hans')
  })
})

// ---- CoordinateSystem ----

describe('CoordinateSystem', () => {
  it('should initialize with default transform', () => {
    const cs = new CoordinateSystem(1)
    expect(cs.transform.scale).toBe(1)
  })

  it('should convert doc to canvas coordinates', () => {
    const cs = new CoordinateSystem(1)
    cs.update({ scale: 2 })
    const canvas = cs.docToCanvas(100, 50)
    expect(canvas.x).toBe(200)
    expect(canvas.y).toBe(100)
  })

  it('should convert screen to doc coordinates', () => {
    const cs = new CoordinateSystem(1)
    cs.update({ scale: 2, scrollY: 100 })
    const doc = cs.screenToDoc(400, 250)
    expect(doc.x).toBeCloseTo(200, 1)
  })

  it('should round-trip coordinates', () => {
    const cs = new CoordinateSystem(1)
    cs.update({ scale: 1.5 })
    const doc = { x: 300, y: 400 }
    const canvas = cs.docToCanvas(doc.x, doc.y)
    const back = cs.screenToDoc(canvas.x + cs.transform.canvasOffsetX, canvas.y)
    expect(back.x).toBeCloseTo(doc.x, 1)
  })
})
