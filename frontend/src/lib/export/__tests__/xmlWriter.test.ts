// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// xmlWriter — 转义 / 非法字符剔除 / 元素组装
//
// 关键断言是**经 DOMParser 回环**: 我们的转义正确与否, 不由我们自己说了算,
// 由 XML 解析器说了算。任何能产出 parsererror 的输入都是缺陷。
//
// 注意: 本文件里的控制字符一律用 String.fromCharCode 构造, **绝不写字面
// 不可见字符** —— 字面控制字符在 review / diff / grep 里都不可见, 会被格式化
// 器静默剥离, 让用例变成断言别的东西 (这正是 provenance.ts 对零宽字符所记的
// 同一条教训)。
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  createXmlCtx, escapeXmlAttr, escapeXmlText, sanitizeXmlChars,
  xmlDeclaration, xmlElement, xmlTextNode,
} from '../xmlWriter'

const NUL = String.fromCharCode(0x00)
const BS = String.fromCharCode(0x08)
const US = String.fromCharCode(0x1f) // unit separator
const SOH = String.fromCharCode(0x01)

/** 解析一个 XML 片段, 返回是否良构 (无 parsererror) */
function parses(xml: string): boolean {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  return doc.getElementsByTagName('parsererror').length === 0
}

describe('sanitizeXmlChars', () => {
  it('保留合法字符: 制表/换行/回车/常规文本/中文', () => {
    const r = sanitizeXmlChars(`a${'\t'}b${'\n'}c${'\r'}d 中文`)
    expect(r.value).toBe(`a${'\t'}b${'\n'}c${'\r'}d 中文`)
    expect(r.dropped).toBe(0)
  })

  it('剔除 XML 1.0 非法控制字符并计数 (不静默)', () => {
    const r = sanitizeXmlChars(`a${NUL}b${BS}c${US}d`)
    expect(r.value).toBe('abcd')
    expect(r.dropped).toBe(3)
  })

  it('保留合法代理对 (emoji 不被拆坏)', () => {
    const r = sanitizeXmlChars('a\u{1F600}b')
    expect(r.value).toBe('a\u{1F600}b')
    expect(r.dropped).toBe(0)
  })

  it('剔除孤立代理项', () => {
    const lone = String.fromCharCode(0xd800)
    const r = sanitizeXmlChars(`a${lone}b`)
    expect(r.value).toBe('ab')
    expect(r.dropped).toBe(1)
  })
})

describe('escapeXmlText', () => {
  it('转义 & < >', () => {
    const r = escapeXmlText('a & b < c > d')
    expect(r.value).toBe('a &amp; b &lt; c &gt; d')
  })

  it('无条件转义 > 使 ]]> 天然安全', () => {
    expect(escapeXmlText(']]>').value).toBe(']]&gt;')
  })

  it('不转义引号 (文本节点里无需转义, 保持可读)', () => {
    expect(escapeXmlText(`a"b'c`).value).toBe(`a"b'c`)
  })
})

describe('escapeXmlAttr', () => {
  it('额外转义引号与空白 (属性值归一化会改写 tab/LF/CR)', () => {
    const r = escapeXmlAttr(`a"b'c${'\t'}d${'\n'}e${'\r'}f`)
    expect(r.value).toBe('a&quot;b&apos;c&#9;d&#10;e&#13;f')
  })

  it('属性值里的尖括号与 & 也被转义', () => {
    expect(escapeXmlAttr('<&>').value).toBe('&lt;&amp;&gt;')
  })
})

describe('xmlElement', () => {
  it('无子节点 → 自闭合', () => {
    const ctx = createXmlCtx()
    expect(xmlElement(ctx, 'x')).toBe('<x/>')
    expect(xmlElement(ctx, 'x', { a: 1 })).toBe('<x a="1"/>')
  })

  it('空数组 / 空串子节点 → 自闭合', () => {
    const ctx = createXmlCtx()
    expect(xmlElement(ctx, 'x', undefined, [])).toBe('<x/>')
    expect(xmlElement(ctx, 'x', undefined, '')).toBe('<x/>')
  })

  it('undefined / null 属性被跳过, 不产出 a="undefined"', () => {
    const ctx = createXmlCtx()
    expect(xmlElement(ctx, 'x', { a: undefined, b: null, c: 'v' })).toBe('<x c="v"/>')
  })

  it('属性值与文本节点均被转义', () => {
    const ctx = createXmlCtx()
    const el = xmlElement(ctx, 'x', { t: 'a"b' }, [xmlTextNode(ctx, '<c&d>')])
    expect(el).toBe('<x t="a&quot;b">&lt;c&amp;d&gt;</x>')
  })

  it('累计被剔除的非法字符数到 ctx', () => {
    const ctx = createXmlCtx()
    xmlElement(ctx, 'x', { a: `p${NUL}q` }, [xmlTextNode(ctx, `r${SOH}s`)])
    expect(ctx.droppedChars).toBe(2)
  })
})

describe('经 XML 解析器回环 (正确性由解析器判定, 不由我们自己)', () => {
  it('声明 + 元素是良构的', () => {
    const ctx = createXmlCtx()
    const xml = xmlDeclaration() + xmlElement(ctx, 'root', { v: '1' }, [xmlTextNode(ctx, '文本')])
    expect(parses(xml)).toBe(true)
  })

  it('充满需要转义的字符仍良构', () => {
    const ctx = createXmlCtx()
    const nasty = `<tag attr="v"> & </tag> ]]> ${NUL} " ' \\ 中文 \u{1F600}`
    const xml = xmlDeclaration() + xmlElement(ctx, 'root', { t: nasty }, [xmlTextNode(ctx, nasty)])
    expect(parses(xml)).toBe(true)
    expect(ctx.droppedChars).toBe(2) // 属性一处 + 文本一处, 各剔除同一个非法字符
  })

  it('被转义的文本能原样读回 (转义不是有损的)', () => {
    const ctx = createXmlCtx()
    const original = `a & b < c > d "e" 'f' 中文`
    const xml = xmlDeclaration() + xmlElement(ctx, 'root', undefined, [xmlTextNode(ctx, original)])
    const doc = new DOMParser().parseFromString(xml, 'text/xml')
    expect(doc.documentElement.textContent).toBe(original)
  })
})
