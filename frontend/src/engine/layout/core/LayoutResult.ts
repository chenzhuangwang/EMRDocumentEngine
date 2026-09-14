// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// LayoutResult — 布局结果 (v21.0 抽取)
//
// 职责: LayoutEngine 全量/增量布局的输出类型别名。
//       当前实现 = SLIFPage[], 未来可能包装 metadata (耗时/缓存命中/版本号等)。
//
// 独立文件原因: 让 LayoutEngine.ts 自身不必承担"结果是什么"的定义。
//              调用方可以单独 import { LayoutResult } 不必 import SLIFPage[]。
// ================================================================

import type { SLIFPage } from './SLIF'

/** 布局结果 — LayoutEngine.fullLayout / incrementalLayout 的返回类型 */
export type LayoutResult = SLIFPage[]
