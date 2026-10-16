// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// SetBoundValuesCommand — 批量按键写入控件值 (契约 §12.10.2 / §12.10.3)
//
// 形状照 ReplaceTextCommand (契约明文指定的先例):
//   - 整批**一个 undo 单元**: 内部对每个节点直调 SetControlValueCommand.forward,
//     不把 N 条命令逐个入栈;
//   - 自带 _restore 快照, invert 返回内部的 RestoreBoundValuesCommand;
//   - 部分成功是合法结果, 但必须可判定 —— _rejected 携带机器可读理由,
//     由 Editor.setBoundValues 回传 (非静默失败, 与 replaceAll 同口径)。
//
// VR-3 (运行时值写入唯一路径) 不变: 本命令**不**直接写 pool, 一切实际写入
// 都经由 SetControlValueCommand.forward。
//
// 预校验与 SetControlValueCommand 内部那次校验是**同一次调用语义**
// (同源 permissions/dictionary 候选, 同一函数): 预校验只为拿到**理由码**
// 以便回报, 真正落盘仍由 SetControlValueCommand 决定。这与 ReplaceTextCommand
// 的 coerceSmartReplacement 后接 SetControlValueCommand.forward 完全同形。
//
// 本命令**不做**键解析、不碰投影、不做歧义判定 —— 那是 Editor 层的事:
// 键 → 节点 的解析必须与**读方向**同一份投影 (§12.10.2), 故在 Editor 里
// 一次性算出后, 只把「已定到唯一节点」的条目交给本命令。
// ================================================================

import type { ControlValue, SmartTextNode } from '../../document/core/DocumentModel'
import { NodeType } from '../../document/core/DocumentModel'
import { validateControlValue } from '../../document/control/ControlValue'
import type { ControlValuePermissions, ControlValueRejectReason } from '../../document/control/ControlValue'
import { SetControlValueCommand } from './SetControlValueCommand'
import type { CommandContext, ICommand, SerializedCommand, StatePatch } from '../ICommand'
import { generateCommandId } from '../ICommand'

/** 一条待写入项 (键已解析到唯一节点) */
export interface BoundWriteEntry {
  /** 绑定键 —— 只用于回报, 不参与写入决策 */
  key: string
  nodeId: string
  /** 外部传来的原值; 任何类型转换都被拒绝 (契约 §12.10.3 无强制转换) */
  value: ControlValue | undefined
}

/** 一条被拒绝的写入 (契约 §12.10.3: 携带理由, 非静默丢弃) */
export interface BoundWriteRejection {
  key: string
  reason: ControlValueRejectReason
}

/** 一条实际写入 (value = 归一化后的规范值, 可能与传入值不同, 如 checkbox 顺序) */
export interface BoundWriteApplied {
  key: string
  nodeId: string
  value: ControlValue | undefined
}

/** 一键多节点 (契约 §12.10.2) —— 这些键**一个都不写**, 只回报候选供实施方区分 */
export interface BoundWriteAmbiguous {
  key: string
  candidateNodeIds: string[]
}

/**
 * 批量写入结果 (契约 §12.10.3)。
 * 部分成功是**合法结果**, 但四个桶必须齐全 —— 静默丢弃一个键是临床安全问题。
 */
export interface BoundValuesWriteResult {
  /** 实际写入的条目 (已归一化) */
  applied: BoundWriteApplied[]
  /** 被校验拒绝的条目 (携带机器可读理由, 不猜测、不转换) */
  rejected: BoundWriteRejection[]
  /** 键命中了多个节点 → 一个都没写 */
  ambiguous: BoundWriteAmbiguous[]
  /** 文档里没有该键, 或该键是空串 (无规范身份 → 不可寻址) */
  unmatched: string[]
}

export class SetBoundValuesCommand implements ICommand {
  readonly type = 'set-bound-values'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  readonly entries: readonly BoundWriteEntry[]

  /** forward 时快照的旧值, 供 invert 恢复 */
  private _restore: Array<{ nodeId: string; oldValue: ControlValue | undefined }> = []
  /** forward 时记录的拒绝明细 (非静默失败) */
  private _rejected: BoundWriteRejection[] = []
  /** forward 时记录的实际写入 */
  private _applied: BoundWriteApplied[] = []

  constructor(id: string, timestamp: number, author: string, entries: readonly BoundWriteEntry[]) {
    this.id = id
    this.timestamp = timestamp
    this.author = author
    this.entries = entries
  }

  /** forward 后读取被拒绝的写入明细 (空 = 全部成功) */
  get rejected(): readonly BoundWriteRejection[] { return this._rejected }

  /** forward 后读取实际写入明细 */
  get applied(): readonly BoundWriteApplied[] { return this._applied }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx

    this._restore = []
    this._rejected = []
    this._applied = []

    for (const e of this.entries) {
      const node = pool.nodes.get(e.nodeId) as SmartTextNode | undefined
      if (!node || node.type !== NodeType.SMART_TEXT) {
        this._rejected.push({ key: e.key, reason: 'type_mismatch' })
        continue
      }

      // 与 SetControlValueCommand 同源: B 写权限 (VR-8) + 字典候选 (VR-7)
      const permissions: ControlValuePermissions = {
        editable: ctx.templateDefinitions?.get(e.nodeId)?.editable,
      }
      const dictionaryId = node.element.format?.dictionary
      const dictionaryCandidates = dictionaryId
        ? ctx.dictionaries?.resolve(dictionaryId)
        : undefined

      const check = validateControlValue(e.value, node.element, permissions, dictionaryCandidates)
      if (!check.ok) {
        this._rejected.push({ key: e.key, reason: check.reason })
        continue
      }

      const oldValue = node.value
      // VR-3: 实际写入的唯一路径
      const cmd = new SetControlValueCommand(
        generateCommandId(), Date.now(), this.author, e.nodeId, check.value,
      )
      if (cmd.forward(ctx) === null) {
        // 预校验通过但命令仍拒绝: 只可能是节点在两读之间消失 —— 罕见, 但仍回报
        this._rejected.push({ key: e.key, reason: 'type_mismatch' })
        continue
      }
      this._restore.push({ nodeId: e.nodeId, oldValue })
      this._applied.push({ key: e.key, nodeId: e.nodeId, value: check.value })
    }

    // 一个都没写 → 不产生 undo 条目 (契约 §12.10.3 空批不入栈)
    if (this._restore.length === 0) return null

    // 整批可跨区域 (正文/页眉/页脚): 与 SetControlValueCommand 同取 flowbody
    return { invalidation: 'flowbody' }
  }

  invert(ctx: CommandContext): ICommand | null {
    if (ctx.mode !== 'local') return null
    if (this._restore.length === 0) return null
    return new RestoreBoundValuesCommand(
      generateCommandId(), Date.now(), this.author, this._restore,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'set-bound-values', id: this.id, timestamp: this.timestamp,
      author: this.author, changes: { entries: this.entries },
    }
  }
}

/**
 * RestoreBoundValuesCommand — SetBoundValuesCommand 的逆操作。
 * 仅在 undo 时被撤销栈临时调用 forward(), 不入栈, 故无需 invert。
 * 恢复同样经 SetControlValueCommand (VR-3), 与 RestoreTextCommand 同形。
 *
 * 快照里的 oldValue 是在**旧语义**下取到的值; 撤销时 element 未被本命令改动,
 * 故它必然仍能通过校验 —— 除非期间有别的命令改了 element (那时失败是**正确**的:
 * 拒绝把一个与新语义不兼容的值写回去)。
 */
class RestoreBoundValuesCommand implements ICommand {
  readonly type = 'restore-bound-values'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private readonly restore: Array<{ nodeId: string; oldValue: ControlValue | undefined }>

  constructor(
    id: string, timestamp: number, author: string,
    restore: Array<{ nodeId: string; oldValue: ControlValue | undefined }>,
  ) {
    this.id = id
    this.timestamp = timestamp
    this.author = author
    this.restore = restore
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    for (const r of this.restore) {
      new SetControlValueCommand(
        generateCommandId(), Date.now(), this.author, r.nodeId, r.oldValue,
      ).forward(ctx)
    }
    return { invalidation: 'flowbody' }
  }

  serialize(): SerializedCommand {
    return {
      type: 'restore-bound-values', id: this.id, timestamp: this.timestamp,
      author: this.author, changes: {},
    }
  }
}
