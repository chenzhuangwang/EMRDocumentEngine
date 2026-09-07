// ================================================================
// ICommand — 命令接口 + CommandContext (架构 §6.1, v20.34)
//
// 所有编辑操作封装为 ICommand, 天然支持 Undo/Redo/协作重放
// CommandContext 联合类型保证 Phase 1 (local) → Phase 2 (collab) 平滑过渡
// ================================================================

import type { DocumentTree } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'
import type { CursorState, SelectionState } from '../state/EditorRuntimeState'
import type { TemplateDefinitionStore } from '../template/TemplateDefinition'
import type { DictionaryProvider } from '../document/control/Dictionary'

// ---- CommandContext ----

export type CommandContext =
  | { mode: 'local'; doc: DocumentTree; pool: NodePool; templateDefinitions?: TemplateDefinitionStore; dictionaries?: DictionaryProvider }
  | { mode: 'collab'; ydoc: unknown; origin: string }

// ---- StatePatch ----

export type InvalidationScope =
  | 'none'
  | 'node'
  | 'paragraph'
  | 'paragraph_and_downstream'
  | 'block'
  | 'flowbody'
  | 'table'
  | 'page_setup'
  | 'full'

export interface StatePatch {
  cursor?: Partial<CursorState>
  selection?: Partial<SelectionState>
  invalidation?: InvalidationScope
}

// ---- SerializedCommand ----

export interface SerializedCommand {
  type: string
  id: string
  timestamp: number
  author: string
  path?: string[]
  offset?: number
  text?: string
  style?: Record<string, unknown>
  startOffset?: number
  endOffset?: number
  deletedText?: string
  nodeIds?: string[]
  changes?: Record<string, unknown>
  oldStyles?: Record<string, unknown>
  // SplitParagraph / MergeParagraph
  mergeTargetPath?: string[]
  deletedParaId?: string
  deletedParaSnapshot?: string
  mergeOffset?: number
  // CrossParagraphDelete
  anchorPath?: string[]
  anchorOffset?: number
  focusPath?: string[]
  focusOffset?: number
  // StateCommand
  cursor?: Partial<CursorState>
  selection?: Partial<SelectionState>
  // Allow extra fields for extensibility
  [key: string]: unknown
}

// ---- ICommand ----

export interface ICommand {
  readonly type: string
  readonly id: string
  readonly timestamp: number
  readonly author: string

  /** 统一入口 — 根据 ctx.mode 分发到 local/collab 实现 */
  forward(ctx: CommandContext): StatePatch | null

  /** 仅在 local 模式有效 — 从 forward 后的快照构造逆操作 */
  invert?(ctx: CommandContext): ICommand | null

  /** 序列化为传输载荷 (含快照: deletedText/oldStyles 等) */
  serialize(): SerializedCommand
}

// ---- MergeableCommand ----

export interface MergeableCommand extends ICommand {
  canMergeWith(other: ICommand): boolean
  /** 返回新命令（不可变），不修改 this */
  mergeWith(other: ICommand): ICommand
}

// ---- 工具 ----

let _cmdIdCounter = 0
export function generateCommandId(): string {
  return `cmd_${Date.now().toString(36)}_${(++_cmdIdCounter).toString(36)}`
}

// ================================================================
// PositionalCommand — 通用基类
// ================================================================

export abstract class PositionalCommand implements ICommand {
  abstract readonly type: string
  readonly id: string
  readonly timestamp: number
  readonly author: string
  readonly path: string[]

  constructor(id: string, timestamp: number, author: string, path: string[]) {
    this.id = id
    this.timestamp = timestamp
    this.author = author
    this.path = path
  }

  abstract forward(ctx: CommandContext): StatePatch | null
  abstract serialize(): SerializedCommand
}
