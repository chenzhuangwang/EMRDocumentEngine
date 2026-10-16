// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

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

    // 设计期属性里**有一个字段确实是布局的输入: formula** (§12.12.8)。它算出的
    // 显示文本既决定控件盒宽也决定折行 (与值走同一条 smarttextLayoutHint), 所以
    // 改了公式**必须重排** —— 否则症状是"改了公式, 页面没反应": 作者在配置弹框里
    // 改完、点了应用, 页面上还是旧值, 直到别的原因碰上一次重排。作者化面就靠这一次
    // 重排才看得见效果 (§12.12.9)。
    //
    // 判据只认 formula, 且**两侧取公式本身** (不是"条目在不在"): 给一个原本没有
    // 定义表的控件加上 controlType/label 仍是 'none' (与今天一致), 而加上/改掉/
    // 删掉一条公式都是 'flowbody' —— 公式的出现与消失同样要重排。
    // label / prefix / suffix 与 controlType **刻意不进这个判据** —— 契约 §12.5
    // 明写附属字面量是 draw-time overlay, "their layout interaction (wrapping, width
    // contribution) is DEFERRED", 而 ControlLayoutHint 今天就已按它们扣减盒宽。
    // 这条不一致是**既有偏差, 本批不顺手改**: 改它等于替 §12.5 拍板, 得先把那句
    // 契约改掉 (同理 §11 的"第二份实现")。其余字段 (deletable/editable/tips/single)
    // 是命令层守卫的输入, 与布局无关, 仍走 'none' (§12.1)。
    const layoutRelevant = this.old?.formula !== this.next?.formula
    return { invalidation: layoutRelevant ? 'flowbody' : 'none' }
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
