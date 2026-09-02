// ================================================================
// UpdateControlDefinitionCommand — 设计态控件属性就地编辑 (契约 §12.5)
//
// 编辑选中控件的 TemplateDefinition 属性 (§12.1) —— 仅改写 per-editor
// store 里该 nodeId 的设计期属性, 不改 SmartTextNode.element/.value,
// 不新建/删除节点, 不进 DocumentModel。
//
// forward: 快照旧值 old → 整体替换 (next 为 undefined 或空对象 → 删条目;
//           否则 store.set)。
// invert:  复用自身 (同 SetPageSetupCommand): 逆操作把 def 恢复为 old
//           (old 为 undefined → 删条目; 否则 set(old)), 精确还原。
//
// 守卫 (§12.5):
//   - nodeId 必须引用已存在的 smarttext 节点, 否则 forward 返回 null
//     (不入 undo 栈), 防止定义孤儿挂到不存在/非控件节点上。
//   - 未注入 store → no-op (返回 null)。
// ================================================================

import { NodeType } from '../../document/core/DocumentModel'
import type { TemplateDefinition } from '../../template/TemplateDefinition'
import type { CommandContext, ICommand, SerializedCommand, StatePatch } from '../ICommand'
import { generateCommandId } from '../ICommand'

export class UpdateControlDefinitionCommand implements ICommand {
  readonly type = 'update-control-definition'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private nodeId: string
  private next?: TemplateDefinition
  /** forward 时快照的旧值; null 表示「原本无条目」 */
  private old: TemplateDefinition | null = null

  constructor(
    id: string, timestamp: number, author: string,
    nodeId: string, next?: TemplateDefinition,
  ) {
    this.id = id
    this.timestamp = timestamp
    this.author = author
    this.nodeId = nodeId
    this.next = next
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    const store = ctx.templateDefinitions
    if (!store) return null

    // 守卫: 节点必须存在且是 smarttext (契约 §12.5), 否则拒绝
    const node = pool.nodes.get(this.nodeId)
    if (!node || node.type !== NodeType.SMART_TEXT) return null

    this.old = store.get(this.nodeId) ?? null
    const hasFields = !!this.next && Object.keys(this.next).length > 0
    if (hasFields) store.set(this.nodeId, this.next!)
    else store.delete(this.nodeId)

    // 设计期属性不参与布局重排 (label/prefix/suffix 为 draw-time overlay,
    // 其余为命令层守卫), invalidation 'none' (§12.5)。仍走命令系统, 触发
    // markDirty 与 templateDefinitions 持久化 (§12.1)。
    return { invalidation: 'none' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    // 复用自身作为逆操作: 恢复为旧值 (old 为 null → 删条目; 否则 set(old))
    return new UpdateControlDefinitionCommand(
      generateCommandId(), Date.now(), this.author,
      this.nodeId, this.old ?? undefined,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'update-control-definition', id: this.id, timestamp: this.timestamp,
      author: this.author, changes: { nodeId: this.nodeId, definition: this.next },
    }
  }
}
