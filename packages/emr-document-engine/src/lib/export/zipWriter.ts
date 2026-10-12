// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// zipWriter — OFD 容器打包 (导出特性层)
//
// 底座是 fflate 的 zipSync (MIT)。为什么不自写 ZIP: 本机**没有任何 OFD
// 阅读器**, 容器框架写错无法自查 —— 自写的 CRC32/中央目录偏移错了, 症状是
// 「7-Zip 能开、阅读器打不开」, 只能靠外部工具事后发现。fflate 让容器这一层
// 变成已被广泛验证的代码, 并把 unzipSync 留给测试做**独立实现**的交叉验证
// (自写 ZIP + 自写读法会共享同一批盲点)。
//
// 确定性: mtime 由调用方固定传入, 同一输入必须产出逐字节相同的包 —— 这既是
// 可复现构建的前提, 也是将来签章 (签名必须绑定稳定的字节) 的前提。
// 因此本模块**绝不**读 Date.now()。
// ============================================================

import { zipSync } from 'fflate'

export interface ZipEntry {
  /** 包内路径, 用 `/` 分隔 (ZIP 规范要求, 不是 `\`) */
  name: string
  data: Uint8Array | string
  /** true = STORED (不压缩)。OFD 入口文件用 */
  store?: boolean
}

export interface ZipOptions {
  /** 包内所有条目统一的修改时间 —— 固定值, 保证字节稳定 */
  mtime: Date
}

const encoder = new TextEncoder()

function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === 'string' ? encoder.encode(data) : data
}

/**
 * 打包为 ZIP 字节流。
 *
 * 条目顺序 = 传入顺序 (fflate 保持对象键的插入顺序)。OFD 的入口文件需排在
 * 最前且不压缩, 这是调用方的责任, 本模块不重排 —— 重排会隐藏调用方的错误。
 *
 * 重名条目直接抛错: ZIP 以路径为键, 重名会让后一条**静默覆盖**前一条,
 * 而「少了一个分件」在阅读器里表现为内容缺失而不是报错 (契约 §31.5)。
 *
 * mtime 超出 ZIP 的 DOS 时间区间同样直接抛错, 理由同上: fflate 内部会抛一个
 * 只有数字码的 `err(10)`, 从依赖栈里冒出来时看不出是哪个入参的问题 —— 在边界
 * 上换成指名道姓的一句话。区间与 fflate 判据一致 (见其 dostime):
 *
 *     y = 本地年份 - 1980,  0 <= y <= 119  即 1980..2099
 *
 * 按**本地时间**取年份, 故 1980-01-01T00:00Z 这类下界值在西半球会退到 1979 ——
 * 固定 mtime 应取区间中段, 不要贴着端点。
 */
export function buildZip(entries: readonly ZipEntry[], opts: ZipOptions): Uint8Array {
  const year = new Date(opts.mtime).getFullYear()
  if (!(year >= 1980 && year <= 2099)) {
    throw new Error(
      `buildZip: mtime must fall within 1980-2099 (ZIP DOS timestamp range), got ${opts.mtime.toISOString()} (local year ${year})`,
    )
  }
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.name)) {
      throw new Error(`buildZip: duplicate entry name "${entry.name}"`)
    }
    seen.add(entry.name)
    files[entry.name] = [toBytes(entry.data), { level: entry.store ? 0 : 6 }]
  }
  return zipSync(files, { mtime: opts.mtime })
}
