// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// verify-provenance.mjs — 取证验证工具
//
// 给定一个疑似外流的导出文件 (HTML / TXT / JSON), 提取并解码溯源标识,
// 并尽可能关联回仓库与提交。
//
// 用法:
//   node scripts/verify-provenance.mjs <file>      验证文件
//   node scripts/verify-provenance.mjs -           从 stdin 读取
//   node scripts/verify-provenance.mjs --selftest  自检 (不读文件)
//
// 放在仓库根的 scripts/ 而非 frontend/src/ 下: Vite 的打包图从
// frontend/index.html 开始, scripts/ 不可达, 因此本工具既不会被
// 打进产物, 也不会增加发布体积。
//
// 与 frontend/src/lib/provenance.ts 的关系: 两边都实现了同一套编解码。
// 为了不让两份实现漂移, 双方都被钉在同一个「可见的」FIXTURE_BITS 上
// (frontend 侧断言编码结果 == FIXTURE_BITS, 本工具在 --selftest 中断言
// 同样的等式)。刻意不引入跨目录 import: frontend 打包边界之外的文件
// 不应被 Vite 打包图引用。
// ============================================================

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')

// ------------------------------------------------------------
// 编解码 (与 frontend/src/lib/provenance.ts 同构)
//
// 用 String.fromCharCode 而非字面量或转义序列: 这是本文件唯一需要
// 不可见字符的地方, 由码点构造可保证源码里不存在任何字面不可见字符。
// ------------------------------------------------------------

const ZW_ZERO = String.fromCharCode(0x200b) // ZERO WIDTH SPACE
const ZW_ONE = String.fromCharCode(0x200c) // ZERO WIDTH NON-JOINER

const CODEC_VERSION = '1'
const MAGIC = Object.freeze([
  0x45, 0x4d, 0x52, 0x44, 0x45, // E M R D E
  ...CODEC_VERSION.split('').map((c) => c.charCodeAt(0)),
])
const MAX_PAYLOAD_BYTES = 127

function isAsciiPayload(s) {
  return s.length > 0 && s.length <= MAX_PAYLOAD_BYTES && /^[\x20-\x7E]+$/.test(s)
}

function toBits(marker) {
  let bits = ''
  for (const ch of marker) {
    if (ch === ZW_ZERO) bits += '0'
    else if (ch === ZW_ONE) bits += '1'
  }
  return bits
}

function bitsToMarker(bits) {
  let out = ''
  for (const b of bits) out += b === '1' ? ZW_ONE : ZW_ZERO
  return out
}

function encodeMarker(payload) {
  if (!isAsciiPayload(payload)) throw new Error('载荷必须是 1..127 字节的可打印 ASCII')
  const bytes = [...MAGIC, payload.length, ...[...payload].map((c) => c.charCodeAt(0))]
  let bits = ''
  for (const b of bytes) {
    for (let i = 7; i >= 0; i--) bits += (b >> i) & 1 ? '1' : '0'
  }
  return bitsToMarker(bits)
}

/** 从任意文本中提取标识; 扫描 8 个位偏移以容忍正文中已有的零宽字符 */
function decodeMarker(text) {
  const bits = toBits(text)
  if (bits.length < (MAGIC.length + 1) * 8) return null

  for (let offset = 0; offset < 8; offset++) {
    const bytes = []
    for (let i = offset; i + 8 <= bits.length; i += 8) {
      let b = 0
      for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] === '1' ? 1 : 0)
      bytes.push(b)
    }

    for (let s = 0; s + MAGIC.length + 1 <= bytes.length; s++) {
      if (!MAGIC.every((m, k) => bytes[s + k] === m)) continue
      const len = bytes[s + MAGIC.length]
      const body = bytes.slice(s + MAGIC.length + 1, s + MAGIC.length + 1 + len)
      if (body.length < len) continue

      const payload = String.fromCharCode(...body)
      if (!isAsciiPayload(payload)) continue

      const parts = payload.split('|')
      if (parts.length < 5) continue
      const [codecVersion, holderHash8, year, licenseId, generatorVersion] = parts
      return { codecVersion, holderHash8, year, licenseId, generatorVersion, payload }
    }
  }
  return null
}

// ------------------------------------------------------------
// 共享夹具: 两边实现必须对同一载荷产出同一位串
// ------------------------------------------------------------

const FIXTURE_PAYLOAD = '1|9a449383|2026|MPL-2.0|21.0.0'
const FIXTURE_BITS =
  '01000101010011010101001001000100010001010011000100011110001100010111110000111001011000010011010000110100001110010011001100111000001100110111110000110010001100000011001000110110011111000100110101010000010011000010110100110010001011100011000001111100001100100011000100101110001100000010111000110000'

function selftest() {
  const encoded = toBits(encodeMarker(FIXTURE_PAYLOAD))
  const okEncode = encoded === FIXTURE_BITS
  const decoded = decodeMarker(bitsToMarker(FIXTURE_BITS))
  const okDecode =
    decoded !== null &&
    decoded.payload === FIXTURE_PAYLOAD &&
    decoded.licenseId === 'MPL-2.0' &&
    decoded.holderHash8 === '9a449383'

  console.log('自检:')
  console.log(`  编码 == FIXTURE_BITS          ${okEncode ? '✓' : '✗'}`)
  console.log(`  解码 FIXTURE_BITS == 原载荷   ${okDecode ? '✓' : '✗'}`)
  if (!okEncode) console.log(`    实际: ${encoded}`)
  if (!okDecode) console.log(`    实际: ${JSON.stringify(decoded)}`)

  if (okEncode && okDecode) {
    console.log('\n✓ 编解码自检通过 (与 frontend/src/lib/provenance.ts 共用同一夹具)')
    process.exit(0)
  }
  console.error('\n✖ 编解码自检失败 —— 两侧实现已漂移')
  process.exit(1)
}

// ------------------------------------------------------------
// 主流程
// ------------------------------------------------------------

function git(args) {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--selftest')) selftest()

  const target = args.find((a) => !a.startsWith('--'))
  if (!target) {
    console.error('用法: node scripts/verify-provenance.mjs <file>|- [--selftest]')
    process.exit(2)
  }

  let text
  let label
  if (target === '-') {
    text = readFileSync(0, 'utf8')
    label = '<stdin>'
  } else {
    const abs = path.resolve(target)
    try {
      text = readFileSync(abs, 'utf8')
    } catch (err) {
      console.error(`✖ 读取失败: ${err.message}`)
      process.exit(2)
    }
    label = abs
  }

  console.log(`文件: ${label}`)
  console.log('')

  // 1. 零宽标识
  const info = decodeMarker(text)
  if (info) {
    console.log('零宽标识: 已检出')
    console.log(`  载荷            ${info.payload}`)
    console.log(`  编解码版本      ${info.codecVersion}`)
    console.log(`  版权主体哈希    ${info.holderHash8}`)
    console.log(`  年份            ${info.year}`)
    console.log(`  许可证          ${info.licenseId}`)
    console.log(`  引擎版本        ${info.generatorVersion}`)
  } else {
    console.log('零宽标识: 未检出 (可能被下游工具剥离, 或被刻意删除)')
  }
  console.log('')

  // 2. 可读 meta
  const metaRe = /<meta\s+name="(generator|emrde-provenance)"\s+content="([^"]*)"/gi
  const metas = [...text.matchAll(metaRe)]
  if (metas.length) {
    console.log('可读 meta:')
    for (const m of metas) console.log(`  ${m[1]} = ${m[2]}`)
  } else {
    console.log('可读 meta: 未检出')
  }
  console.log('')

  // 3. JSON 导出的 _provenance
  if (text.trimStart().startsWith('{') && text.includes('_provenance')) {
    console.log('JSON _provenance: 已检出 (见文件内 _provenance 字段)')
    console.log('')
  }

  // 4. 文件自带的许可证头
  const spdxLine = text
    .split(/\r?\n/, 15)
    .find((l) => l.includes('SPDX-License-Identifier:'))
  console.log(spdxLine ? `许可证头: ${spdxLine.trim()}` : '许可证头: 未检出 (前 15 行内无 SPDX 标识)')
  console.log('')

  // 5. 与仓库提交关联
  if (target !== '-') {
    const blob = git(['hash-object', path.resolve(target)])
    if (blob) {
      console.log(`blob sha1: ${blob}`)
      const hit = git(['log', '--all', '--format=%H %ai %an', '-1', `--find-object=${blob}`])
      console.log(hit ? `关联提交: ${hit}` : '关联提交: 未在本仓库找到相同内容的提交 (内容已被改动)')
    }
  }
  console.log('')

  const verdict = info
    ? 'MARKER FOUND'
    : metas.length > 0
      ? 'MARKER STRIPPED (可读 meta 尚存: 标识被剥离, 但来源仍可证)'
      : spdxLine
        ? 'HEADER ONLY'
        : 'NO PROVENANCE'
  console.log(`VERDICT: ${verdict}`)
}

main()
