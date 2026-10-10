// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// compareDocuments — 版本比较的文档装载
//
// 历史缺陷: ComparePage 曾自己 `buildNodePool(map, { body: doc.id })`, 而 map 里
// 只放了一个文档根节点。buildNodePool 只做「全量注册 + 引用完整性校验」, **不会
// 展开子节点**, 因此建出来的池里永远只有 1 个节点 —— DocumentCompareView 逐段读
// `pool.nodes.get(…)` 全部落空, 界面呈现成「两份文档完全一致」。
//
// 这个缺陷不会让 tsc / build 变红 (类型完全正确), 所以必须由用例钉住。
// ============================================================

import { describe, it, expect } from 'vitest'
import { loadComparePair } from '../compareDocuments'
import admissionRecord from '@/mocks/admissionRecord.json'

const content = () => JSON.stringify(admissionRecord)

describe('loadComparePair', () => {
  it('池必须装载全部内嵌节点, 而不是只有文档根', () => {
    const { old } = loadComparePair(content(), content())

    const embedded = (admissionRecord as { nodes?: Record<string, unknown> }).nodes ?? {}
    const embeddedCount = Object.keys(embedded).length
    expect(embeddedCount).toBeGreaterThan(1) // 夹具本身要够真实, 否则下面的断言是假通过

    // 根节点 + 内嵌扁平表全部入池 (buildNodePool 只注册传入的 map)
    expect(old.pool.nodes.size).toBeGreaterThan(1)
    expect(old.pool.nodes.has(old.doc.id)).toBe(true)
  })

  it('正文段落与其内联子节点都能从池里解析出来 (比较视图的读取口径)', () => {
    const { old } = loadComparePair(content(), content())

    const bodyChildren = old.doc.body.children
    expect(bodyChildren.length).toBeGreaterThan(0)

    // 至少有一个正文块能在池里解析出其子节点 —— 这正是 DocumentCompareView
    // getDiffText 的取文本方式 (pool.nodes.get(paraId).children → 逐个取 text)。
    const resolvable = bodyChildren.filter((id) => {
      const node = old.pool.nodes.get(id) as { type?: string; children?: readonly string[] } | undefined
      return !!node?.children?.some((cid) => typeof (old.pool.nodes.get(cid) as { text?: string })?.text === 'string')
    })
    expect(resolvable.length).toBeGreaterThan(0)
  })

  it('两份文档各自独立建池 (互不共享节点实例)', () => {
    const { old, new: newer } = loadComparePair(content(), content())
    expect(old.pool).not.toBe(newer.pool)
    expect(old.pool.nodes.size).toBe(newer.pool.nodes.size)
  })

  it('内容非法时抛出, 不静默退化成空对比', () => {
    expect(() => loadComparePair('{ not json', content())).toThrow()
  })
})
