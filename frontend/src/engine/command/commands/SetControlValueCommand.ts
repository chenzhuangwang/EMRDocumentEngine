// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// SetControlValueCommand — 运行时控件值写入命令 (契约 §12.6, VR-3)
//
// 运行时值写入的唯一原语 (VR-3): 所有 SmartTextNode.value 变更都必须
// 经本命令, 由其统一走 validateControlValue 做 值类型/值域 (layer A) 与
// 写权限 (layer B) 校验, 非法值 (含写锁) 直接拒绝 → forward 返回 null,
// 不突变、不入 undo 栈 (CommandManager 在 patch 为 null 时跳过)。
//
// 职责边界 (契约 §12.6.2): 只回答「这是合法运行时值吗, 且可写吗」。
//   绝不触碰 layer C (required/dictionary/business/QC) 或 layer D
//   (showType/minRows/dictionary 展开/searchable/exclusive 表现)。
//   dictionary 是外部引用 (VR-7), 本命令不做隐式展开。
//
// 规范空态 (契约 §12.6.1): undefined = 清空。归一化后为空 (undefined/
// ''/[]) 一律写 undefined; 序列化时 JSON.stringify 丢弃 undefined 键,
// 与「缺失 value 字段」等价。
// ================================================================

import type { ControlValue, SmartTextNode } from '../../document/core/DocumentModel'
import { NodeType } from '../../document/core/DocumentModel'
import { validateControlValue } from '../../document/control/ControlValue'
import type { ControlValuePermissions } from '../../document/control/ControlValue'
import type { CommandContext, ICommand, SerializedCommand, StatePatch } from '../ICommand'
import { generateCommandId } from '../ICommand'

export class SetControlValueCommand implements ICommand {
  readonly type = 'set-control-value'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  readonly nodeId: string
  /** 候选运行时值 (规范态: undefined = 清空) */
  readonly nextValue: ControlValue | undefined

  /** forward 时快照的旧值, 供 invert 恢复 (缺省 = 原为空) */
  private _oldValue: ControlValue | undefined = undefined

  constructor(
    id: string,
    timestamp: number,
    author: string,
    nodeId: string,
    nextValue: ControlValue | undefined,
  ) {
    this.id = id
    this.timestamp = timestamp
    this.author = author
    this.nodeId = nodeId
    this.nextValue = nextValue
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    const node = pool.nodes.get(this.nodeId) as SmartTextNode | undefined
    if (!node || node.type !== NodeType.SMART_TEXT) return null

    // B 写权限 (VR-8): TemplateDefinition.editable 由命令层解出后注入
    const permissions: ControlValuePermissions = {
      editable: ctx.templateDefinitions?.get(this.nodeId)?.editable,
    }

    // VR-7: 外部字典引用 → 候选 (同步解析; 未加载 = 不展开 = 自由文本)
    const dictionaryId = node.element.format?.dictionary
    const dictionaryCandidates = dictionaryId
      ? ctx.dictionaries?.resolve(dictionaryId)
      : undefined

    const result = validateControlValue(this.nextValue, node.element, permissions, dictionaryCandidates)
    if (!result.ok) return null // 非法值: 无突变, 不入 undo 栈

    this._oldValue = node.value
    const normalized = result.value

    // 清空 (undefined) 与有值统一经 updateNode/deleteNodeField。
    // 规范空态 (契约 §12.6.1): undefined = 字段缺失。deleteNodeField 真正删除
    // value 键 (区别于 updateNode 的 Object.assign 会留下 value: undefined 自有键)。
    if (normalized === undefined) {
      pool.deleteNodeField(this.nodeId, 'value')
    } else {
      pool.updateNode(this.nodeId, { value: normalized } as Partial<SmartTextNode>)
    }

    return { invalidation: 'flowbody' }
  }

  invert(ctx: CommandContext): ICommand | null {
    if (ctx.mode !== 'local') return null
    return new SetControlValueCommand(
      generateCommandId(), Date.now(), this.author,
      this.nodeId, this._oldValue,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'set-control-value', id: this.id, timestamp: this.timestamp,
      author: this.author, changes: { nodeId: this.nodeId, value: this.nextValue },
    }
  }
}
