// ================================================================
// InsertControlCommand — 设计态控件库插入 (契约 §12.4)
//
// 将控件库条目 (catalog record) 落地为 SmartTextNode, 一次命令同时
// 写入两层:
//   semantic    → SmartTextNode.element (真实 dataElement 身份) +
//                 占位文本 [name] (契约 §2.1), 无 value。
//   design-time → TemplateDefinitionStore[nodeId] (§12.1): label /
//                 tips / deletable / editable / single。
//   presentation → DEFERRED (§2.2), P2 不涉及。
//
// forward:
//   (a) single 守卫 (契约 §12.4): 条目 definition.single === true
//       且文档已存在同身份 smarttext → 拒绝 (返回 null, 不入 undo 栈)。
//   (b) 创建 + 注册 SmartTextNode 并插入光标处 (复用 InsertInlineNodeCommand
//       的 resolveCharOffset 落位语义)。
//   (c) 将 definition 写入 ctx.templateDefinitions (CommandContext 携带的
//       同一 store 实例)。
// invert:
//   摘除节点 + 删除 TemplateDefinition 条目, 保证 undo 后 per-node store
//   与节点集一致, 不留孤儿定义。
// ================================================================

import type { ElementMeta, SmartTextNode } from '../../document/core/DocumentModel'
import { NodeType } from '../../document/core/DocumentModel'
import type { NodePool } from '../../document/core/NodePool'
import { createSmartTextNode } from '../../document/factory/ElementFormatter'
import { elementIdentity } from './InsertNodesCommand'
import type { TemplateDefinition } from '../../template/TemplateDefinition'
import type { CommandContext, ICommand, SerializedCommand, StatePatch } from '../ICommand'
import { generateCommandId } from '../ICommand'

export class InsertControlCommand implements ICommand {
  readonly type = 'insert-control'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private path: string[]
  private offset: number
  private element: ElementMeta
  private definition?: TemplateDefinition
  private insertedNodeId: string | null = null

  constructor(
    id: string, timestamp: number, author: string,
    path: string[], offset: number,
    element: ElementMeta, definition?: TemplateDefinition,
  ) {
    this.id = id
    this.timestamp = timestamp
    this.author = author
    this.path = path
    this.offset = offset
    this.element = element
    this.definition = definition
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    const paraId = this.path[this.path.length - 1]
    const para = pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
    if (!para?.children) return null

    // single 守卫 (契约 §12.4): 新条目 single:true 且文档已有同身份 smarttext → 拒绝。
    // 与粘贴守卫 (isSingleValueDuplicate, 键在「已存在节点」的 single 标志) 不同,
    // 这里键在「本次插入条目」的 single 标志, 且只查身份是否已存在。
    if (this.definition?.single === true && this.hasSameIdentity(pool)) {
      return null
    }

    const node = createSmartTextNode(`[${this.element.name}]`, this.element)
    pool.addNode(node)
    this.insertedNodeId = node.id

    const resolved = pool.resolveCharOffset(paraId, this.offset)
    if (resolved) {
      const idx = para.children.indexOf(resolved.textNodeId)
      if (idx >= 0) pool.insertChild(paraId, node.id, idx + 1)
      else pool.insertChild(paraId, node.id, para.children.length)
    } else {
      pool.insertChild(paraId, node.id, para.children.length)
    }

    // 写入设计期属性 (契约 §12.4): 仅当提供了 definition 且 store 已注入。
    if (this.definition && ctx.templateDefinitions) {
      ctx.templateDefinitions.set(node.id, this.definition)
    }

    return { invalidation: 'paragraph' }
  }

  /** 文档中是否已存在同身份 (dataElement 优先, 回退 internal) 的 smarttext */
  private hasSameIdentity(pool: NodePool): boolean {
    const identity = elementIdentity(this.element)
    if (!identity) return false
    for (const [, node] of pool.nodes) {
      if (node.type !== NodeType.SMART_TEXT) continue
      if (elementIdentity((node as SmartTextNode).element) === identity) return true
    }
    return false
  }

  invert(_ctx: CommandContext): ICommand | null {
    if (!this.insertedNodeId) return null
    return new UndoInsertControlCommand(
      generateCommandId(), Date.now(), this.author,
      this.path[this.path.length - 1], this.insertedNodeId,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'insert-control', id: this.id, timestamp: this.timestamp,
      author: this.author, path: this.path, offset: this.offset,
      changes: { element: this.element, definition: this.definition },
    }
  }
}

/**
 * UndoInsertControlCommand — InsertControlCommand 的逆操作。
 * 摘除插入的 smarttext 节点并删除对应 TemplateDefinition 条目 (契约 §12.4)。
 * 仅在 undo 时被临时 forward(), 不入栈, 故无需 invert。
 */
class UndoInsertControlCommand implements ICommand {
  readonly type = 'undo-insert-control'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private paraId: string
  private nodeId: string

  constructor(id: string, timestamp: number, author: string, paraId: string, nodeId: string) {
    this.id = id
    this.timestamp = timestamp
    this.author = author
    this.paraId = paraId
    this.nodeId = nodeId
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    const para = pool.nodes.get(this.paraId) as { children?: readonly string[] } | undefined
    const idx = para?.children?.indexOf(this.nodeId) ?? -1
    if (idx >= 0) pool.removeChild(this.paraId, idx)
    else pool.removeNode(this.nodeId)
    // 清理 TemplateDefinition 条目, 避免孤儿定义 (§12.4)
    ctx.templateDefinitions?.delete(this.nodeId)
    return { invalidation: 'paragraph' }
  }

  serialize(): SerializedCommand {
    return { type: 'undo-insert-control', id: this.id, timestamp: this.timestamp, author: this.author }
  }
}
