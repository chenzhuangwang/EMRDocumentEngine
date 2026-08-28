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
import { CommandUndoRedoStack } from './CommandUndoRedoStack'
import type { EventBus } from '../interaction/EventBus'
import type { DocumentTree } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'
import { DirtyTracker } from '../layout/incremental/DirtyTracker'

export class CommandManager {
  readonly undoStack: CommandUndoRedoStack
  readonly dirtyTracker: DirtyTracker
  private eventBus: EventBus
  private getDocument: () => DocumentTree
  private getPool: () => NodePool

  constructor(
    eventBus: EventBus,
    getDocument: () => DocumentTree,
    getPool: () => NodePool,
  ) {
    this.eventBus = eventBus
    this.getDocument = getDocument
    this.getPool = getPool
    this.undoStack = new CommandUndoRedoStack(100)
    this.dirtyTracker = new DirtyTracker()
  }

  execute(command: ICommand): void {
    const ctx: CommandContext = {
      mode: 'local',
      doc: this.getDocument(),
      pool: this.getPool(),
    }

    const patch = this.undoStack.execute(command, ctx)
    if (!patch) return

    this.emitDocumentChange(patch)
  }

  undo(): void {
    const ctx: CommandContext = {
      mode: 'local',
      doc: this.getDocument(),
      pool: this.getPool(),
    }
    const patch = this.undoStack.undo(ctx)
    if (patch) this.emitDocumentChange(patch)
  }

  redo(): void {
    const ctx: CommandContext = {
      mode: 'local',
      doc: this.getDocument(),
      pool: this.getPool(),
    }
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
