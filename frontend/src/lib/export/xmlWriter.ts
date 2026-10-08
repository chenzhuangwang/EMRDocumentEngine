// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// xmlWriter — XML 转义与元素组装 (导出特性层, 纯函数)
//
// 为什么不复用 documentExport.escapeHtml: 它只处理 & < > 三个字符, 而
// XML 属性值还必须处理引号, 且属性值里的 \t \n \r 会被 XML 属性值归一化
// (attribute-value normalization) 静默改写 —— 直接复用会产出损坏的文档。
//
// 非法字符 (XML 1.0 未定义的控制字符 / 孤立代理项) 一律**剔除并计数**,
// 不静默丢弃 —— 契约 §31.5: 静默丢内容比报错更坏。调用方必须把
// `droppedChars` 上报到导出产物的 diagnostics/warnings 里。
// ============================================================

/** XML 1.0 合法字符 (Char production): #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF] */
function isLegalXmlCodePoint(cp: number): boolean {
  if (cp === 0x9 || cp === 0xa || cp === 0xd) return true
  if (cp >= 0x20 && cp <= 0xd7ff) return true
  if (cp >= 0xe000 && cp <= 0xfffd) return true
  if (cp >= 0x10000 && cp <= 0x10ffff) return true
  return false
}

export interface XmlText {
  value: string
  /** 被剔除的非法字符数 (0 表示原样通过) */
  dropped: number
}

/**
 * 剔除 XML 1.0 非法字符。
 *
 * 按**码点**迭代: 合法的代理对整体保留 (emoji 不被拆坏), 孤立代理项被剔除
 * (代理项码点落在 0xD800-0xDFFF, 不在任何合法区间内)。
 */
export function sanitizeXmlChars(input: string): XmlText {
  let out = ''
  let dropped = 0
  for (const ch of input) {
    const cp = ch.codePointAt(0)
    if (cp !== undefined && isLegalXmlCodePoint(cp)) out += ch
    else dropped++
  }
  return { value: out, dropped }
}

/** 文本节点内容转义。`>` 无条件转义, 使 `]]>` 天然安全, 无需 CDATA。 */
export function escapeXmlText(input: string): XmlText {
  const s = sanitizeXmlChars(input)
  return {
    value: s.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    dropped: s.dropped,
  }
}

/** 属性值转义: 文本节点的三个之外, 还要处理引号与空白 (属性值归一化会改写 \t\n\r)。 */
export function escapeXmlAttr(input: string): XmlText {
  const s = sanitizeXmlChars(input)
  return {
    value: s.value
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      .replace(/\t/g, '&#9;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;'),
    dropped: s.dropped,
  }
}

/**
 * 构建上下文 —— 持有「被剔除字符」的累计数。
 *
 * 显式传入而非模块级可变状态: 构建器必须保持无副作用、可并发调用 (与
 * documentExport 的纯函数风格一致), 且每个产物的计数必须归属于该产物。
 */
export interface XmlBuildCtx {
  droppedChars: number
}

export function createXmlCtx(): XmlBuildCtx {
  return { droppedChars: 0 }
}

/** 属性值: 字符串/数字/布尔; null 与 undefined 表示「不输出该属性」 */
export type XmlAttrs = Readonly<Record<string, string | number | boolean | null | undefined>>

function renderAttrs(ctx: XmlBuildCtx, attrs?: XmlAttrs): string {
  if (!attrs) return ''
  let out = ''
  for (const [name, raw] of Object.entries(attrs)) {
    if (raw === null || raw === undefined) continue
    const text = typeof raw === 'number' ? String(raw) : typeof raw === 'boolean' ? String(raw) : raw
    const esc = escapeXmlAttr(text)
    ctx.droppedChars += esc.dropped
    out += ` ${name}="${esc.value}"`
  }
  return out
}

/** 转义后的文本子节点 (供 children 数组使用) */
export function xmlTextNode(ctx: XmlBuildCtx, text: string): string {
  const esc = escapeXmlText(text)
  ctx.droppedChars += esc.dropped
  return esc.value
}

/**
 * 组装一个元素。`children` 缺省 / 空数组 / 空串 → 自闭合形式。
 *
 * children 里的字符串必须是**已经组装好**的片段 (元素或经 xmlTextNode 转义的
 * 文本) —— 本函数不再对 children 做转义, 否则会把标记本身转义掉。
 */
export function xmlElement(
  ctx: XmlBuildCtx,
  name: string,
  attrs?: XmlAttrs,
  children?: readonly string[] | string,
): string {
  const a = renderAttrs(ctx, attrs)
  const body = typeof children === 'string' ? children : children?.join('')
  if (!body) return `<${name}${a}/>`
  return `<${name}${a}>${body}</${name}>`
}

/** XML 声明 (UTF-8)。OFD 与 CDA 分件均以它开头。 */
export function xmlDeclaration(): string {
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
}
