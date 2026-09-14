// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// CommandManager — 命令编排器 (架构 §6.5, v20.34)
//
// 四条流水线汇合点:
//   CommandManager.execute(cmd)
//     → cmd.forward(ctx) → StatePatch
//     → dispatchInvalidation(invalidation) → DirtyTracker
//     → undoStack.execute(cmd, ctx)
//     → eventBus.emit('document:changed', {invalidation, dirtyNodeIds})
//     → eventBus.emit('state:changed', patch)
// ================================================================

import type { ICommand, InvalidationScope, CommandContext, StatePatch } from './ICommand'
import { generateCommandId } from './ICommand'
import { CommandUndoRedoStack } from './CommandUndoRedoStack'
import { MacroCommand } from './commands/MacroCommand'
import type { EventBus } from '../interaction/EventBus'
import type { DocumentTree } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'
import type { TemplateDefinitionStore } from '../template/TemplateDefinition'
import type { DictionaryProvider } from '../document/control/Dictionary'
import { DirtyTracker } from '../layout/incremental/DirtyTracker'

export class CommandManager {
  readonly undoStack: CommandUndoRedoStack
  readonly dirtyTracker: DirtyTracker
  private eventBus: EventBus
  private getDocument: () => DocumentTree
  private getPool: () => NodePool
  private getTemplateDefinitions: () => TemplateDefinitionStore | undefined
  private getDictionaries: () => DictionaryProvider | undefined
  /** 事务栈 — beginMacro/endMacro 间收集的子命令 (RULE 11) */
  private macroStack: ICommand[][] = []

  constructor(
    eventBus: EventBus,
    getDocument: () => DocumentTree,
    getPool: () => NodePool,
    getTemplateDefinitions: () => TemplateDefinitionStore | undefined = () => undefined,
    getDictionaries: () => DictionaryProvider | undefined = () => undefined,
  ) {
    this.eventBus = eventBus
    this.getDocument = getDocument
    this.getPool = getPool
    this.getTemplateDefinitions = getTemplateDefinitions
    this.getDictionaries = getDictionaries
    this.undoStack = new CommandUndoRedoStack(100)
    this.dirtyTracker = new DirtyTracker()
  }

  private buildContext(): CommandContext {
    return {
      mode: 'local',
      doc: this.getDocument(),
      pool: this.getPool(),
      templateDefinitions: this.getTemplateDefinitions(),
      dictionaries: this.getDictionaries(),
    }
  }

  execute(command: ICommand): void {
    const ctx = this.buildContext()

    const macro = this.macroStack[this.macroStack.length - 1]
    if (macro) {
      // 事务内: 立即 forward (mutate + emit), 收集子命令, 不推入 undo 栈 (RULE 11)
      const patch = command.forward(ctx)
      if (patch) {
        macro.push(command)
        this.emitDocumentChange(patch)
      }
      return
    }

    const patch = this.undoStack.execute(command, ctx)
    if (!patch) return

    this.emitDocumentChange(patch)
  }

  /** 开始事务 — 之后 execute 的命令被收集, 直到 endMacro 合并为单个 undo 单元 */
  beginMacro(): void {
    this.macroStack.push([])
  }

  /** 结束事务 — 将收集的子命令打包为 MacroCommand 入栈 (单个 undo 单元) */
  endMacro(): void {
    const children = this.macroStack.pop()
    if (!children || children.length === 0) return
    const macro = new MacroCommand(generateCommandId(), Date.now(), 'user', children)
    this.undoStack.push(macro)
    // 补发 state:changed 以同步历史投影 (undoDepth/canUndo): 子命令在事务内已各自
    // emit document:changed, 但当时 macro 尚未入栈, Editor 的 history 投影会滞后;
    // 此处补一次信号让 store.history 反映真实栈深 (RULE 9 单一栈 owner)。
    this.eventBus.emit('state:changed', {})
  }

  undo(): void {
    const ctx = this.buildContext()
    const patch = this.undoStack.undo(ctx)
    if (patch) this.emitDocumentChange(patch)
  }

  redo(): void {
    const ctx = this.buildContext()
    const patch = this.undoStack.redo(ctx)
    if (patch) this.emitDocumentChange(patch)
  }

  canUndo(): boolean { return this.undoStack.canUndo() }
  canRedo(): boolean { return this.undoStack.canRedo() }

  /**
   * 文档变更统一通知 — execute / undo / redo 三条路径共用 (契约 §8.2 / RULE 8)。
   * 顺序关键: 先失效传播 + 光标状态, 再触发 document:changed,
   * 确保 commitDocumentChange 里的 render() 使用最新光标位置。
   */
  private emitDocumentChange(patch: StatePatch): void {
    this.dispatchInvalidation(patch.invalidation ?? 'paragraph')

    this.eventBus.emit('state:changed', patch)

    this.eventBus.emit('document:changed', {
      invalidation: patch.invalidation ?? 'paragraph',
      dirtyNodeIds: [...this.dirtyTracker.getDirtyNodeIds()],
    })

    if (patch.cursor) this.eventBus.emit('cursor:moved', {
      paragraphPath: [],
      offset: 0,
      visible: true,
      ...patch.cursor,
    })
  }

  private dispatchInvalidation(scope: InvalidationScope): void {
    switch (scope) {
      case 'none': break
      case 'node': break  // node-level handled by markNodeDirty externally
      case 'paragraph':
      case 'paragraph_and_downstream':
        break  // paragraph dirty marked by command
      case 'block':
      case 'flowbody':
      case 'table':
      case 'page_setup':
      case 'full':
        this.dirtyTracker.markFullLayout()
        break
    }
  }
}
