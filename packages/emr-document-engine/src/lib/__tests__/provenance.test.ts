// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// provenance — 取证溯源标识
//
// 关键回归点:
//   - 标识必须是纯不可见字符, 且不得改变用户所见内容
//   - 正文里天然存在零宽字符 (引擎的 LineBreaker / FontFallback 就用
//     ZWSP 做换行机会), 解码必须能重同步
//   - 源码里绝不允许出现「字面」不可见字符, 只允许转义序列
//
// 本文件刻意「一个不可见字符字面量都不写」: 全部由码点构造, 这样
// 测试自身不会成为它所要禁止的那种文件。
// ============================================================

import { describe, it, expect } from 'vitest'

import {
  HOLDER_HASH8,
  HOLDER_PREIMAGE,
  currentProvenance,
  decodeMarker,
  encodeMarker,
  stampExportHtml,
  stampExportObject,
  stampExportText,
} from '../provenance'
import provenanceSource from '../provenance.ts?raw'

const BS = String.fromCharCode(92) // 反斜杠, 由码点构造以免本文件出现转义序列
const ch = (code: number) => String.fromCharCode(code)

const ZW_ZERO = ch(0x200b)
const ZW_ONE = ch(0x200c)
const ZW_ALL = [ZW_ZERO, ZW_ONE]

/** 不可见字符黑名单 (码点), 用于源代码卫生检查 */
const FORBIDDEN_CODES = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff])

/** 去掉全部零宽标识字符 */
function stripInvisible(s: string): string {
  let out = s
  for (const z of ZW_ALL) out = out.split(z).join('')
  return out
}

// 用 Web Crypto 而非 node:crypto —— 前端 tsconfig 只有 DOM lib, 未装 @types/node
async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

describe('provenance 编解码', () => {
  it('往返一致', () => {
    const payload = currentProvenance()
    const info = decodeMarker(encodeMarker(payload))
    expect(info).not.toBeNull()
    expect(info!.payload).toBe(payload)
  })

  it('载荷字段可解析', () => {
    const info = decodeMarker(encodeMarker())
    expect(info).not.toBeNull()
    expect(info!.codecVersion).toBe('1')
    expect(info!.year).toBe('2026')
    expect(info!.licenseId).toBe('MPL-2.0')
    expect(info!.generatorVersion).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('标识本身不含任何可见字符', () => {
    expect(stripInvisible(encodeMarker())).toBe('')
  })

  // 与 scripts/verify-provenance.mjs 共用的夹具: 两侧实现必须对同一载荷产出
  // 同一位串。夹具写成可见的 '0'/'1' 字符串而非零宽字面量 —— 既便于 grep 与
  // review, 也不会把本文件变成它自己要禁止的那种文件。
  it('编码位串与 verify-provenance.mjs 的共享夹具一致', () => {
    const FIXTURE_PAYLOAD = '1|9a449383|2026|MPL-2.0|21.0.0'
    const FIXTURE_BITS =
      '01000101010011010101001001000100010001010011000100011110001100010111110000111001011000010011010000110100001110010011001100111000001100110111110000110010001100000011001000110110011111000100110101010000010011000010110100110010001011100011000001111100001100100011000100101110001100000010111000110000'
    const bits = [...encodeMarker(FIXTURE_PAYLOAD)]
      .map((c) => (c === ZW_ONE ? '1' : '0'))
      .join('')
    expect(bits).toBe(FIXTURE_BITS)
  })

  it('正文里已有零宽字符时仍能提取 (8 位偏移重同步)', () => {
    // 引擎 LineBreaker / FontFallback 天然会产生 ZWSP
    const noise = ZW_ZERO.repeat(3)
    const text = `患者姓名：张三${noise}${encodeMarker()}结尾`
    expect(decodeMarker(text)!.licenseId).toBe('MPL-2.0')
  })

  it('零宽字符插在标识之前也不破坏解码', () => {
    const text = `${encodeMarker()}${ZW_ZERO}${ZW_ONE}${ZW_ZERO}`
    expect(decodeMarker(text)!.licenseId).toBe('MPL-2.0')
  })

  it('无标识的普通文本返回 null', () => {
    expect(decodeMarker('普通正文, 没有任何标识')).toBeNull()
    expect(decodeMarker('')).toBeNull()
  })

  it('拒绝非 ASCII 或超长载荷', () => {
    expect(() => encodeMarker('中文载荷')).toThrow()
    expect(() => encodeMarker('')).toThrow()
    expect(() => encodeMarker('x'.repeat(128))).toThrow()
  })

  it('holderHash8 与版权主体串一致 (可据此证明归属)', async () => {
    const expected = (await sha256Hex(HOLDER_PREIMAGE)).slice(0, 8)
    expect(HOLDER_HASH8).toBe(expected)
  })

  it('源码正文不含字面不可见字符, 只允许转义序列', () => {
    const offenders = [...provenanceSource]
      .map((c) => c.codePointAt(0)!)
      .filter((code) => FORBIDDEN_CODES.has(code))
    expect(offenders).toEqual([])
    expect(provenanceSource).toContain(`${BS}u200B`)
    expect(provenanceSource).toContain(`${BS}u200C`)
  })
})

describe('provenance 导出注入', () => {
  it('TXT: 正文原样保留, 标识独占末行', () => {
    const stamped = stampExportText('只有正文')
    expect(stripInvisible(stamped)).toBe('只有正文\n\n')
    expect(decodeMarker(stamped)!.licenseId).toBe('MPL-2.0')
  })

  it('TXT: 不打断正文的文字搜索', () => {
    expect(stampExportText('患者姓名: 张三')).toContain('患者姓名: 张三')
  })

  it('HTML: meta 注入 head, 标识注入 body 末尾', () => {
    const html =
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>T</title></head><body><p>正文</p></body></html>'
    const stamped = stampExportHtml(html)
    expect(stamped).toContain('<meta name="generator"')
    expect(stamped).toContain('name="emrde-provenance"')
    expect(stamped.indexOf('emrde-provenance')).toBeLessThan(stamped.indexOf('</head>'))
    expect(stamped.indexOf('</body>')).toBeGreaterThan(stamped.indexOf('<p>正文</p>'))
    expect(decodeMarker(stamped)!.licenseId).toBe('MPL-2.0')
  })

  it('HTML: 去除注入后与原文逐字节一致 (不改变用户所见)', () => {
    const html =
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>T</title></head><body><p>正文</p></body></html>'
    const visible = stripInvisible(
      stampExportHtml(html)
        .replace(/<meta name="generator"[^>]*>/, '')
        .replace(/<meta name="emrde-provenance"[^>]*>/, ''),
    )
    expect(visible).toBe(html)
  })

  it('JSON: 顶层附加 _provenance, 既有字段不受影响', () => {
    const obj: Record<string, unknown> = { type: 'document', id: 'doc-1', _toc: [] }
    const out = stampExportObject(obj)
    expect(out.type).toBe('document')
    expect(out.id).toBe('doc-1')
    expect(out._toc).toEqual([])
    const prov = out._provenance as Record<string, unknown>
    expect(prov.license).toBe('MPL-2.0')
    expect(prov.token).toBe(currentProvenance())
  })
})
