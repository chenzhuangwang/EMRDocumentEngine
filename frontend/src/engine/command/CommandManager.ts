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

import type { ICommand, InvalidationScope, CommandContext } from './ICommand'
import { CommandUndoRedoStack } from './CommandUndoRedoStack'
import type { EventBus } from '../interaction/EventBus'
import type { DocumentTree } from '../document/DocumentModel'
import type { NodePool } from '../document/NodePool'
import { DirtyTracker } from '../layout/DirtyTracker'

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

    // 失效传播 (v20.22 强制映射)
    this.dispatchInvalidation(patch.invalidation ?? 'paragraph')

    // 顺序关键: 先更新光标状态, 再触发重布局+重绘
    // 确保 document:changed 触发的 render() 使用的是最新光标位置
    this.eventBus.emit('state:changed', patch)

    this.eventBus.emit('document:changed', {
      invalidation: patch.invalidation ?? 'paragraph',
      dirtyNodeIds: [...this.dirtyTracker.getDirtyNodeIds()],
    })

    // 光标变更单独通知
    if (patch.cursor) this.eventBus.emit('cursor:moved', {
      paragraphPath: [],
      offset: 0,
      visible: true,
      ...patch.cursor,
    })
  }

  undo(): void {
    const ctx: CommandContext = {
      mode: 'local',
      doc: this.getDocument(),
      pool: this.getPool(),
    }
    const patch = this.undoStack.undo(ctx)
    if (patch) {
      this.eventBus.emit('state:changed', patch)
      this.eventBus.emit('render:request')
    }
  }

  redo(): void {
    const ctx: CommandContext = {
      mode: 'local',
      doc: this.getDocument(),
      pool: this.getPool(),
    }
    const patch = this.undoStack.redo(ctx)
    if (patch) {
      this.eventBus.emit('state:changed', patch)
      this.eventBus.emit('render:request')
    }
  }

  canUndo(): boolean { return this.undoStack.canUndo() }
  canRedo(): boolean { return this.undoStack.canRedo() }

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
