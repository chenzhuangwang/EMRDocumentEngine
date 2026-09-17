// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// 引擎错误上报落点
//
// ErrorRecovery 的三级容错默认只 console.error —— 用户侧零感知: 某页渲染失败
// 只留一张红色占位图, 没有任何说明; 导入损坏文档更是"点了没反应"。
// 这里把 reporter 接到 store, 由 StatusBar 呈现。
//
// 单独成一个模块而不是写在 main.tsx 里, 是为了**可测**: 入口文件的接线没有
// 任何测试守着, 删掉也不会有人知道 (chrome 主题 / i18n 的 bootstrap 同理,
// 但它们的落点各自有测试覆盖到)。这条链路有 `ErrorReporting.test.ts` 盯着。
// ============================================================

import { setErrorReporter } from '@/engine'
import { useEditorStore } from './store'

/**
 * 装上报落点。幂等 —— 重复调用只是把 reporter 换成同一个函数。
 *
 * 装在这一处而不是各个调用点, 保证引擎任何角落 (逐页渲染 / 文档加载 /
 * 未来新增的容错点) 报的错都有人接。
 */
export function installErrorReporter(): void {
  setErrorReporter((err) => useEditorStore.getState().reportEngineError(err))
}
