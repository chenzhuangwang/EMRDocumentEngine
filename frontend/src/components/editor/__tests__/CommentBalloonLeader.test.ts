// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 批注气泡引线与堆叠 (契约 §12.14)
//
// 画布虚线到页缘就断了, 气泡由 DOM 叠加层画在页外。引线取「页缘端点 →
// 气泡左缘」的直接斜线 (参考实现的形态); 气泡按实测高度紧凑堆叠, 不再用
// 固定占位把短气泡拉开。
// ================================================================

import { describe, it, expect } from 'vitest'
import { balloonLeaderPoints, stackBalloonTops } from '../CommentBalloonOverlay'
import type { CommentClientRect } from '@emrde/document-engine'

function rect(overrides: Partial<CommentClientRect> = {}): CommentClientRect {
  return {
    pageIndex: 0,
    left: 100,
    top: 200,
    width: 40,
    height: 16,
    pageRight: 1000,
    contentRight: 940,
    ...overrides,
  }
}

describe('balloonLeaderPoints', () => {
  it('页缘端点 → 气泡左缘的直接斜线 (两点, 不走竖直通道)', () => {
    expect(balloonLeaderPoints(rect(), 1018, 205)).toBe('1000,206 1018,227')
  })

  it('起点与画布虚线终点重合 (pageRight, top+6)', () => {
    const points = balloonLeaderPoints(rect({ top: 300 }), 1018, 320)
    expect(points.startsWith('1000,306 ')).toBe(true)
    expect(points.endsWith(' 1018,342')).toBe(true)
  })

  it('视口过窄气泡被夹到页内时同样是直接连线', () => {
    expect(balloonLeaderPoints(rect(), 995, 205)).toBe('1000,206 995,227')
  })

  it('同锚点的两条气泡各自有独立终点', () => {
    const a = balloonLeaderPoints(rect(), 1018, 205)
    const b = balloonLeaderPoints(rect(), 1018, 305)
    expect(a).toBe('1000,206 1018,227')
    expect(b).toBe('1000,206 1018,327')
  })
})

describe('stackBalloonTops', () => {
  it('同一期望位置按实测高度紧凑堆叠 (间隔 4px)', () => {
    expect(stackBalloonTops([
      { top: 205, height: 56 },
      { top: 205, height: 56 },
    ])).toEqual([205, 265])
  })

  it('锚点本身离得远时不下拉 (保持贴着自己的行)', () => {
    expect(stackBalloonTops([
      { top: 100, height: 56 },
      { top: 300, height: 56 },
    ])).toEqual([100, 300])
  })

  it('只在下一条会盖住上一条时下推', () => {
    expect(stackBalloonTops([
      { top: 100, height: 56 },
      { top: 140, height: 56 },
      { top: 250, height: 56 },
    ])).toEqual([100, 160, 250])
  })
})
