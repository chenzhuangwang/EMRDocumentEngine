// ============================================================
// 命令系统 — ICommand 接口 + CommandManager
// 符合 Spec TASK-202: 基于 ICommand 命令模式的 undo/redo
// ============================================================

import type { IElement } from '../document/DocumentModel'
import { ZoneType } from '../document/DocumentModel'

// ---- Zone 快照 (命令的 undo/redo 数据载体) ----

export interface ZoneSnapshot {
  header: IElement[]
  main: IElement[]
  footer: IElement[]
  cursorIndex: number
  activeZone: ZoneType
}

// ---- ICommand 接口 ----

export interface ICommand {
  /** 反向操作：撤销此命令对文档的修改 */
  undo(ctx: ICommandContext): void
  /** 正向操作：重新应用此命令对文档的修改 */
  redo(ctx: ICommandContext): void
  /** 可读描述 (调试用) */
  readonly description: string
}

// ---- 命令上下文 (Command 通过此接口操作 Draw 状态) ----

export interface ICommandContext {
  get headerElements(): IElement[]
  set headerElements(els: IElement[])
  get mainElements(): IElement[]
  set mainElements(els: IElement[])
  get footerElements(): IElement[]
  set footerElements(els: IElement[])
  get cursorIndex(): number
  set cursorIndex(idx: number)
  get activeZone(): ZoneType
  set activeZone(zone: ZoneType)
  /** 清除控件/单元格焦点（undo/redo 后引用失效） */
  clearFocused(): void
}

// ---- CommandManager — 命令栈管理器 ----

export class CommandManager {
  private undoStack: ICommand[] = []
  private redoStack: ICommand[] = []
  private maxRecords: number

  constructor(maxRecords: number = 100) {
    this.maxRecords = maxRecords
  }

  /** 执行命令并将其压入撤销栈 (命令应已通过 ctx 应用了效果) */
  push(command: ICommand): void {
    this.undoStack.push(command)
    if (this.undoStack.length > this.maxRecords) {
      this.undoStack.shift()
    }
    // 新命令使重做栈失效
    this.redoStack = []
  }

  /** 撤销最近一条命令 */
  undo(ctx: ICommandContext): ICommand | null {
    const cmd = this.undoStack.pop()
    if (!cmd) return null
    this.redoStack.push(cmd)
    cmd.undo(ctx)
    return cmd
  }

  /** 重做最近一条撤销的命令 */
  redo(ctx: ICommandContext): ICommand | null {
    const cmd = this.redoStack.pop()
    if (!cmd) return null
    this.undoStack.push(cmd)
    cmd.redo(ctx)
    return cmd
  }

  canUndo(): boolean { return this.undoStack.length > 0 }
  canRedo(): boolean { return this.redoStack.length > 0 }

  getUndoCount(): number { return this.undoStack.length }
  getRedoCount(): number { return this.redoStack.length }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }
}
