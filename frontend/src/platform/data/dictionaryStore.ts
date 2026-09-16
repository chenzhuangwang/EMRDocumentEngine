// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// DictionaryStore 工厂 — 平台侧注入实现 (契约 §12.6.4)
//
// 引擎只定义 DictionaryProvider / DictionaryStore 并留出注入缝
// (Editor.setDictionaries), 候选数据的来源属平台职责 (§27: platform →
// engine 单向依赖)。本文件把 DICTIONARY_CATALOG 装进 store, 由 UI 在
// Editor 构造后注入。
//
// 替换点: 接后端时把 createDictionaryStore 改成「先 await 拉取 → 再同步
// 构建 store」即可, 引擎侧无需改动 (VR-7 允许未加载态: 未加载 → 控件
// 退回自由文本)。
// ================================================================

import { DictionaryStore } from '@/engine'
import { DICTIONARY_CATALOG } from './dictionaryCatalog'

/**
 * 用内置码表目录构建一份 DictionaryStore。
 *
 * 每次调用返回**独立实例** —— 候选是运行时状态, 不是全局单例
 * (契约 §7.6 同旨: 实例级状态, 避免跨编辑器串扰)。
 */
export function createDictionaryStore(): DictionaryStore {
  const store = new DictionaryStore()
  for (const entry of DICTIONARY_CATALOG) {
    store.set(entry.id, entry.candidates)
  }
  return store
}
