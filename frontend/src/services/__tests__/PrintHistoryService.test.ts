// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// PrintHistoryService — 应用侧打印历史服务
//
// 本文件原为 engine/__tests__/EdgeCases.test.ts 的最后一个 describe。
// 引擎源码物理剥离到 packages/emr-document-engine 后 (契约 §32), 该 describe
// 测的却是**应用侧** service (src/services/PrintHistoryService.ts) —— 它进不了
// 分发包, 也就不该留在包内测试里 (§32.2 同样的方向问题)。
//
// 于是拆出来, 落在被测对象的旁边。
// ============================================================

import { describe, it, expect } from 'vitest'
import { PrintHistoryService } from '../PrintHistoryService'

describe('PrintHistoryService', () => {
  it('should add and retrieve records', () => {
    const s = new PrintHistoryService()
    s.addRecord({ id:'ph1',documentId:'d1',documentTitle:'Test',printedAt:Date.now(),pageRange:{start:1,end:5},copies:1,duplex:false,completed:true })
    expect(s.getHistory().length).toBe(1)
    expect(s.getHistory()[0].documentTitle).toBe('Test')
  })

  it('should find incomplete print', () => {
    const s = new PrintHistoryService()
    s.addRecord({ id:'ph2',documentId:'d2',documentTitle:'T2',printedAt:Date.now(),pageRange:{start:1,end:10},copies:2,duplex:true,completed:false,lastCompletedPage:7 })
    expect(s.findIncomplete()).not.toBeNull()
    expect(s.findIncomplete()!.lastCompletedPage).toBe(7)
  })

  it('should update record', () => {
    const s = new PrintHistoryService()
    s.addRecord({ id:'ph3',documentId:'d3',documentTitle:'T3',printedAt:Date.now(),pageRange:{start:1,end:3},copies:1,duplex:false,completed:false })
    s.updateRecord('ph3', { completed: true })
    expect(s.getHistory()[0].completed).toBe(true)
  })

  it('should clear history', () => {
    const s = new PrintHistoryService()
    s.addRecord({ id:'ph4',documentId:'d4',documentTitle:'T4',printedAt:Date.now(),pageRange:{start:1,end:1},copies:1,duplex:false,completed:true })
    s.clear()
    expect(s.getHistory().length).toBe(0)
  })
})
