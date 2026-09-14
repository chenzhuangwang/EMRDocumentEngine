// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// MacroCommand + CommandManager 事务 (RULE 11: 原子复合操作)
//
// 验证多子命令操作 (如剪切 = 复制 + 跨段落删除) 折叠为单个
// undo 单元:
//   - MacroCommand.forward 顺序应用子命令, 聚合 patch invalidation 为 'full'
//   - MacroCommand.invert 逆序应用子命令的 invert
//   - CommandManager.beginMacro/endMacro 将事务内多条命令合并为一个入栈项
//   - undo 一次即回滚整个复合操作 (单步撤销)
// ============================================================

import { describe, it, expect } from 'vitest'
import { MacroCommand } from '../command/commands/MacroCommand'
import { CommandManager } from '../command/CommandManager'
import { EventBus } from '../interaction/EventBus'
import type { ICommand, CommandContext, StatePatch } from '../command/ICommand'
import type { DocumentTree } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'

// ---- 记录型假命令: forward 推入标签, invert 返回撤销命令 ----

interface JournalEntry { op: string }

class JournalCommand implements ICommand {
  readonly type = 'journal'
  constructor(
    readonly id: string,
    readonly timestamp: number,
    readonly author: string,
    private journal: JournalEntry[],
    private label: string,
    private inverseLabel: string,
  ) {}

  forward(_ctx: CommandContext): StatePatch | null {
    this.journal.push({ op: this.label })
    return { invalidation: 'paragraph' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    return new JournalCommand(
      `${this.id}_inv`, this.timestamp, this.author,
      this.journal, this.inverseLabel, this.label,
    )
  }

  serialize() { return { type: this.type, id: this.id, timestamp: this.timestamp, author: this.author } }
}

const LOCAL_CTX = { mode: 'local', doc: {} as DocumentTree, pool: {} as NodePool } as CommandContext

describe('MacroCommand — 复合命令 (RULE 11)', () => {
  it('forward 顺序应用子命令, 返回 invalidation: full', () => {
    const journal: JournalEntry[] = []
    const children: ICommand[] = [
      new JournalCommand('a', 1, 'u', journal, 'first', '~first'),
      new JournalCommand('b', 2, 'u', journal, 'second', '~second'),
    ]
    const macro = new MacroCommand('m', 3, 'u', children)

    const patch = macro.forward(LOCAL_CTX)

    expect(journal).toEqual([{ op: 'first' }, { op: 'second' }])
    expect(patch).toEqual({ invalidation: 'full' })
  })

  it('invert 逆序生成子命令逆操作并打包为 MacroCommand', () => {
    const journal: JournalEntry[] = []
    const children: ICommand[] = [
      new JournalCommand('a', 1, 'u', journal, 'first', '~first'),
      new JournalCommand('b', 2, 'u', journal, 'second', '~second'),
    ]
    const macro = new MacroCommand('m', 3, 'u', children)

    const inverse = macro.invert(LOCAL_CTX)
    expect(inverse).toBeInstanceOf(MacroCommand)

    // 逆操作按逆序执行: ~second 先于 ~first
    journal.length = 0
    inverse!.forward(LOCAL_CTX)
    expect(journal).toEqual([{ op: '~second' }, { op: '~first' }])
  })

  it('serialize 递归序列化子命令', () => {
    const journal: JournalEntry[] = []
    const macro = new MacroCommand('m', 3, 'u', [
      new JournalCommand('a', 1, 'u', journal, 'first', '~first'),
      new JournalCommand('b', 2, 'u', journal, 'second', '~second'),
    ])
    const s = macro.serialize()
    expect(s.type).toBe('macro')
    expect(Array.isArray(s.children)).toBe(true)
    expect((s.children as unknown[]).length).toBe(2)
  })
})

describe('CommandManager 事务 — 原子撤销 (RULE 11)', () => {
  function makeManager(journal: JournalEntry[]) {
    const bus = new EventBus()
    const manager = new CommandManager(
      bus,
      () => ({} as DocumentTree),
      () => ({} as NodePool),
    )
    const make = (label: string, inv: string) =>
      new JournalCommand(label, Date.now(), 'user', journal, label, inv)
    return { manager, make }
  }

  it('beginMacro/endMacro 将多条命令合并为单个 undo 单元', () => {
    const journal: JournalEntry[] = []
    const { manager, make } = makeManager(journal)

    manager.beginMacro()
    manager.execute(make('del-1', '~del-1'))
    manager.execute(make('del-2', '~del-2'))
    manager.execute(make('merge', '~merge'))
    manager.endMacro()

    expect(manager.undoStack.getUndoDepth()).toBe(1)
    expect(journal).toEqual([{ op: 'del-1' }, { op: 'del-2' }, { op: 'merge' }])
  })

  it('undo 一次即回滚整个复合操作', () => {
    const journal: JournalEntry[] = []
    const { manager, make } = makeManager(journal)

    manager.beginMacro()
    manager.execute(make('del-1', '~del-1'))
    manager.execute(make('del-2', '~del-2'))
    manager.endMacro()

    manager.undo()

    // 复合操作整体撤销: 逆序 ~del-2 先于 ~del-1, 且 redo 栈记录的是单个 macro
    expect(journal).toEqual([
      { op: 'del-1' }, { op: 'del-2' },
      { op: '~del-2' }, { op: '~del-1' },
    ])
    expect(manager.undoStack.getUndoDepth()).toBe(0)
    expect(manager.redo()).not.toBeNull()
  })

  it('无子命令的空事务不产生 undo 单元', () => {
    const journal: JournalEntry[] = []
    const { manager } = makeManager(journal)

    manager.beginMacro()
    manager.endMacro()

    expect(manager.undoStack.getUndoDepth()).toBe(0)
  })
})
