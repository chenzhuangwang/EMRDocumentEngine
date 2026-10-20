// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// TextMeasurer — 缓存/缺字检测记忆化 (性能回归)
// ============================================================
//
// 大文档首次布局曾是超线性 (2000 段 1265ms vs 1000 段 346ms), 根因:
//   1. LRU 用并行数组 + filter 维护, 每次命中 O(缓存条数);
//   2. measureWidth 每次调用都逐字符跑缺字检测, 不记忆化。
// 这里用可控 host 直接观测调用次数, 把两条性质钉死。

import { describe, it, expect } from 'vitest'
import { TextMeasurer } from '../layout/text/TextMeasurer'
import { FontManager } from '../layout/text/FontManager'
import { DEFAULT_FONT_METRICS } from '../layout/text/FontMetrics'
import type { EditorHost, TextMeasurement } from '../host/EditorHost'

interface Stub {
  host: EditorHost
  measureCalls: () => number
  measuredFonts: () => string[]
  glyphChecks: () => number
}

/**
 * 可控 host。
 * - measure 宽度 = 字符数 × (降级字体 20, 主字体 10), 便于断言命中了哪个字体;
 * - isGlyphAvailable 由 available 决定, 并计数 —— 缺字检测是否被重跑看这个。
 */
function makeHost(available: (family: string, char: string) => boolean): Stub {
  let measureCalls = 0
  let glyphChecks = 0
  const measuredFonts: string[] = []
  const host = {
    text: {
      measure(text: string, font: string): TextMeasurement {
        measureCalls++
        measuredFonts.push(font)
        const isFallback = font.includes('Microsoft YaHei')
        return { width: [...text].length * (isFallback ? 20 : 10), height: 16 }
      },
      getFontMetrics: () => DEFAULT_FONT_METRICS,
    },
    font: {
      isGlyphAvailable(family: string, char: string): boolean {
        glyphChecks++
        return available(family, char)
      },
    },
  } as unknown as EditorHost
  return {
    host,
    measureCalls: () => measureCalls,
    measuredFonts: () => measuredFonts,
    glyphChecks: () => glyphChecks,
  }
}

function makeMeasurer(stub: Stub): TextMeasurer {
  return new TextMeasurer(stub.host, new FontManager(stub.host))
}

describe('TextMeasurer 缓存', () => {
  it('measure 对同一 (text, config) 只测一次', () => {
    const stub = makeHost(() => true)
    const m = makeMeasurer(stub)
    const a = m.measure('患者发热', { font: 'SimSun', size: 16 })
    const b = m.measure('患者发热', { font: 'SimSun', size: 16 })
    expect(stub.measureCalls()).toBe(1)
    expect(b).toBe(a)
  })

  it('不同 config 分开缓存', () => {
    const stub = makeHost(() => true)
    const m = makeMeasurer(stub)
    m.measure('患者', { font: 'SimSun', size: 16 })
    m.measure('患者', { font: 'SimSun', size: 18 })
    m.measure('患者', { font: 'SimSun', size: 16, bold: true })
    expect(stub.measureCalls()).toBe(3)
    expect(m.getCacheSize()).toBe(3)
  })

  it('LRU: 命中移到 MRU, 超限淘汰最久未用', () => {
    const stub = makeHost(() => true)
    const m = makeMeasurer(stub)
    const max = (TextMeasurer as unknown as { MAX_CACHE_SIZE: number }).MAX_CACHE_SIZE
    const cfg = { font: 'SimSun', size: 16 }

    for (let i = 0; i < max; i++) m.measure(`t${i}`, cfg)
    expect(m.getCacheSize()).toBe(max)

    // 访问 t0 → 变成 MRU; 再插入一条应淘汰 t1 而不是 t0
    m.measure('t0', cfg)
    m.measure('overflow', cfg)
    expect(m.getCacheSize()).toBe(max)

    const before = stub.measureCalls()
    m.measure('t0', cfg)      // 仍在缓存
    expect(stub.measureCalls()).toBe(before)
    m.measure('t1', cfg)      // 已被淘汰 → 重新测量
    expect(stub.measureCalls()).toBe(before + 1)
  })
})

describe('TextMeasurer 缺字检测', () => {
  const cfg = { font: 'SimSun', size: 16 }

  it('measureWidth 对同一文本只检测一次', () => {
    const stub = makeHost(() => true)
    const m = makeMeasurer(stub)
    m.measureWidth('患者发热', cfg)
    const checks = stub.glyphChecks()
    expect(checks).toBeGreaterThan(0)

    m.measureWidth('患者发热', cfg)
    m.measureWidth('患者发热', cfg)
    expect(stub.glyphChecks()).toBe(checks)
  })

  it('缺字时降级到 fallback 字体, 且结论被记忆化', () => {
    // 主字体缺 𠀀, 只有 Microsoft YaHei 支持
    const stub = makeHost((family, char) => char !== '𠀀' || family === 'Microsoft YaHei')
    const m = makeMeasurer(stub)

    const w1 = m.measureWidth('𠀀', cfg)
    expect(w1).toBe(20) // 走了降级字体的宽度
    expect(stub.measuredFonts().some(f => f.includes('Microsoft YaHei'))).toBe(true)

    const checks = stub.glyphChecks()
    const calls = stub.measureCalls()
    const w2 = m.measureWidth('𠀀', cfg)
    expect(w2).toBe(w1)
    expect(stub.glyphChecks()).toBe(checks) // 记忆化: 不重跑检测
    expect(stub.measureCalls()).toBe(calls) // 宽度也命中测量缓存
  })

  it('clearCache 同时清空测量缓存与检测结论', () => {
    const stub = makeHost(() => true)
    const m = makeMeasurer(stub)
    m.measureWidth('患者', cfg)
    const checks = stub.glyphChecks()
    const calls = stub.measureCalls()

    m.clearCache()
    expect(m.getCacheSize()).toBe(0)

    m.measureWidth('患者', cfg)
    expect(stub.glyphChecks()).toBeGreaterThan(checks)
    expect(stub.measureCalls()).toBe(calls + 1)
  })
})
