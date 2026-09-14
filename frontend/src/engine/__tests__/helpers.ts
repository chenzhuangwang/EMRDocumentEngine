// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// 测试桩 — 共享的 host / measurer / clipboard (P5 DI)
// ============================================================
//
// 引擎不再有全局 host 注册表后, 各测试通过此处集中构造依赖并注入,
// 避免在每个测试文件重复 createDomEditorHost() / new TextMeasurer()。

import { createDomEditorHost } from '../../platform/dom'
import { FontManager } from '../layout/text/FontManager'
import { TextMeasurer } from '../layout/text/TextMeasurer'
import type { ClipboardHost } from '../host/EditorHost'

export const testHost = createDomEditorHost()
export const testMeasurer = new TextMeasurer(testHost, new FontManager(testHost))
export const noopClipboard: ClipboardHost = {
  writeText: async () => {},
  readText: async () => '',
  canRead: () => false,
}
