// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// outlineModel — 大纲投影 (纯函数, 契约 §31.14)
//
// 输入 W2/W4/R1 与 TOCGenerator 的条目, 输出大纲面板的行模型。
// 抽成纯函数是为了能脱离 DOM 单测 —— 这里踩过两个真实缺陷:
//
//   1. **空节点击崩溃**: 占位条目曾把 Section id 写进 `paragraphPath` 的段落槽
//      (`[docId, sectionId]`), 违反 CursorState"末元素必须是文本容器"的铁律 →
//      光标解析不出来, 不画 caret 也不滚动。现在节行**只带 sectionId**,
//      `paragraphPath` 只在真有段落时才有值。
//
//   2. **顺序错误**: 占位条目曾用 `findIndex(anchor)` 插到锚点标题之前; 锚点不是
//      标题时 (节内首段是正文段落) 退回 `push`, 于是这一节被扔到大纲**末尾**。
//      现在按**真结构树**前序遍历发出, 节行天然落在它内容之前。
//
// 遍历用的是结构树入口 `pool.getChildren(doc.id)` (契约 §31.1 唯一入口),
// 不是逻辑流 —— 大纲需要节边界, 而 W2/W3 恰恰把节展开掉了 (契约 §31.1)。
// ============================================================

import { TOCGenerator } from '@emrde/document-engine'
import type { DocumentTree } from '@emrde/document-engine'
import type { OutlineItem } from './OutlineNav'

/** 大纲投影所需的最小只读池视图 (结构树 + 节点类型) */
export interface OutlinePool {
  nodes: ReadonlyMap<string, {
    type: string
    children?: readonly string[]
    outlineLevel?: number
    sectionCode?: string
  }>
  getChildren(parentId: string): readonly string[]
}

export interface BuildOutlineOptions {
  /** 匿名节的显示名 (由调用方注入 i18n 文案, 纯函数不挂 hook) */
  anonymousSectionLabel: string
}

/**
 * 构建大纲行模型。
 *
 * 顺序 = **真结构树前序**: body 的直接子节点按文档顺序走一遍;
 * 遇到 Section 先发节行, 再递归它的内容 (故节行永远在它的内容之前);
 * 遇到标题段落发标题行 (文本/级别/页码全部复用 TOCGenerator, 不重复实现)。
 *
 * 表内段落不参与 (与 TOC 口径一致 —— W3 才展开表格, 大纲不走 W3)。
 */
export function buildOutlineItems(
  doc: DocumentTree,
  pool: OutlinePool,
  pageMap: Map<string, number> | undefined,
  opts: BuildOutlineOptions,
): OutlineItem[] {
  const tocGen = new TOCGenerator({ maxLevel: 6 })
  const headingById = new Map(
    tocGen.extractEntries(doc, pool as never, pageMap).map((e) => [e.paragraphId, e]),
  )

  const out: OutlineItem[] = []
  const seen = new Set<string>()

  const emit = (containerId: string, sectionDepth: number): void => {
    for (const id of pool.getChildren(containerId)) {
      if (seen.has(id)) continue
      seen.add(id)
      const node = pool.nodes.get(id)
      if (!node) continue

      if (node.type === 'section') {
        const anchor = firstParagraphUnder(id, pool)
        out.push({
          id,
          // 空节没有段落 → 路径留空 (**绝不能**把节 id 塞进段落槽)
          paragraphPath: anchor ? [doc.id, anchor] : [],
          // 节与标题共用一套缩进刻度: 顶层节 = 1, 子节 = 2 …
          level: sectionDepth + 1,
          text: node.sectionCode || opts.anonymousSectionLabel,
          pageIndex: anchor ? (pageMap?.get(anchor) ?? -1) : -1,
          kind: 'section',
          sectionId: id,
          sectionCode: node.sectionCode,
        })
        emit(id, sectionDepth + 1)
        continue
      }

      const entry = headingById.get(id)
      if (!entry) continue
      out.push({
        id: entry.paragraphId,
        paragraphPath: [doc.id, entry.paragraphId],
        level: entry.level,
        text: entry.text,
        pageIndex: entry.pageNumber - 1,
      })
    }
  }

  emit(doc.id, 0)
  return out
}

/** 节内首个段落 id (前序深搜, 不下潜非段落容器以外的分支); 空节 → null */
function firstParagraphUnder(sectionId: string, pool: OutlinePool): string | null {
  const stack = [...pool.getChildren(sectionId)]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const id = stack.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const node = pool.nodes.get(id)
    if (!node) continue
    if (node.type === 'paragraph') return id
    if (node.children) stack.push(...node.children)
  }
  return null
}
