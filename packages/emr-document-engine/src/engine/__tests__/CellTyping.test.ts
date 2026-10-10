// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// CellTyping — 表格单元格内输入回归测试
//
// 复现并防止: 段落 children 引用了未注册进 pool 的 text 节点
// (insertTable 旧 bug), 导致 resolveCharOffset 返回悬空引用,
// InsertTextCommand 静默吞掉输入 → 症状为「光标不向后移动、
// 输入无文字/行为异常」。
// ============================================================

import { describe, it, expect } from 'vitest'
import { InsertTextCommand } from '../command/commands/InsertTextCommand'
import {
  createDocument, createParagraph, createTextNode,
  createTable, createTableRow, createTableCell,
} from '../document/factory/ElementFormatter'
import { buildNodePool } from '../document/core/NodePool'
import type { BaseNode, Paragraph, TextNode } from '../document/core/DocumentModel'

/** 拼接段落内所有 text 节点的文本 */
function paraText(pool: ReturnType<typeof buildNodePool>, para: Paragraph): string {
  return para.children
    .map(id => pool.nodes.get(id))
    .filter((n): n is TextNode => n?.type === 'text')
    .map(n => n.text)
    .join('')
}

describe('cell 内输入 (InsertTextCommand)', () => {
  it('完整池: 连续输入文本 + 光标 offset 递增', () => {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)

    const tn = createTextNode('')
    const para = createParagraph([tn.id])
    const cell = createTableCell([para.id])
    const row = createTableRow([cell])
    const table = createTable([{ width: 200, mode: 'fixed' }], [row])
    for (const n of [tn, para, cell, row, table]) allNodes.set(n.id, n as unknown as BaseNode)
    doc.body.children = [table.id]
    const pool = buildNodePool(allNodes, { body: doc.id })

    const ctx = { mode: 'local' as const, doc, pool }
    let offset = 0
    for (const ch of ['你', '好', '世', '界']) {
      const patch = new InsertTextCommand(`c${ch}`, 1, 'user', [doc.id, para.id], offset, ch).forward(ctx)!
      expect(patch.cursor!.offset).toBe(offset + 1)
      offset = patch.cursor!.offset!
    }
    expect(paraText(pool, para)).toBe('你好世界')
    expect(offset).toBe(4)
  })

  it('悬空 text 引用: 输入仍插入文字并清理孤儿 id (防御性修复)', () => {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)

    // 模拟 insertTable 旧 bug: 段落 children 引用了未注册进 pool 的 text id
    const danglingTextId = 'orphan_text'
    const para = createParagraph([danglingTextId])
    const cell = createTableCell([para.id])
    const row = createTableRow([cell])
    const table = createTable([{ width: 200, mode: 'fixed' }], [row])
    for (const n of [para, cell, row, table]) allNodes.set(n.id, n as unknown as BaseNode)
    // 注意: danglingTextId 未注册进 pool
    doc.body.children = [table.id]
    const pool = buildNodePool(allNodes, { body: doc.id })

    const ctx = { mode: 'local' as const, doc, pool }
    const patch = new InsertTextCommand('c1', 1, 'user', [doc.id, para.id], 0, '你').forward(ctx)!

    expect(patch.cursor!.offset).toBe(1)
    expect(paraText(pool, para)).toBe('你')
    // 悬空 id 已被清理, 后续输入不再被吞
    expect(para.children.includes(danglingTextId)).toBe(false)

    // 第二次输入应继续正常追加
    const patch2 = new InsertTextCommand('c2', 1, 'user', [doc.id, para.id], 1, '好').forward(ctx)!
    expect(patch2.cursor!.offset).toBe(2)
    expect(paraText(pool, para)).toBe('你好')
  })
})
