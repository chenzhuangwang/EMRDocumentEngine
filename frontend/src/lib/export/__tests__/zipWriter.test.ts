// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// zipWriter — 容器打包
//
// 断言策略: 用 **fflate 自己的 unzipSync** 读回产物。本机没有任何 OFD 阅读器,
// 无法端到端验证; 至少让「包能不能被独立实现解开」有自动化证据。(生产代码与
// 测试都依赖 fflate, 所以这不算完全独立的实现 —— 真正的外部交叉验证是把产物
// 交给 unzip / 7-Zip 人工打开, 见计划文档的验证一节。)
// ============================================================

import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { buildZip } from '../zipWriter'

const MTIME = new Date('2026-01-01T00:00:00Z')

describe('buildZip', () => {
  it('条目可按原样解回, 内容一致', () => {
    const bytes = buildZip([
      { name: 'OFD.xml', data: '<ofd:OFD/>', store: true },
      { name: 'Doc_0/Document.xml', data: '<ofd:Document/>' },
    ], { mtime: MTIME })

    const back = unzipSync(bytes)
    expect(Object.keys(back).sort()).toEqual(['Doc_0/Document.xml', 'OFD.xml'])
    expect(strFromU8(back['OFD.xml'])).toBe('<ofd:OFD/>')
    expect(strFromU8(back['Doc_0/Document.xml'])).toBe('<ofd:Document/>')
  })

  it('保持条目顺序 (OFD 要求入口文件排在包首)', () => {
    const bytes = buildZip([
      { name: 'OFD.xml', data: 'a', store: true },
      { name: 'Doc_0/Document.xml', data: 'b' },
      { name: 'Doc_0/Pages/Page_0/Content.xml', data: 'c' },
    ], { mtime: MTIME })
    expect(Object.keys(unzipSync(bytes))).toEqual([
      'OFD.xml', 'Doc_0/Document.xml', 'Doc_0/Pages/Page_0/Content.xml',
    ])
  })

  it('同一输入 + 同一 mtime ⇒ 逐字节相同 (可复现构建/将来签章的前提)', () => {
    const entries = [
      { name: 'OFD.xml', data: '<a/>', store: true as const },
      { name: 'x.txt', data: '重复内容重复内容重复内容' },
    ]
    const a = buildZip(entries, { mtime: MTIME })
    const b = buildZip(entries, { mtime: MTIME })
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('mtime 不同 ⇒ 字节不同 (证明 mtime 真的生效而不是被忽略)', () => {
    const entries = [{ name: 'a.txt', data: 'x' }]
    const a = buildZip(entries, { mtime: MTIME })
    const b = buildZip(entries, { mtime: new Date('2027-06-15T12:34:56Z') })
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })

  it('STORED 条目真的不压缩 (体积不小于原文)', () => {
    const payload = 'x'.repeat(4096)
    const stored = buildZip([{ name: 'a.txt', data: payload, store: true }], { mtime: MTIME })
    const deflated = buildZip([{ name: 'a.txt', data: payload }], { mtime: MTIME })
    // 高压缩比文本: 压缩后应显著更小; 若 store 被忽略则两者相等
    expect(stored.length).toBeGreaterThan(deflated.length)
  })

  it('重名条目抛错 —— 不允许后一条静默覆盖前一条', () => {
    expect(() => buildZip([
      { name: 'Doc_0/x.xml', data: 'a' },
      { name: 'Doc_0/x.xml', data: 'b' },
    ], { mtime: MTIME })).toThrow(/duplicate entry name/)
  })
})
