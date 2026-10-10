// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

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

import type { ElementMeta, SmartTextNode, TextNode } from '../../document/core/DocumentModel'
import { NodeType } from '../../document/core/DocumentModel'
import type { NodePool } from '../../document/core/NodePool'
import { createSmartTextNode, createTextNode, extractStyle } from '../../document/factory/ElementFormatter'
import { elementIdentity } from './InsertNodesCommand'
import { MintedOnce } from './MintedNodes'
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
  /** 铸造一次台账 (契约 §8.3) */
  private mint = new MintedOnce()

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

    // 落点解析每次 forward 都做 (undo 已还原段落, 结果与首次一致);
    // 铸造只在首次做 (契约 §8.3)。
    const resolved = pool.resolveCharOffset(paraId, this.offset)
    const target = resolved ? pool.nodes.get(resolved.textNodeId) : undefined
    const idx = resolved ? para.children.indexOf(resolved.textNodeId) : -1
    const textTarget = idx >= 0 && target && (target as unknown as { type?: string }).type === 'text'
      ? (target as unknown as TextNode)
      : undefined
    const lo = resolved ? resolved.localOffset : 0
    // 段内偏移落在文本中间 → 需先拆分文本节点, 否则控件会落到整个文本 run 之后 (行尾)
    const splitsMiddle = !!textTarget && lo > 0 && lo < textTarget.text.length

    // 铸造一次 (契约 §8.3): 控件节点与拆出的后半段文本在 redo 时复用同一批 id。
    const roots = this.mint.run(pool, () => {
      const n = createSmartTextNode(`[${this.element.name}]`, this.element)
      pool.addNode(n)
      const ids = [n.id]
      if (splitsMiddle && textTarget) {
        const afterNode = createTextNode(textTarget.text.slice(lo), extractStyle(textTarget))
        pool.addNode(afterNode)
        ids.push(afterNode.id)
      }
      return ids
    })
    const nodeId = roots[0]
    const afterNodeId: string | undefined = roots.length > 1 ? roots[1] : undefined
    this.insertedNodeId = nodeId

    // 落位 —— 每次 forward 都做
    if (textTarget && splitsMiddle && afterNodeId) {
      pool.updateNode(textTarget.id, { text: textTarget.text.slice(0, lo) } as Partial<TextNode>)
      pool.insertChildren(paraId, [nodeId, afterNodeId], idx + 1)
    } else if (textTarget) {
      // 文本首/尾 → 控件插到文本前/后
      pool.insertChild(paraId, nodeId, idx + (lo === 0 ? 0 : 1))
    } else if (idx >= 0) {
      // 内联非文本节点 (image/field/smarttext 等) → localOffset 0=前, 1=后
      pool.insertChild(paraId, nodeId, idx + (lo >= 1 ? 1 : 0))
    } else {
      pool.insertChild(paraId, nodeId, para.children.length)
    }

    // 写入设计期属性 (契约 §12.4): 仅当提供了 definition 且 store 已注入。
    // 每次 forward 都写 —— undo 会删掉该条目, 重放必须补回 (幂等)。
    if (this.definition && ctx.templateDefinitions) {
      ctx.templateDefinitions.set(nodeId, this.definition)
    }

    // 光标放到控件「之后」(offset+1, 控件=1 原子字符): 插入后可直接在控件
    // 末尾继续输入, 而不是停在控件前 (契约 §12.6 运行时交互)。
    return {
      cursor: { paragraphPath: this.path, offset: this.offset + 1, visible: true },
      invalidation: 'paragraph',
    }
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
