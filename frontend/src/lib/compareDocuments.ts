// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// compareDocuments — 版本比较的两份文档装载 (纯函数, 便于单测)
//
// 从 ComparePage 的 useEffect 里抽出来, 理由与 printJob.ts 同: 页面组件要
// 拉起整个编辑器才能测, 而这里恰恰是最容易错、也最该被钉死的部分。
//
// **必须走 DocumentLoader**: 它负责升级链路、结构校验, 并从 artifact 内嵌的
// `nodes` 扁平表重建出完整 NodePool。此前这里自己 `buildNodePool(map, …)` 且
// map 里只塞了一个根节点 —— 而 buildNodePool 只做「全量注册 + 引用完整性校验」,
// **不展开子节点**, 于是池里永远只有文档根, DocumentCompareView 读不到任何
// 正文。契约 §26 也明令: 原生加载路径只有 document/io/DocumentLoader 一条,
// 任何原生加载器都必须经它, 不得绕开。
// ============================================================

import { loadDocumentFromObject } from '@emrde/document-engine'
import type { DocumentTree, NodePool } from '@emrde/document-engine'

export interface LoadedDocument {
  doc: DocumentTree
  pool: NodePool
}

export interface ComparePair {
  old: LoadedDocument
  new: LoadedDocument
}

/**
 * 载入待比较的两份文档 (各自的 JSON 字符串)。
 *
 * 任一份解析/校验失败即抛出 —— 由调用方呈现错误, 不静默退化成空对比
 * (空对比会显示成「两份文档完全一致」, 那是最坏的一种谎报)。
 */
export function loadComparePair(oldContent: string, newContent: string): ComparePair {
  return {
    old: loadOne(oldContent),
    new: loadOne(newContent),
  }
}

function loadOne(content: string): LoadedDocument {
  const loaded = loadDocumentFromObject(JSON.parse(content))
  return { doc: loaded.doc, pool: loaded.pool }
}
