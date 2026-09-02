// ================================================================
// RemoveControlCommand — 删除 smarttext 控件命令 (契约 §12.1)
//
// 落地 deletable 约束的消费点: 删除一个 smarttext 控件节点 (按节点 id),
// 若该控件 TemplateDefinition.deletable === false 则拒绝删除 (锁定控件)。
//
// 与 InsertInlineNodeCommand 互为逆操作:
//   - forward: deletable 守卫 → 摘除节点并注销 (pool.removeChild)
//   - invert:  RestoreControlCommand 重建节点并插回原位
//
// 架构要点:
//   - 守卫只作用于有 TemplateDefinition 条目的 smarttext 控件;
//     deletable:false 时 forward 返回 null, 不 push 入 undo 栈。
//   - deletable:true / 无条目 / 未注入 store → 视为可删 (默认)。
//   - smarttext 是叶节点, 删除只影响该节点本身, 不动兄弟节点。
// ================================================================

import type { BaseNode } from '../../document/core/DocumentModel'
import type { CommandContext, ICommand, SerializedCommand, StatePatch } from '../ICommand'
import { generateCommandId } from '../ICommand'

export class RemoveControlCommand implements ICommand {
  readonly type = 'remove-control'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  /** 段落路径 [docId, paraId] — 控件所在段落 */
  private path: string[]
  /** 待删除的 smarttext 控件节点 id */
  private nodeId: string
  private snapshot: { node: BaseNode; index: number } | null = null

  constructor(id: string, timestamp: number, author: string, path: string[], nodeId: string) {
    this.id = id
    this.timestamp = timestamp
    this.author = author
    this.path = path
    this.nodeId = nodeId
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx

    // deletable 守卫 (契约 §12.1): deletable:false 的控件拒绝删除
    if (ctx.templateDefinitions?.get(this.nodeId)?.deletable === false) {
      return null
    }

    const paraId = this.path[this.path.length - 1]
    const para = pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
    if (!para?.children) return null

    const index = para.children.indexOf(this.nodeId)
    const node = pool.nodes.get(this.nodeId)
    if (index < 0 || !node) return null

    // 摘除并注销 (removeChild 连同其子树从 pool 移除)
    pool.removeChild(paraId, index)

    this.snapshot = { node, index }
    return {
      cursor: { paragraphPath: this.path, offset: 0, visible: true },
      invalidation: 'paragraph',
    }
  }

  invert(_ctx: CommandContext): ICommand | null {
    if (!this.snapshot) return null
    return new RestoreControlCommand(
      generateCommandId(), Date.now(), this.author,
      this.path[this.path.length - 1], this.snapshot.node, this.snapshot.index,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'remove-control', id: this.id, timestamp: this.timestamp,
      author: this.author, path: this.path,
      changes: { nodeId: this.nodeId },
    }
  }
}

/**
 * RestoreControlCommand — RemoveControlCommand 的逆操作。
 * 仅在 undo 时被临时 forward(), 不入栈, 故无需 invert。
 */
class RestoreControlCommand implements ICommand {
  readonly type = 'restore-control'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private paraId: string
  private node: BaseNode
  private index: number

  constructor(id: string, timestamp: number, author: string, paraId: string, node: BaseNode, index: number) {
    this.id = id
    this.timestamp = timestamp
    this.author = author
    this.paraId = paraId
    this.node = node
    this.index = index
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    pool.addNode(this.node)
    const len = pool.getChildren(this.paraId).length
    pool.insertChild(this.paraId, this.node.id, Math.min(this.index, len))
    return { invalidation: 'paragraph' }
  }

  serialize(): SerializedCommand {
    return { type: 'restore-control', id: this.id, timestamp: this.timestamp, author: this.author }
  }
}
