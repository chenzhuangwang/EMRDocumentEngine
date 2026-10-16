// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ExpressionEngine — 计算式求值器 (契约 §12.12.2 / §12.12.3 / §12.12.4)
//
// 纯函数, 不碰文档也不碰挂钟: 引用怎么解析由测试喂, 时间由测试注入。
// 本文件锁的是**会被踩的地方**, 不是语法清单:
//   - 引用必须显式写成 [key] (裸标识符报错 —— 否则依赖索引会漏掉引用);
//   - 撞键/未找到的错误**原样上抛**, 求值器不替调用方挑一个 (§12.12.3);
//   - 数字串数值化、非数字串报错、空态报错 (§12.12.4);
//   - SHOW/HIDE 的角色判定, 以及一条公式不得产两条指令;
//   - GETAGE 的空态语义 (未填 ≠ 0 岁) 与未来日期。
// ================================================================

import { describe, it, expect } from 'vitest'
import {
  evaluateFormula, parseFormula, builtinFunctionNames,
} from '../evaluation/ExpressionEngine'
import type { CalcContext, CalcError, CalcResult, CalcValue } from '../evaluation/ExpressionEngine'
import type { ControlValue } from '../document/core/DocumentModel'

/** 注入时钟 (契约 §12.12.7: 求值器自己不读钟) —— 2026-10-16 */
const NOW = new Date(2026, 9, 16, 10, 0, 0)

function ctxOf(
  values: Record<string, ControlValue | undefined> = {},
  now: Date = NOW,
): CalcContext {
  return {
    now,
    resolveRef: (key) => (
      key in values
        ? { ok: true, value: values[key] }
        : { ok: false, error: { code: 'unresolved_reference', message: `no such key "${key}"` } }
    ),
  }
}

/** 求值并要求成功, 返回结果 */
function ok(src: string, values?: Record<string, ControlValue | undefined>, now?: Date): Extract<CalcResult, { ok: true }> {
  const r = evaluateFormula(src, ctxOf(values, now))
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`)
  return r
}

/** 求值并要求失败, 返回错误 */
function err(src: string, values?: Record<string, ControlValue | undefined>, now?: Date): CalcError {
  const r = evaluateFormula(src, ctxOf(values, now))
  if (r.ok) throw new Error(`expected an error, got ${JSON.stringify(r)}`)
  return r.error
}

function valueOf(src: string, values?: Record<string, ControlValue | undefined>, now?: Date): number | string {
  const r = ok(src, values, now)
  if (r.role !== 'value') throw new Error(`expected role=value, got ${r.role}`)
  return r.value
}

// ================================================================
// 词法 / 语法
// ================================================================

describe('词法与语法', () => {
  it('数字 / 字符串 / 真值字面量', () => {
    expect(valueOf('42')).toBe(42)
    expect(valueOf('3.5')).toBe(3.5)
    expect(valueOf("'abc'")).toBe('abc')
    expect(valueOf('"abc"')).toBe('abc')
  })

  it('优先级与结合性', () => {
    expect(valueOf('1 + 2 * 3')).toBe(7)
    expect(valueOf('(1 + 2) * 3')).toBe(9)
    // 左结合: 10-3-2 = 5, 不是 9
    expect(valueOf('10 - 3 - 2')).toBe(5)
    expect(valueOf('2 * 3 % 4')).toBe(2)
    expect(valueOf('-3 + 1')).toBe(-2)
    // 一元负号可叠加
    expect(valueOf('--3')).toBe(3)
  })

  it('三元与 IF() 是同一件事的两种写法', () => {
    expect(valueOf('1 < 2 ? 10 : 20')).toBe(10)
    expect(valueOf('IF(1 < 2, 10, 20)')).toBe(10)
  })

  it('**三元与 IF() 都只求值命中的那一支** —— 另一支里的引用不许影响结果', () => {
    // 假支引用了不存在的键: 短路则通过, 不短路就报 unresolved_reference。
    // IF 必须是**特殊形式**: 普通函数调用会先把三个实参全求值, 那就没有短路了。
    expect(valueOf('1 > 0 ? 5 : [NOPE]')).toBe(5)
    expect(valueOf('IF(1 > 0, 5, [NOPE])')).toBe(5)
    expect(err('IF(1 < 0, 5, [NOPE])').code).toBe('unresolved_reference')
  })

  it('&& / || 短路', () => {
    // 布尔不是可显示的派生值 (见下), 所以短路用三元接出来看
    expect(valueOf("false && [NOPE] ? 'a' : 'b'")).toBe('b')
    expect(valueOf("true || [NOPE] ? 'a' : 'b'")).toBe('a')
  })

  it('**裸标识符报错** —— 引用必须显式写成 [key]', () => {
    // 这条不是洁癖: 裸标识符会让依赖索引漏掉引用, 于是"改了 A, X 不重算"
    const e = err('DE_SEX == 1')
    expect(e.code).toBe('syntax')
    expect(e.message).toMatch(/\[key\]/)
  })

  it('不许出现的字符在词法层就被挡下 (白名单的一部分)', () => {
    for (const bad of ['a $ b', '`tpl`', '/re/', '1 & 2', 'x = 1']) {
      const r = evaluateFormula(bad, ctxOf())
      expect(r.ok, `"${bad}" 应当报错`).toBe(false)
    }
  })

  it('未闭合 / 空引用 / 残渣 / 未闭合字符串都报 syntax 并带位置', () => {
    for (const bad of ['[abc', '[]', '1 + 2 3', "'abc", '(1 + 2']) {
      const e = err(bad)
      expect(e.code, `"${bad}"`).toBe('syntax')
      expect(typeof e.position, `"${bad}" 应带位置`).toBe('number')
    }
  })

  it('parseFormula 只做语法, 不解析引用 (解析是调用方的事)', () => {
    const ast = parseFormula('[A] + 1')
    expect(Array.isArray(ast)).toBe(false)
    expect((ast as { kind: string }).kind).toBe('binary')
  })
})

// ================================================================
// 引用 (契约 §12.12.3)
// ================================================================

describe('引用', () => {
  it('按键解析 → 该控件的原始值', () => {
    expect(valueOf('[N] + 1', { N: 41 })).toBe(42)
    expect(valueOf('[S]', { S: '张三' })).toBe('张三')
  })

  it('未填引用 → empty_reference (空态不是 0, 也不许静默当空串)', () => {
    expect(err('[N] + 1', { N: undefined }).code).toBe('empty_reference')
  })

  it('**撞键 / 未找到的错误原样上抛**, 求值器不挑一个', () => {
    const ctx: CalcContext = {
      now: NOW,
      resolveRef: () => ({
        ok: false,
        error: {
          code: 'ambiguous_reference',
          message: 'key hits 2 controls',
          candidateNodeIds: ['st1', 'st2'],
        },
      }),
    }
    const r = evaluateFormula('[DE_X] + 1', ctx)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('ambiguous_reference')
    // 候选要原样带回去, 宿主据此交给实施方改键 (§12.10.2 的姿态)
    expect(r.error.candidateNodeIds).toEqual(['st1', 'st2'])
  })

  it('多选值 (string[]) 不能进表达式 —— 交给显式函数去接', () => {
    expect(err('[ALLERGY] + 1', { ALLERGY: ['pcn', 'sulfa'] }).code).toBe('not_a_number')
  })

  it('#key 是 [key] 的糖 (参考实现写 SHOW(#id))', () => {
    const r = ok('HIDE(#DE_PREG)')
    expect(r.role).toBe('visibility')
    if (r.role !== 'visibility') return
    expect(r.directive).toEqual({ key: 'DE_PREG', visible: false })
  })
})

// ================================================================
// 类型与强制转换 (契约 §12.12.4 —— 读路径的宽松)
// ================================================================

describe('类型与强制转换', () => {
  it('能完整解析为有限数字的字符串参与算术时数值化', () => {
    expect(valueOf("'3' + '4'")).toBe(7)
    expect(valueOf('[N] * 2', { N: '21' })).toBe(42)
    expect(valueOf("' 7 ' - 1")).toBe(6)
  })

  it('**非数字字符串参与算术报错, 不静默变 NaN**', () => {
    expect(err("'abc' + 1").code).toBe('not_a_number')
    expect(err("1 - 'abc'").code).toBe('not_a_number')
    // 半数字串也不行 ('12abc' 不是完整数字)
    expect(err("'12abc' + 1").code).toBe('not_a_number')
  })

  it('`+` 三条规则: 两侧都是数字 → 加法; 两侧都是字符串 → 连接; 混合 → 报错', () => {
    // ① 两侧都能当数字 → 数值加法
    expect(valueOf("'3' + '4'")).toBe(7)
    // ② 两侧都是字符串 (且非数字) → 连接
    expect(valueOf("'张' + '三'")).toBe('张三')
    // ③ 混合 → **报错**, 不猜作者的意图
    expect(err("'第' + 3").code).toBe('not_a_number')
    expect(err("1 + 'abc'").code).toBe('not_a_number')
    // 想拼标签就显式转 —— 转完两侧都是字符串, 走连接
    expect(valueOf("'第' + TEXT(3) + '床'")).toBe('第3床')
  })

  it('`==` 两侧都像数字 → 数值比较; 否则按字符串', () => {
    // 布尔不是可显示值, 用三元把它接成可见结果
    const eq = (src: string) => valueOf(`${src} ? 'T' : 'F'`)
    expect(eq("'3' == 3")).toBe('T')
    expect(eq("'03' == 3")).toBe('T')
    expect(eq("'M' == 'M'")).toBe('T')
    expect(eq("'M' == 'm'")).toBe('F')
  })

  it('大小比较要求数值, 非数字串报错', () => {
    expect(valueOf("'5' > 3 ? 'T' : 'F'")).toBe('T')
    expect(err("'abc' < 3").code).toBe('not_a_number')
  })

  it('**逻辑运算只接受布尔** —— 不引入 truthiness', () => {
    expect(err("'abc' && true").code).toBe('bad_arguments')
    expect(err('1 || false').code).toBe('bad_arguments')
    expect(valueOf("1 < 2 && 2 < 3 ? 'T' : 'F'")).toBe('T')
  })

  it('空态在相等比较里等同空串 (未填 == "" 成立), 但算术里报错', () => {
    expect(valueOf('[A] == "" ? \'T\' : \'F\'', { A: undefined })).toBe('T')
    expect(err('[A] + 1', { A: undefined }).code).toBe('empty_reference')
  })

  it('除零报错, 不返回 Infinity', () => {
    expect(err('1 / 0').code).toBe('bad_arguments')
    expect(err('1 % 0').code).toBe('bad_arguments')
  })
})

// ================================================================
// 内置函数 (闭表)
// ================================================================

describe('内置函数', () => {
  it('GETAGE: 生日已过 → 整岁', () => {
    expect(valueOf('GETAGE([BIRTH])', { BIRTH: '1990-01-01' })).toBe(36)
  })

  it('GETAGE: 生日当天算整岁, 前一天少一岁 (边界各测一次)', () => {
    // now = 2026-10-16
    expect(valueOf('GETAGE([BIRTH])', { BIRTH: '1990-10-16' })).toBe(36)
    expect(valueOf('GETAGE([BIRTH])', { BIRTH: '1990-10-17' })).toBe(35)
  })

  it('GETAGE: 闰日出生 (2/29) 在非闰年的 2/28 与 3/1 上', () => {
    expect(valueOf('GETAGE([BIRTH])', { BIRTH: '2000-02-29' }, new Date(2026, 1, 28))).toBe(25)
    expect(valueOf('GETAGE([BIRTH])', { BIRTH: '2000-02-29' }, new Date(2026, 2, 1))).toBe(26)
  })

  it('GETAGE: 未填出生日期 → empty_reference (未填 ≠ 0 岁)', () => {
    const e = err('GETAGE([BIRTH])', { BIRTH: undefined })
    expect(e.code).toBe('empty_reference')
  })

  it('GETAGE: 出生日期在未来 → 报错, 不返回负数', () => {
    expect(err('GETAGE([BIRTH])', { BIRTH: '2030-01-01' }).code).toBe('bad_arguments')
  })

  it('GETAGE: 非法日期报错, 包含"形状合法但不存在"的那天', () => {
    expect(err('GETAGE([BIRTH])', { BIRTH: '2026-02-30' }).code).toBe('bad_arguments')
    expect(err('GETAGE([BIRTH])', { BIRTH: '1990/01/01' }).code).toBe('bad_arguments')
  })

  it('DIFF_DATE_DAYS / DIFF_DATE_HOURS', () => {
    expect(valueOf("DIFF_DATE_DAYS('2026-10-01', '2026-10-16')")).toBe(15)
    expect(valueOf("DIFF_DATE_HOURS('2026-10-16 08:00:00', '2026-10-16 18:00:00')")).toBe(10)
  })

  it('SUM 跳过空态项 (缺失项不加 0, 也不报错)', () => {
    expect(valueOf('SUM([A], [B], [C])', { A: 1, B: undefined, C: '2' })).toBe(3)
    // 非数字项仍然报错 —— 跳过的是"没填", 不是"填了但算不了"
    expect(err('SUM([A], [B])', { A: 1, B: 'abc' }).code).toBe('not_a_number')
  })

  it('ROUND 校验小数位 (整数、0..10)', () => {
    expect(valueOf('ROUND(3.14159, 2)')).toBe(3.14)
    expect(valueOf('ROUND(2.5)')).toBe(3)
    expect(err('ROUND(1, 2.5)').code).toBe('bad_arguments')
    expect(err('ROUND(1, 11)').code).toBe('bad_arguments')
  })

  it('LEN 计字符数 (CJK 按 1 个字符)', () => {
    expect(valueOf('LEN([S])', { S: '住院号AB' })).toBe(5)
    expect(valueOf('LEN([S])', { S: undefined })).toBe(0)
  })

  it('未注册函数 → unknown_function (不是静默 undefined)', () => {
    expect(err('NOPE(1)').code).toBe('unknown_function')
  })

  it('集成方注册的函数可被调用 (信任级别等同插件)', () => {
    const ctx: CalcContext = {
      now: NOW,
      resolveRef: () => ({ ok: true, value: undefined }),
      functions: new Map([['DOUBLE', (args: readonly CalcValue[]) => (args[0] as number) * 2]]),
    }
    const r = evaluateFormula('DOUBLE(21)', ctx)
    expect(r.ok).toBe(true)
    if (r.ok && r.role === 'value') expect(r.value).toBe(42)
  })

  it('内置函数表是闭的, 且可枚举 (供作者化面提示)', () => {
    const names = builtinFunctionNames()
    for (const n of ['GETAGE', 'DIFF_DATE_DAYS', 'DIFF_DATE_HOURS', 'SUM', 'ROUND', 'IF', 'LEN']) {
      expect(names).toContain(n)
    }
  })
})

// ================================================================
// SHOW / HIDE 与角色判定 (契约 §12.12.5 / §12.12.9)
// ================================================================

describe('SHOW / HIDE 与角色判定', () => {
  it('触发式 (参考实现的 if/else 形状) → role=visibility', () => {
    const r = ok("[SEX] == 'M' ? HIDE([DE_PREG]) : SHOW([DE_PREG])", { SEX: 'M' })
    expect(r.role).toBe('visibility')
    if (r.role !== 'visibility') return
    expect(r.directive).toEqual({ key: 'DE_PREG', visible: false })
  })

  it('条件为假 → 走另一支, 只产那一条指令', () => {
    const r = ok("[SEX] == 'M' ? HIDE([DE_PREG]) : SHOW([DE_PREG])", { SEX: 'F' })
    if (r.role !== 'visibility') throw new Error('expected visibility')
    expect(r.directive).toEqual({ key: 'DE_PREG', visible: true })
  })

  it('一条公式产出**两条**指令 → 报错, 不猜哪条算数', () => {
    // && 会把两侧都求值 (短路只在左侧已定结果时生效), 于是能收集到两条指令
    const e = err('SHOW([A]) && SHOW([B])')
    expect(e.code).toBe('bad_arguments')
  })

  it('SHOW/HIDE 的实参必须是引用', () => {
    expect(err('HIDE(1)').code).toBe('bad_arguments')
    expect(err('SHOW(1, 2)').code).toBe('bad_arguments')
  })

  it('赋值式 → role=value', () => {
    const r = ok('[A] + [B]', { A: 1, B: 2 })
    expect(r.role).toBe('value')
  })

  it('值公式算出布尔 → 报 not_displayable (不是悄悄显示 true/false)', () => {
    expect(err('1 < 2').code).toBe('not_displayable')
  })

  it('值公式算出空态 → empty_reference, 由上层决定"显示占位符"还是报错', () => {
    expect(err('GETAGE([BIRTH])', { BIRTH: undefined }).code).toBe('empty_reference')
  })
})

// ================================================================
// 纯净性 —— 求值器不读钟 (契约 §12.12.7)
// ================================================================

describe('纯净性', () => {
  it('同一个 ctx (同一 now) 两次求值结果相同', () => {
    const ctx = ctxOf({ BIRTH: '1990-05-05' })
    const a = evaluateFormula('GETAGE([BIRTH])', ctx)
    const b = evaluateFormula('GETAGE([BIRTH])', ctx)
    expect(a).toEqual(b)
  })

  it('年龄只随**注入的** now 变 —— 换 ctx 才变', () => {
    const v = { BIRTH: '1990-10-16' }
    expect(valueOf('GETAGE([BIRTH])', v, new Date(2026, 9, 15))).toBe(35)
    expect(valueOf('GETAGE([BIRTH])', v, new Date(2026, 9, 16))).toBe(36)
  })
})
