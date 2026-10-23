// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 连续输入/退格合并 (契约 §8.2，功能清单 #81)
//
// 判据: 合并后 undo 一次回到**开始之前**的状态, redo 一次回到**结束之后**;
// 不该合并的情形 (不连续 / 样式不同 / 向右删除 / 超出 500ms) 必须各占一步。
// ================================================================

import { describe, it, expect } from 'vitest'
import { CommandManager } from '../command/CommandManager'
import { EventBus } from '../interaction/EventBus'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree, TextStyle } from '../document/core/DocumentModel'
import { generateCommandId } from '../command/ICommand'
import { InsertTextCommand } from '../command/commands/InsertTextCommand'
import { DeleteRangeCommand } from '../command/commands/DeleteRangeCommand'

const STYLE: TextStyle = { font: 'SimSun', size: 16 }

function makeFixture(text = 'abcdef') {
  const doc = createDocument('merge')
  const tn = createTextNode(text, STYLE)
  const p = createParagraph([tn.id])
  doc.body.children = [p.id]
  const nodes = new Map<string, BaseNode>([
    [doc.id, doc as unknown as BaseNode],
    [tn.id, tn as unknown as BaseNode],
    [p.id, p as unknown as BaseNode],
  ])
  const pool = buildNodePool(nodes, { body: doc.id })
  const d = doc as DocumentTree
  const cm = new CommandManager(new EventBus(), () => d, () => pool)
  return { doc: d, pool, cm, paraId: p.id, textId: tn.id }
}

const textOf = (pool: ReturnType<typeof makeFixture>['pool'], id: string) =>
  (pool.nodes.get(id) as { text?: string } | undefined)?.text ?? ''

describe('连续输入合并', () => {
  it('连续追加 → 只占一步撤销; undo/redo 精确还原', () => {
    const f = makeFixture()
    const path = [f.doc.id, f.paraId]
    f.cm.execute(new InsertTextCommand(generateCommandId(), 100, 'u', path, 6, '甲', STYLE))
    f.cm.execute(new InsertTextCommand(generateCommandId(), 110, 'u', path, 7, '乙', STYLE))
    f.cm.execute(new InsertTextCommand(generateCommandId(), 120, 'u', path, 8, '丙', STYLE))

    expect(textOf(f.pool, f.textId)).toBe('abcdef甲乙丙')
    expect(f.cm.undoStack.getUndoDepth()).toBe(1)

    f.cm.undo()
    expect(textOf(f.pool, f.textId)).toBe('abcdef')
    f.cm.redo()
    expect(textOf(f.pool, f.textId)).toBe('abcdef甲乙丙')
  })

  it('不连续的两段输入不合并', () => {
    const f = makeFixture()
    const path = [f.doc.id, f.paraId]
    f.cm.execute(new InsertTextCommand(generateCommandId(), 100, 'u', path, 6, '甲', STYLE))
    f.cm.execute(new InsertTextCommand(generateCommandId(), 110, 'u', path, 0, '乙', STYLE))
    expect(f.cm.undoStack.getUndoDepth()).toBe(2)
  })

  it('样式不同不合并', () => {
    const f = makeFixture()
    const path = [f.doc.id, f.paraId]
    f.cm.execute(new InsertTextCommand(generateCommandId(), 100, 'u', path, 6, '甲', STYLE))
    f.cm.execute(new InsertTextCommand(generateCommandId(), 110, 'u', path, 7, '乙', { font: 'KaiTi', size: 16 }))
    expect(f.cm.undoStack.getUndoDepth()).toBe(2)
  })

  it('超出 500ms 窗口不合并 (栈的既有判定)', () => {
    const f = makeFixture()
    const path = [f.doc.id, f.paraId]
    f.cm.execute(new InsertTextCommand(generateCommandId(), 100, 'u', path, 6, '甲', STYLE))
    f.cm.execute(new InsertTextCommand(generateCommandId(), 1000, 'u', path, 7, '乙', STYLE))
    expect(f.cm.undoStack.getUndoDepth()).toBe(2)
  })
})

describe('连续退格合并', () => {
  it('向左连续删除 → 只占一步; undo/redo 精确还原', () => {
    const f = makeFixture()
    const path = [f.doc.id, f.paraId]
    // 先删 f [5,6), 再删 e [4,5) —— 光标向左走
    f.cm.execute(new DeleteRangeCommand(generateCommandId(), 100, 'u', path, 5, 6))
    f.cm.execute(new DeleteRangeCommand(generateCommandId(), 110, 'u', path, 4, 5))

    expect(textOf(f.pool, f.textId)).toBe('abcd')
    expect(f.cm.undoStack.getUndoDepth()).toBe(1)

    f.cm.undo()
    expect(textOf(f.pool, f.textId)).toBe('abcdef')
    f.cm.redo()
    expect(textOf(f.pool, f.textId)).toBe('abcd')
  })

  it('不相邻的两次删除不合并', () => {
    const f = makeFixture()
    const path = [f.doc.id, f.paraId]
    f.cm.execute(new DeleteRangeCommand(generateCommandId(), 100, 'u', path, 5, 6))
    f.cm.execute(new DeleteRangeCommand(generateCommandId(), 110, 'u', path, 2, 3))
    expect(f.cm.undoStack.getUndoDepth()).toBe(2)
  })

  it('向右删除 (范围相同) 不合并 —— 合并会少删一个字', () => {
    const f = makeFixture()
    const path = [f.doc.id, f.paraId]
    // Delete 键: 删除后字符前移, 第二次仍是 [0,1)
    f.cm.execute(new DeleteRangeCommand(generateCommandId(), 100, 'u', path, 0, 1))
    f.cm.execute(new DeleteRangeCommand(generateCommandId(), 110, 'u', path, 0, 1))
    expect(textOf(f.pool, f.textId)).toBe('cdef')
    expect(f.cm.undoStack.getUndoDepth()).toBe(2)

    f.cm.undo()
    expect(textOf(f.pool, f.textId)).toBe('bcdef')
    f.cm.undo()
    expect(textOf(f.pool, f.textId)).toBe('abcdef')
  })
})
