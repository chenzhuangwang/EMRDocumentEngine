// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ComputedValues — 计算值的一份集合 (契约 §12.12.6 / §12.12.7 / §12.12.8)
//
// 本文件锁的是**机制**, 不是某条公式算得对不对 (那在 ExpressionEngine.test.ts):
//   - 时钟**按重算读一次** (用注入的计数器直接观察, 而不是"看起来对");
//   - 依赖失效**只重算受影响的**: 改一个没人引用的字段不该触发重算;
//   - 环在**建图时**报出, 且不挂;
//   - 链式引用读上游的**计算值**;
//   - 可见性出错一律 fail-open (宁可显示一个坏值, 不可悄悄藏掉必填项)。
// ================================================================

import { describe, it, expect } from 'vitest'
import { ComputedValues } from '../evaluation/ComputedValues'
import type { ComputedValuesDeps } from '../evaluation/ComputedValues'
import type { ControlValue } from '../document/core/DocumentModel'

const NOW = new Date(2026, 9, 16, 10, 0, 0)

interface DocSpec {
  /** 节点 id, 按投影顺序 */
  nodes: string[]
  /** nodeId → 绑定键 */
  key: Record<string, string>
  /** nodeId → 公式 */
  formula: Record<string, string>
  /** nodeId → 原始值 */
  value: Record<string, ControlValue | undefined>
}

/** 夹具 + 一个可观察的时钟调用计数 */
function makeSet(doc: DocSpec, at: Date = NOW) {
  const clock = { calls: 0, at }
  const deps: ComputedValuesDeps = {
    nodeIds: () => doc.nodes,
    keyOf: (id) => doc.key[id] ?? '',
    formulaOf: (id) => doc.formula[id],
    valueOf: (id) => doc.value[id],
    nodesFor: (key) => doc.nodes.filter((id) => (doc.key[id] ?? '') === key),
    now: () => { clock.calls++; return clock.at },
  }
  const set = new ComputedValues(deps)
  set.reset()
  return { set, clock, doc }
}

// ================================================================
// 基本读取
// ================================================================

describe('基本读取', () => {
  it('值公式 → display; 无公式的控件 → undefined 且可见', () => {
    const { set } = makeSet({
      nodes: ['a', 'b'],
      key: { a: 'A', b: 'B' },
      formula: { a: '[B] + 1' },
      value: { b: 41 },
    })
    set.ensure()
    expect(set.displayOf('a')).toBe('42')
    expect(set.get('b')).toBeUndefined()
    expect(set.visibleOf('b')).toBe(true)
  })

  it('数字结果转成字符串 (布局与绘制要的是文本)', () => {
    const { set } = makeSet({
      nodes: ['a'], key: { a: 'A' }, formula: { a: '[B] * 2' }, value: { },
    })
    // B 不存在 → 引用解析失败, 不算 display
    set.ensure()
    expect(set.displayOf('a')).toBeUndefined()
    expect(set.errors().map((e) => e.error.code)).toEqual(['unresolved_reference'])
  })

  it('无公式的文档 → 一次钟都不读 (没有重算这回事)', () => {
    const { set, clock } = makeSet({
      nodes: ['a'], key: { a: 'A' }, formula: {}, value: {},
    })
    set.ensure()
    expect(clock.calls).toBe(0)
    expect(set.computedAt).toBeNull()
  })
})

// ================================================================
// 时钟 (契约 §12.12.7)
// ================================================================

describe('时钟按重算读一次', () => {
  it('一次重算里无论几条公式, 钟只读一次', () => {
    const { set, clock } = makeSet({
      nodes: ['a', 'b', 'c', 'd'],
      key: { a: 'A', b: 'B', c: 'C', d: 'D' },
      formula: { a: '[B] + 1', c: '[D] + 1' },
      value: { b: 1, d: 2 },
    })
    set.ensure()
    expect(clock.calls).toBe(1)
    expect(set.computedAt).toEqual(NOW)
  })

  it('**文档没变时再 ensure() 不再读钟** —— 布局趟与绘制趟读同一份', () => {
    const { set, clock } = makeSet({
      nodes: ['a', 'b'],
      key: { a: 'A', b: 'B' },
      formula: { a: '[B] + 1' },
      value: { b: 1 },
    })
    set.ensure()
    const first = set.displayOf('a')
    set.ensure() // 模拟"另一趟"(渲染)
    set.ensure()
    expect(clock.calls).toBe(1)
    expect(set.displayOf('a')).toBe(first)
  })

  it('年龄不随时钟自己走 —— 只有换文档/依赖变化才更新', () => {
    const clock = { calls: 0, at: new Date(2026, 9, 16) }
    const doc: DocSpec = {
      nodes: ['age', 'birth'],
      key: { age: 'AGE', birth: 'BIRTH' },
      formula: { age: 'GETAGE([BIRTH])' },
      value: { birth: '1990-10-16' },
    }
    const deps: ComputedValuesDeps = {
      nodeIds: () => doc.nodes,
      keyOf: (id) => doc.key[id] ?? '',
      formulaOf: (id) => doc.formula[id],
      valueOf: (id) => doc.value[id],
      nodesFor: (key) => doc.nodes.filter((id) => (doc.key[id] ?? '') === key),
      now: () => { clock.calls++; return clock.at },
    }
    const set = new ComputedValues(deps)
    set.reset()
    set.ensure()
    expect(set.displayOf('age')).toBe('36')

    // 挂钟"走过"一天 —— 但没人告诉 set, 它就不动
    clock.at = new Date(2027, 9, 16)
    set.ensure()
    expect(set.displayOf('age')).toBe('36')

    // 换文档 (真正的重算) 才更新
    set.reset()
    set.ensure()
    expect(set.displayOf('age')).toBe('37')
  })
})

// ================================================================
// 依赖失效 (契约 §12.12.6)
// ================================================================

describe('依赖失效只重算受影响的', () => {
  it('改被引用的字段 → 重算; 改没人引用的字段 → **不重算**', () => {
    const { set, clock, doc } = makeSet({
      nodes: ['x', 'y', 'src', 'loner'],
      key: { x: 'X', y: 'Y', src: 'SRC', loner: 'LONER' },
      formula: { x: '[SRC] + 1', y: '[SRC] + 2' },
      value: { src: 1, loner: 9 },
    })
    set.ensure()
    expect(clock.calls).toBe(1)

    // 没人引用的字段变了 → 标脏逻辑不该被触发
    set.invalidateForValues(['loner'])
    set.ensure()
    expect(clock.calls).toBe(1)

    // 被引用的字段变了 → 重算一次, 值跟着变
    doc.value.src = 10
    set.invalidateForValues(['src'])
    set.ensure()
    expect(clock.calls).toBe(2)
    expect(set.displayOf('x')).toBe('11')
    expect(set.displayOf('y')).toBe('12')
  })

  it('一次批量写入只重算一次 (先标脏, 读之前一次做完)', () => {
    const { set, clock, doc } = makeSet({
      nodes: ['x', 'a', 'b'],
      key: { x: 'X', a: 'A', b: 'B' },
      formula: { x: 'SUM([A], [B])' },
      value: { a: 1, b: 2 },
    })
    set.ensure()
    expect(set.displayOf('x')).toBe('3')

    doc.value.a = 10
    doc.value.b = 20
    set.invalidateForValues(['a'])
    set.invalidateForValues(['b'])
    set.ensure()
    expect(clock.calls).toBe(2)      // 两次 invalidate 合成一次重算
    expect(set.displayOf('x')).toBe('30')
  })

  it('无身份的控件 (键为空串) 变更不触发任何重算', () => {
    const { set, clock } = makeSet({
      nodes: ['anon', 'x'],
      key: { anon: '', x: 'X' },
      formula: { x: '[X] + 1' },
      value: {},
    })
    set.ensure()
    const before = clock.calls
    set.invalidateForValues(['anon'])
    set.ensure()
    expect(clock.calls).toBe(before)
  })
})

// ================================================================
// 链式引用与环 (契约 §12.12.6)
// ================================================================

describe('链式引用与环', () => {
  it('引用一个有公式的控件 → 读到它的**计算值**, 不是它的原始 value', () => {
    const { set } = makeSet({
      nodes: ['a', 'b', 'raw'],
      key: { a: 'A', b: 'B', raw: 'RAW' },
      // RAW 的值是 1, 但 A 的公式把它算成 100; B 引用 A, 应当读到 100 而不是 1
      formula: { a: '[RAW] * 100', b: '[A] + 1' },
      value: { raw: 1 },
    })
    set.ensure()
    expect(set.displayOf('a')).toBe('100')
    expect(set.displayOf('b')).toBe('101')
  })

  it('A 引用 B、B 引用 A → 两者都报 cycle, 且**不挂**', () => {
    const { set } = makeSet({
      nodes: ['a', 'b'],
      key: { a: 'A', b: 'B' },
      formula: { a: '[B] + 1', b: '[A] + 1' },
      value: {},
    })
    set.ensure()
    expect(set.get('a')?.error?.code).toBe('cycle')
    expect(set.get('b')?.error?.code).toBe('cycle')
    expect(set.displayOf('a')).toBeUndefined()
  })

  it('自引用 (契约举的那例 `= id1 + (id1*2)`) 报 cycle', () => {
    const { set } = makeSet({
      nodes: ['a'],
      key: { a: 'A' },
      formula: { a: '[A] + ([A] * 2)' },
      value: { a: 5 },
    })
    set.ensure()
    expect(set.get('a')?.error?.code).toBe('cycle')
  })

  it('环外的下游也拿不到值, 但**不**被误报成 cycle 成员', () => {
    const { set } = makeSet({
      nodes: ['a', 'b', 'down'],
      key: { a: 'A', b: 'B', down: 'DOWN' },
      formula: { a: '[B] + 1', b: '[A] + 1', down: '[A] + 1' },
      value: {},
    })
    set.ensure()
    expect(set.get('a')?.error?.code).toBe('cycle')
    expect(set.get('b')?.error?.code).toBe('cycle')
    // 下游继承的是上游的错误码 —— 根因不会被压成"没填"(empty_reference)
    expect(set.get('down')?.error?.code).toBe('cycle')
  })

  it('四节点长环也能抓出来', () => {
    const { set } = makeSet({
      nodes: ['a', 'b', 'c', 'd'],
      key: { a: 'A', b: 'B', c: 'C', d: 'D' },
      formula: { a: '[B]', b: '[C]', c: '[D]', d: '[A]' },
      value: {},
    })
    set.ensure()
    for (const id of ['a', 'b', 'c', 'd']) expect(set.get(id)?.error?.code).toBe('cycle')
  })
})

// ================================================================
// 可见性 (契约 §12.12.5)
// ================================================================

describe('可见性', () => {
  it('触发式公式隐藏目标; 无公式的控件默认可见', () => {
    const { set } = makeSet({
      nodes: ['sex', 'preg', 'other'],
      key: { sex: 'SEX', preg: 'PREG', other: 'OTHER' },
      formula: { sex: "[SEX] == 'M' ? HIDE([PREG]) : SHOW([PREG])" },
      value: { sex: 'M' },
    })
    set.ensure()
    expect(set.visibleOf('preg')).toBe(false)
    expect(set.visibleOf('other')).toBe(true)
    // 触发式的那个控件自己照常可见, 且**不产生 display**
    expect(set.visibleOf('sex')).toBe(true)
    expect(set.displayOf('sex')).toBeUndefined()
  })

  it('条件翻转 → 重新可见', () => {
    const { set, doc } = makeSet({
      nodes: ['sex', 'preg'],
      key: { sex: 'SEX', preg: 'PREG' },
      formula: { sex: "[SEX] == 'M' ? HIDE([PREG]) : SHOW([PREG])" },
      value: { sex: 'M' },
    })
    set.ensure()
    expect(set.visibleOf('preg')).toBe(false)
    doc.value.sex = 'F'
    set.invalidateForValues(['sex'])
    set.ensure()
    expect(set.visibleOf('preg')).toBe(true)
  })

  it('SHOW/HIDE 目标键不存在 → 错误记在**写公式的节点**上', () => {
    const { set } = makeSet({
      nodes: ['t'],
      key: { t: 'T' },
      formula: { t: 'HIDE([NOPE])' },
      value: {},
    })
    set.ensure()
    expect(set.get('t')?.error?.code).toBe('unresolved_reference')
  })

  it('SHOW/HIDE 目标键撞键 → 报歧义带候选, **绝不挑一个来隐藏**', () => {
    const { set } = makeSet({
      nodes: ['t', 'p1', 'p2'],
      key: { t: 'T', p1: 'PREG', p2: 'PREG' },
      formula: { t: 'HIDE([PREG])' },
      value: {},
    })
    set.ensure()
    const e = set.get('t')?.error
    expect(e?.code).toBe('ambiguous_reference')
    expect(e?.candidateNodeIds?.length).toBe(2)
    // 两个候选都没被隐藏
    expect(set.visibleOf('p1')).toBe(true)
    expect(set.visibleOf('p2')).toBe(true)
  })

  it('两条公式对同一目标给出矛盾可见性 → 报冲突且**保持可见** (fail-open)', () => {
    const { set } = makeSet({
      nodes: ['t1', 't2', 'target'],
      key: { t1: 'T1', t2: 'T2', target: 'TARGET' },
      formula: { t1: 'HIDE([TARGET])', t2: 'SHOW([TARGET])' },
      value: {},
    })
    set.ensure()
    expect(set.get('target')?.error?.code).toBe('conflicting_visibility')
    // 悄悄藏掉一个必填项比显示它危险得多
    expect(set.visibleOf('target')).toBe(true)
  })

  it('两条公式给出**一致**的可见性 → 正常生效, 不算冲突', () => {
    const { set } = makeSet({
      nodes: ['t1', 't2', 'target'],
      key: { t1: 'T1', t2: 'T2', target: 'TARGET' },
      formula: { t1: 'HIDE([TARGET])', t2: 'HIDE([TARGET])' },
      value: {},
    })
    set.ensure()
    expect(set.visibleOf('target')).toBe(false)
    expect(set.get('target')?.error).toBeUndefined()
  })
})

// ================================================================
// 错误处理 (契约 §12.12.9: 错误必须可分类)
// ================================================================

describe('错误处理', () => {
  it('语法错只影响那一条公式, 别的公式照常算', () => {
    const { set } = makeSet({
      nodes: ['bad', 'good', 'v'],
      key: { bad: 'BAD', good: 'GOOD', v: 'V' },
      formula: { bad: '[A', good: '[V] + 1' },
      value: { v: 1 },
    })
    set.ensure()
    expect(set.get('bad')?.error?.code).toBe('syntax')
    expect(set.displayOf('good')).toBe('2')
  })

  it('**出错也保持可见** (fail-open) —— 藏掉一个算不出来的必填项是最坏的失败', () => {
    const { set } = makeSet({
      nodes: ['age', 'birth'],
      key: { age: 'AGE', birth: 'BIRTH' },
      formula: { age: 'GETAGE([BIRTH])' },
      value: { birth: undefined },
    })
    set.ensure()
    expect(set.get('age')?.error?.code).toBe('empty_reference')
    expect(set.visibleOf('age')).toBe(true)
  })

  it('空态不是错误地静默成 0 —— 未填出生日期算不出年龄, 报 empty_reference', () => {
    // `''` 也是 §12.6.1 的规范空态: 它必须以"没填"进入求值器, 而不是以字符串
    // 身份进去然后报"不是日期" —— 那会把作者指向格式检查, 而该做的是补字段
    const { set } = makeSet({
      nodes: ['age', 'birth'],
      key: { age: 'AGE', birth: 'BIRTH' },
      formula: { age: 'GETAGE([BIRTH])' },
      value: { birth: '' },
    })
    set.ensure()
    expect(set.displayOf('age')).toBeUndefined()
    expect(set.get('age')?.error?.code).toBe('empty_reference')
  })

  it('errors() 列出全部有错的节点', () => {
    const { set } = makeSet({
      nodes: ['a', 'b'],
      key: { a: 'A', b: 'B' },
      formula: { a: '[NOPE]', b: '[ALSO_NOPE]' },
      value: {},
    })
    set.ensure()
    expect(set.errors().map((e) => e.nodeId).sort()).toEqual(['a', 'b'])
  })
})

// ================================================================
// 试算入口 (契约 §12.12.9: 作者化面不得伸进 evaluation/ 内部)
// ================================================================

describe('preview 试算', () => {
  it('试算不写进集合 (纯查询)', () => {
    const { set } = makeSet({
      nodes: ['a', 'b'],
      key: { a: 'A', b: 'B' },
      formula: { a: '[B] + 1' },
      value: { b: 1 },
    })
    set.ensure()
    const before = set.displayOf('a')
    const r = set.preview('[B] * 10', 'a')
    expect(r.ok && r.role === 'value' && r.value).toBe(10)
    expect(set.displayOf('a')).toBe(before)
  })

  it('试算可分类报错 (未注册函数 / 撞键都由调用方表达)', () => {
    const { set } = makeSet({ nodes: ['a'], key: { a: 'A' }, formula: {}, value: {} })
    set.ensure()
    const r = set.preview('NOPE(1)', 'a')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('unknown_function')
  })

  it('**试算自己时读自己的原始值**, 不去照镜子读自己算出来的结果', () => {
    const { set } = makeSet({
      nodes: ['a', 'b'],
      key: { a: 'A', b: 'B' },
      formula: { a: '[B] * 2' },
      value: { a: 7, b: 3 },
    })
    set.ensure()
    expect(set.displayOf('a')).toBe('6')
    // 试算 [A] + 1: 若读到自己的旧结果 6 → 7; 若读到原始值 7 → 8
    const r = set.preview('[A] + 1', 'a')
    expect(r.ok && r.role === 'value' && r.value).toBe(8)
  })

  it('试算可见性公式 → 返回指令', () => {
    const { set } = makeSet({
      nodes: ['a', 't'],
      key: { a: 'A', t: 'T' },
      formula: {},
      value: { a: 'M' },
    })
    set.ensure()
    const r = set.preview("HIDE([T])", 'a')
    expect(r.ok && r.role === 'visibility' && r.directive.key).toBe('T')
  })
})
