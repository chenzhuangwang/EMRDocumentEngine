// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// 测试用的最小 Node 接口声明 (只为读文件)
//
// 为什么不装 @types/node: 它会把 Node 的 `setTimeout` 返回类型 (Timeout) 注入
// 全局, 直接打崩引擎的 `LayeredRenderer.ts:295` —— "Timeout 不能赋给 number"。
// 引擎受 .claude/AI_EDITOR_CONTRACT.md 管辖, 不该为了一个测试去改它。
//
// 只声明用得上的三个函数, 且**不引入全局 `process`** (走 node:process 的具名
// 导入), 免得应用代码里 `process.xxx` 也能通过类型检查而运行时是 undefined。
// ============================================================

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string
}

declare module 'node:path' {
  export function join(...parts: string[]): string
}

declare module 'node:process' {
  export function cwd(): string
}
