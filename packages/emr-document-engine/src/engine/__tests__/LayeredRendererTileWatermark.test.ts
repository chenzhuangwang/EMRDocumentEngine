// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// 平铺水印「页锚定」几何闸门
//
// 历史缺陷: tile 分支直接 `ctx.fillRect(0, pageY, w, h)` —— 画布被
// fixCanvasScrollOffset 用 `style.top = scrollTop` 钉在视口顶部, 静态层
// setTransform 里也不含滚动偏移, 于是图块网格的原点落在**视口原点**而非
// **页面原点**: 滚动时页面滑走、水印留在原地 (观感 = 水印跟着滚动)。
// text/image 水印与四角标记都是页锚定的, 只有 tile 漏了。
//
// setup.ts 的 mock ctx 全是 no-op, 画什么都看不出来 —— 所以这里用一个
// **记录调用序列**的假 ctx 直接把几何钉住: translate(0, pageY) 必须先于
// fillRect(0, 0, w, h)。想改成别锚定方式, 先改这条。
// ============================================================

import { describe, it, expect } from 'vitest'
import { fillTileWatermark } from '../render/LayeredRenderer'

/**
 * 记录调用序列的假 ctx。真实 CanvasPattern 在 jsdom 里造不出来 (mock 返回 {}),
 * 但本函数对 pattern 只做透传 (赋给 fillStyle), 不读它的任何属性 ——
 * 故传一个占位对象即可。
 */
function recordingCtx() {
  const calls: Array<{ op: string; args: number[] }> = []
  const ctx = {
    save: () => { calls.push({ op: 'save', args: [] }) },
    restore: () => { calls.push({ op: 'restore', args: [] }) },
    translate: (x: number, y: number) => { calls.push({ op: 'translate', args: [x, y] }) },
    fillRect: (x: number, y: number, w: number, h: number) => { calls.push({ op: 'fillRect', args: [x, y, w, h] }) },
    _fillStyle: '' as unknown,
    get fillStyle() { return this._fillStyle },
    set fillStyle(v: unknown) { this._fillStyle = v; calls.push({ op: 'fillStyle', args: [] }) },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, raw: ctx }
}

const PATTERN = {} as CanvasPattern

describe('fillTileWatermark — 图块原点锚在页面而非视口', () => {
  it('pattern 先绑到 fillStyle, 再按页内坐标填充', () => {
    const { ctx, calls } = recordingCtx()
    fillTileWatermark(ctx, PATTERN, 200, 794, 1123)

    const ops = calls.map((c) => c.op)
    expect(ops).toEqual(['save', 'translate', 'fillStyle', 'fillRect', 'restore'])
  })

  it('translate 的 Y 分量 = pageY (把网格原点搬到页面原点)', () => {
    const { ctx, calls } = recordingCtx()
    fillTileWatermark(ctx, PATTERN, 200, 794, 1123)

    expect(calls.find((c) => c.op === 'translate')!.args).toEqual([0, 200])
  })

  it('fillRect 用页内坐标 (0,0,w,h) —— 不是把 pageY 塞进 y', () => {
    const { ctx, calls } = recordingCtx()
    fillTileWatermark(ctx, PATTERN, 200, 794, 1123)

    expect(calls.find((c) => c.op === 'fillRect')!.args).toEqual([0, 0, 794, 1123])
  })

  it('pageY 变化时只有 translate 跟着变 (页面滚动 ⇒ 图案一起走)', () => {
    const a = recordingCtx()
    const b = recordingCtx()
    fillTileWatermark(a.ctx, PATTERN, 0, 794, 1123)
    fillTileWatermark(b.ctx, PATTERN, -500, 794, 1123)

    expect(a.calls.find((c) => c.op === 'translate')!.args[1]).toBe(0)
    expect(b.calls.find((c) => c.op === 'translate')!.args[1]).toBe(-500)
    // fillRect 恒为页内坐标, 与滚动无关
    expect(a.calls.find((c) => c.op === 'fillRect')!.args).toEqual(
      b.calls.find((c) => c.op === 'fillRect')!.args,
    )
  })

  it('pattern 真的被当作 fillStyle 传入 (不是漏绑)', () => {
    const { ctx, raw } = recordingCtx()
    fillTileWatermark(ctx, PATTERN, 12, 100, 100)
    expect(raw._fillStyle).toBe(PATTERN)
  })
})
