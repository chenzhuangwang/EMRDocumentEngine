// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// provenance — 导出产物的取证溯源标识 (UI 层)
//
// 目的: 导出的 HTML / TXT / JSON 副本流出后, 能追溯到「哪个项目、哪个
// 版本」的产物。这是取证备用手段, 不是防盗手段 —— 标识可被一条正则一次
// 性剥离。主层是文件头的版权声明 (见 IP-POLICY.md)。
//
// 刻意不触碰 frontend/src/engine:
//   - 不改 documentExport.ts 的纯函数 (其测试用严格全串相等断言,
//     且该模块自述为「无副作用的纯函数」)
//   - 不写入文档模型 / 格式版本 / BaseNode.metadata
//   - 因此无需修改 AI_EDITOR_CONTRACT.md, 无需抬 CURRENT_DOCUMENT_VERSION
//
// 载体是零宽字符 (Unicode Category Cf, 显示宽度为 0)。载荷为纯 ASCII,
// 故不改变渲染、布局与可见文本。
// ============================================================

import { EDITOR_VERSION } from '@/engine'

/** 标识编解码版本 */
const CODEC_VERSION = '1'

/** 版权年份与许可证 —— 与 scripts/headers.config.mjs 保持一致 */
const COPYRIGHT_YEAR = '2026'
const LICENSE_ID = 'MPL-2.0'

/** 版权主体串 (与文件头首行一致) */
export const HOLDER_PREIMAGE = 'Copyright (c) 2026 陈庄旺'

/**
 * 版权主体串的 sha256 前 8 位。
 *
 * 单向关联句柄: 用 sha256(HOLDER_PREIMAGE) 比对即可证明归属, 但泄露的
 * 标识不直接暴露法定姓名。provenance.test.ts 会校验此常量与 HOLDER_PREIMAGE 一致。
 */
export const HOLDER_HASH8 = '9a449383'

export const GENERATOR_NAME = 'EMRDocumentEngine'

/** 引擎版本串, 形如 21.0.0 (取自 engine, 单一真源) */
export const GENERATOR_VERSION =
  `${EDITOR_VERSION.major}.${EDITOR_VERSION.minor}.${EDITOR_VERSION.patch}`

// ------------------------------------------------------------
// 零宽字符字母表
//
// 必须写成转义序列, 绝不写字面不可见字符: 字面 Cf 在 review 中不可见,
// 会被某些格式化器静默剥离, 且让 grep / diff 失效。
//
// 刻意只用 2 个符号, 且排除 U+200D (ZWJ): ZWJ 天然存在于 emoji 组合序列
// (如 👨👩👧), 病历文档很可能含 emoji, 用它会让位对齐错乱。
// ------------------------------------------------------------

const ZW_ZERO = '\u200B' // ZERO WIDTH SPACE
const ZW_ONE = '\u200C' // ZERO WIDTH NON-JOINER

/** magic = "EMRDE" + 编解码版本, 用于在任意文本中定位标识起点 */
const MAGIC: readonly number[] = Object.freeze([
  0x45, 0x4d, 0x52, 0x44, 0x45, // E M R D E
  ...CODEC_VERSION.split('').map((c) => c.charCodeAt(0)),
])

/** 载荷上限: 长度前缀是单字节, 且载荷必须纯 ASCII (1 字节 = 1 字符) */
const MAX_PAYLOAD_BYTES = 127

function isAsciiPayload(s: string): boolean {
  return s.length > 0 && s.length <= MAX_PAYLOAD_BYTES && /^[\x20-\x7E]+$/.test(s)
}

// ------------------------------------------------------------
// 载荷
// ------------------------------------------------------------

/** 当前溯源载荷: `1|<holderHash8>|<year>|<licenseId>|<editorVersion>` */
export function currentProvenance(): string {
  return [CODEC_VERSION, HOLDER_HASH8, COPYRIGHT_YEAR, LICENSE_ID, GENERATOR_VERSION].join('|')
}

// ------------------------------------------------------------
// 编解码
//
// 帧结构 (长度前缀, 自定界):
//   STREAM = ASCII("EMRDE1") ++ byte(len) ++ ASCII(PAYLOAD)
// 每个字节展开为 8 个零宽字符 (高位在前)。
// ------------------------------------------------------------

/** 把载荷编码为不可见标识串 */
export function encodeMarker(payload: string = currentProvenance()): string {
  if (!isAsciiPayload(payload)) {
    throw new Error('provenance: 载荷必须是 1..127 字节的可打印 ASCII')
  }
  const bytes = [...MAGIC, payload.length, ...Array.from(payload, (c) => c.charCodeAt(0))]
  let out = ''
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) out += (byte >> i) & 1 ? ZW_ONE : ZW_ZERO
  }
  return out
}

export interface ProvenanceInfo {
  codecVersion: string
  holderHash8: string
  year: string
  licenseId: string
  generatorVersion: string
  /** 原始载荷, 便于取证时原样记录 */
  payload: string
}

/**
 * 从任意文本中提取标识。
 *
 * 扫描全部 8 个位偏移, 因此正文里偶发的零宽字符 (或有人手工插入了几个)
 * 不会破坏同步。找不到返回 null。
 */
export function decodeMarker(text: string): ProvenanceInfo | null {
  const bits: number[] = []
  for (const ch of text) {
    if (ch === ZW_ZERO) bits.push(0)
    else if (ch === ZW_ONE) bits.push(1)
  }
  if (bits.length < (MAGIC.length + 1) * 8) return null

  for (let offset = 0; offset < 8; offset++) {
    const bytes: number[] = []
    for (let i = offset; i + 8 <= bits.length; i += 8) {
      let b = 0
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]
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
// 注入
//
// 全部由 UI 边界 (EditorPage.handleExport) 调用。documentExport.ts 的
// 纯函数一个都不改 —— 其测试断言的是它们的完整输出。
// ------------------------------------------------------------

/** 可读的 <meta> 片段: 供人 / SBOM 工具直接读取 */
export function provenanceMetaTags(): string {
  return (
    `<meta name="generator" content="${GENERATOR_NAME} ${GENERATOR_VERSION}">` +
    `<meta name="emrde-provenance" content="${currentProvenance()}">`
  )
}

/** HTML 导出: head 内注入可读 meta, 正文末尾注入零宽标识 */
export function stampExportHtml(html: string): string {
  const payload = currentProvenance()
  const metas = provenanceMetaTags()

  const withMeta = html.includes('</head>')
    ? html.replace('</head>', `${metas}</head>`)
    : `${metas}${html}`

  return withMeta.includes('</body>')
    ? withMeta.replace('</body>', `${encodeMarker(payload)}</body>`)
    : `${withMeta}${encodeMarker(payload)}`
}

/** TXT 导出: 标识独占末行, 不影响正文的文字搜索 */
export function stampExportText(text: string): string {
  return `${text}\n${encodeMarker()}\n`
}

/** JSON 导出: 顶层附加 _provenance (与既有 _toc 同类的被容忍未知顶层字段) */
export function stampExportObject(serialized: Record<string, unknown>): Record<string, unknown> {
  serialized._provenance = {
    generator: `${GENERATOR_NAME} ${GENERATOR_VERSION}`,
    license: LICENSE_ID,
    copyright: HOLDER_PREIMAGE,
    token: currentProvenance(),
  }
  return serialized
}
