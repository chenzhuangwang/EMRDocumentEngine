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
//     → undoStack.execute(cmd, ctx)
//     → eventBus.emit('document:changed', {invalidation, dirtyNodeIds: []})
//     → eventBus.emit('state:changed', patch)
//
// dirtyNodeIds 恒为空数组: 唯一的脏区来源曾是 DirtyTracker, 它已于
// 2026-10-21 作为死 API 删除 (增量布局以键/缓存未命中为唯一事实源)。
// 字段保留只为事件载荷形状兼容。
// ================================================================

import type { ICommand, CommandContext, StatePatch } from './ICommand'
import { generateCommandId } from './ICommand'
import { CommandUndoRedoStack } from './CommandUndoRedoStack'
import { MacroCommand } from './commands/MacroCommand'
import type { EventBus } from '../interaction/EventBus'
import type { DocumentTree } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'
import type { TemplateDefinitionStore } from '../template/TemplateDefinition'
import type { DictionaryProvider } from '../document/control/Dictionary'
import type { RevisionContext } from '../revision/Revision'
import { NO_REVISION } from '../revision/Revision'

/**
 * 插件命令钩子 —— 只声明本模块需要的那两项, 不 import plugins/ 的类型
 * (command/ 是底层域, 不该反向依赖特征层 PluginsManager)。
 */
export interface CommandHooks {
  emitCommandBefore(cmd: unknown): void
  emitCommandAfter(cmd: unknown): void
}

export class CommandManager {
  readonly undoStack: CommandUndoRedoStack
  private eventBus: EventBus
  private getDocument: () => DocumentTree
  private getPool: () => NodePool
  private getTemplateDefinitions: () => TemplateDefinitionStore | undefined
  private getDictionaries: () => DictionaryProvider | undefined
  private getPluginHooks: () => CommandHooks | undefined
  /**
   * 修订上下文工厂 (契约 §12.13) — 每次执行取一次, `at` 因此是"这次执行的时刻"。
   * 命令不得直接读 Editor 状态 (§12.13 的单一盖戳点)。
   */
  private getRevisionContext: () => RevisionContext
  /** 事务栈 — beginMacro/endMacro 间收集的子命令 (RULE 11) */
  private macroStack: ICommand[][] = []

  constructor(
    eventBus: EventBus,
    getDocument: () => DocumentTree,
    getPool: () => NodePool,
    getTemplateDefinitions: () => TemplateDefinitionStore | undefined = () => undefined,
    getDictionaries: () => DictionaryProvider | undefined = () => undefined,
    getPluginHooks: () => CommandHooks | undefined = () => undefined,
    getRevisionContext: () => RevisionContext = () => NO_REVISION,
  ) {
    this.eventBus = eventBus
    this.getDocument = getDocument
    this.getPool = getPool
    this.getTemplateDefinitions = getTemplateDefinitions
    this.getDictionaries = getDictionaries
    this.getPluginHooks = getPluginHooks
    this.getRevisionContext = getRevisionContext
    this.undoStack = new CommandUndoRedoStack(100)
  }

  private buildContext(): CommandContext {
    return {
      mode: 'local',
      doc: this.getDocument(),
      pool: this.getPool(),
      templateDefinitions: this.getTemplateDefinitions(),
      dictionaries: this.getDictionaries(),
      revision: this.getRevisionContext(),
    }
  }

  execute(command: ICommand): void {
    // 插件命令钩子 (契约 §12): 环绕命令执行。放在 finally 里保证即使 forward
    // 抛错也会通知 —— 否则插件会看到"只有 before 没有 after"的错位生命周期。
    const hooks = this.getPluginHooks()
    hooks?.emitCommandBefore(command)
    try {
      this.runCommand(command)
    } finally {
      hooks?.emitCommandAfter(command)
    }
  }

  /** execute 的执行体 (命令钩子由 execute 环绕, 此处只管命令本身) */
  private runCommand(command: ICommand): void {
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
    this.eventBus.emit('state:changed', patch)

    this.eventBus.emit('document:changed', {
      invalidation: patch.invalidation ?? 'paragraph',
      // 恒为空: DirtyTracker 已删除, 脏区不再是事实源 (见文件头注释)
      dirtyNodeIds: [],
    })

    if (patch.cursor) this.eventBus.emit('cursor:moved', {
      paragraphPath: [],
      offset: 0,
      visible: true,
      ...patch.cursor,
    })
  }
}
