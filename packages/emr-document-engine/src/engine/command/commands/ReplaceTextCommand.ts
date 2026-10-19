// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ReplaceTextCommand — 文本替换命令 (架构 §5/§8, v20.37)
//
// 查找替换原先在 FindReplaceEngine.replace/replaceAll 中直接改写
// child.text, 绕过 CommandManager (不可撤销 / 无 document:changed 链)。
// 本命令将「替换一段范围文本」封装为可撤销原语:
//   - forward: 对若干段 (paragraphPath, [startOffset, endOffset)) 执行替换
//   - invert:  快照各受影响 text 节点的旧文本, 一次性恢复
//
// 单个替换与「全部替换」复用同一命令 — 前者 edits 长度为 1,
// 后者一次提交所有 edit, 使「全部替换」成为单个可撤销操作。
//
// 契约 §26 查找替换收口:
//   - 占位符 (value === undefined) smarttext 不参与查找 (smartTextFindReplaceText → null);
//   - 非字符串值 (number / string[]) 替换非静默: number 做文本→number 归并,
//     string[] (checkbox) 拒绝并记录理由, 由 Editor.replaceAll 回传 (非静默失败)。
// ================================================================

import type { Paragraph, TextNode, ControlValue, ElementMeta, ElementEnumOption, SmartTextNode, RevisionMark, TextStyle } from '../../document/core/DocumentModel'
import { smartTextFindReplaceText } from '../../document/factory/ElementFormatter'
import { SetControlValueCommand } from './SetControlValueCommand'
import { validateControlValue } from '../../document/control/ControlValue'
import type { ControlValuePermissions } from '../../document/control/ControlValue'
import type { NodePool } from '../../document/core/NodePool'
import type { CursorState } from '../../state/EditorRuntimeState'
import type { CommandContext, ICommand, SerializedCommand, StatePatch } from '../ICommand'
import { generateCommandId } from '../ICommand'
import { RevisionStamp } from '../../revision/Revision'
import { MintedOnce } from './MintedNodes'
import { createTextNode, extractStyle } from '../../document/factory/ElementFormatter'
import { normalizeParagraph } from './ParagraphUtils'
import {
  captureParagraphSnapshot, RestoreParagraphsCommand,
  type ParagraphSnapshot,
} from './ParagraphSnapshot'

/** 一次替换操作 (段落级字符偏移, 与 MatchResult 对齐) */
export interface ReplaceEdit {
  paragraphPath: string[]
  startOffset: number
  endOffset: number
  newText: string
}

/** 替换被拒绝的明细 (契约 §26: 非静默失败, 携带机器可读理由) */
export interface ReplaceRejection {
  paragraphPath: string[]
  matchedText: string
  reason: string
}

/** 解析结果: 段落级偏移 → 文本节点 + 节点内偏移 */
interface ResolvedEdit {
  nodeId: string
  paragraphPath: string[]
  localStart: number
  localEnd: number
  newText: string
}

/**
 * 将段落级字符偏移解析到文本节点。
 * 偏移语义与 FindReplaceEngine.findAll 一致: text/smarttext 计其查找参与文本长度
 * (smartTextFindReplaceText, 契约 §26), 其余非文本节点计 1 个占位符 (对应 '')。
 */
function resolveEditLocation(
  pool: NodePool,
  paragraphPath: string[],
  startOffset: number,
  endOffset: number,
): { nodeId: string; localStart: number; localEnd: number } | null {
  const paraId = paragraphPath[paragraphPath.length - 1]
  const para = pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
  if (!para?.children) return null

  let offset = 0
  for (const childId of para.children) {
    const node = pool.nodes.get(childId) as { type?: string; text?: string; value?: ControlValue } | undefined
    if (!node) { offset += 1; continue }

    if (node.type === 'text' || node.type === 'smarttext') {
      const nodeText = node.type === 'smarttext'
        ? (smartTextFindReplaceText(node as unknown as { text: string; value?: ControlValue }) ?? '')
        : (node.text || '')
      const len = nodeText.length
      if (offset + len > startOffset) {
        const localStart = startOffset - offset
        const localEnd = endOffset - offset
        // 匹配项必落在单节点内 (非文本节点以占位符分隔, 不会与查询匹配)
        if (localStart < 0 || localEnd > len) return null
        return { nodeId: childId, localStart, localEnd }
      }
      offset += len
    } else {
      offset += 1
    }
  }
  return null
}

/**
 * 控件替换文本 → 规范值归并 (契约 §26)。
 * number (N) 做文本→number 归并; string[] (checkbox) 拒绝; 其余 string 直接经
 * validateControlValue (统一 VR-9/VR-10/VR-11/日期格式)。返回机器可读理由码。
 */
function coerceSmartReplacement(
  element: ElementMeta,
  newText: string,
  permissions: ControlValuePermissions,
  dictionaryCandidates: readonly ElementEnumOption[] | undefined,
): { ok: true; value: ControlValue | undefined } | { ok: false; reason: string } {
  const format = element.format
  const dataType = format?.dataType
  const enums = format?.enums

  // 多选 (checkbox): 文本替换无法无损映射回 string[] 集合 → 拒绝
  if (enums?.multiple === true) {
    return { ok: false, reason: 'multi_select_not_replaceable' }
  }

  // 数字 (N, VR-5 值语义为 number): 文本 → number 归并; 空/非有限数字拒绝
  if (dataType === 'N') {
    const trimmed = newText.trim()
    if (trimmed === '') return { ok: false, reason: 'replacement_not_a_number' }
    const n = Number(trimmed)
    if (!Number.isFinite(n)) return { ok: false, reason: 'replacement_not_a_number' }
    const r = validateControlValue(n, element, permissions, dictionaryCandidates)
    return r.ok ? { ok: true, value: r.value } : { ok: false, reason: r.reason }
  }

  // 其余 (S1/S2/S3 自由文本 / D 日期 / 单选枚举) → string
  const r = validateControlValue(newText, element, permissions, dictionaryCandidates)
  return r.ok ? { ok: true, value: r.value } : { ok: false, reason: r.reason }
}

export class ReplaceTextCommand implements ICommand {
  readonly type = 'replace-text'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  readonly edits: ReplaceEdit[]

  /** forward 时快照受影响节点的旧全文, 供 invert 恢复 */
  private _restore: Array<{ nodeId: string; oldText: string; isSmart: boolean; oldValue?: ControlValue }> = []
  private _restoreCursor: Partial<CursorState> = {}
  /** forward 时记录的拒绝明细 (契约 §26 非静默失败), 供 Editor.replaceAll 回传 */
  private _rejected: ReplaceRejection[] = []
  /** 追踪留痕时的整段快照 (契约 §12.13): 拆分节点 + 打标记, 纯文本反转还原不出 */
  private _snapshots: ParagraphSnapshot[] = []
  private delStamp = new RevisionStamp()
  private insertStamp = new RevisionStamp()
  /**
   * 首次 forward 决定的模式 (契约 §12.13 / §8.3): 重放必须走与首次相同的路,
   * 否则"先关追踪执行、再开追踪 redo"会产出一份带标记的文档。
   */
  private _trackedMode: boolean | null = null
  /** 铸造一次台账 (契约 §8.3): 追踪替换拆出的片段在 redo 时复用同一批 id */
  private mint = new MintedOnce()

  constructor(id: string, timestamp: number, author: string, edits: ReplaceEdit[]) {
    this.id = id
    this.timestamp = timestamp
    this.author = author
    this.edits = edits
  }

  /** forward 后读取被拒绝的替换明细 (空 = 全部替换成功) */
  get rejected(): readonly ReplaceRejection[] {
    return this._rejected
  }

  /** forward 后读取实际替换成功的节点数 (text 与 smarttext 均计 1) */
  get appliedCount(): number {
    return this._restore.length
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx

    // Step 1: 解析所有 edit
    const resolved: ResolvedEdit[] = []
    for (const e of this.edits) {
      const loc = resolveEditLocation(pool, e.paragraphPath, e.startOffset, e.endOffset)
      if (!loc) continue
      resolved.push({ ...loc, paragraphPath: e.paragraphPath, newText: e.newText })
    }
    if (resolved.length === 0) return null

    // 追踪开启: 旧文本留下并标记 delete, 新文本标记 insert (契约 §12.13)。
    // 两种模式互斥, 因为它们的逆操作不同: 追踪路径拆分节点, 只能整段还原。
    // 模式在**首次** forward 定下, 重放沿用 (§8.3: 重放不得因当下开关不同而变样)。
    if (this._trackedMode === null) this._trackedMode = ctx.revision?.tracking === true
    if (this._trackedMode) return this.forwardTracked(ctx, resolved)

    // Step 2: 按节点分组, 快照旧文本, 组内按 localStart 降序应用 (避免偏移失效)
    const byNode = new Map<string, ResolvedEdit[]>()
    for (const r of resolved) {
      const arr = byNode.get(r.nodeId)
      if (arr) arr.push(r)
      else byNode.set(r.nodeId, [r])
    }

    this._restore = []
    this._rejected = []
    for (const [nodeId, rs] of byNode) {
      const node = pool.nodes.get(nodeId) as { type?: string; text?: string; value?: ControlValue; element?: ElementMeta } | undefined
      if (!node) continue
      // smarttext 操作运行时值 (value), text 节点操作 text (契约 §2.1)
      const isSmart = node.type === 'smarttext'
      const oldText = isSmart
        ? (smartTextFindReplaceText(node as unknown as { text: string; value?: ControlValue }) ?? '')
        : (node.text || '')

      const sorted = rs.slice().sort((a, b) => b.localStart - a.localStart)
      let cur = oldText
      for (const r of sorted) {
        cur = cur.slice(0, r.localStart) + r.newText + cur.slice(r.localEnd)
      }
      if (isSmart) {
        const reason = this.replaceSmartValue(ctx, nodeId, node as SmartTextNode, cur)
        if (reason) {
          this._rejected.push({ paragraphPath: rs[0].paragraphPath, matchedText: oldText, reason })
          continue
        }
        this._restore.push({ nodeId, oldText, isSmart, oldValue: node.value })
      } else {
        this._restore.push({ nodeId, oldText, isSmart, oldValue: undefined })
        pool.updateNode(nodeId, { text: cur } as Partial<TextNode>)
      }
    }
    if (this._restore.length === 0) return null

    // Step 3: 光标落到最后一个 edit 之后 (与旧 replace 行为对齐, 用实际替换文本长度)
    const last = this.edits[this.edits.length - 1]
    const cursor = {
      paragraphPath: last.paragraphPath,
      offset: last.startOffset + last.newText.length,
      visible: true,
    }
    this._restoreCursor = cursor

    return { cursor, invalidation: 'flowbody' }
  }

  /**
   * 控件替换的唯一实现 (值型 + 写权限 + 字典候选, 契约 §26)。
   * 返回 null = 成功; 否则是机器可读的拒绝理由。
   */
  private replaceSmartValue(
    ctx: CommandContext,
    nodeId: string,
    node: SmartTextNode,
    nextText: string,
  ): string | null {
    if (ctx.mode !== 'local') return 'not_local'
    const element = node.element
    // B 写权限 (VR-8) 与字典候选 (VR-7), 与 SetControlValueCommand 同源
    const permissions: ControlValuePermissions = {
      editable: ctx.templateDefinitions?.get(nodeId)?.editable,
    }
    const dictionaryId = element.format?.dictionary
    const dictionaryCandidates = dictionaryId ? ctx.dictionaries?.resolve(dictionaryId) : undefined
    const coerced = coerceSmartReplacement(element, nextText, permissions, dictionaryCandidates)
    if (!coerced.ok) return coerced.reason
    // VR-3: 运行时值写入唯一路径 → SetControlValueCommand (层 A 值型 + 层 B 写权限)
    const valueCmd = new SetControlValueCommand(generateCommandId(), Date.now(), this.author, nodeId, coerced.value)
    if (valueCmd.forward(ctx) === null) return 'write_locked'
    return null
  }

  /**
   * 追踪模式 (契约 §12.13): 被替换的旧文字**留下并标记 delete**, 新文字标记 insert。
   *
   * 与普通路径的关键差别: 普通路径在一个 TextNode 内改字符串, 反转只需记旧文本;
   * 这里必须把节点切成 [原文 | 待删 | 新增 | 原文] 多段, 所以逆操作只能整段快照还原
   * (RestoreParagraphsCommand)。片段 id 经 MintedOnce 固定, redo 逐字节相同 (§8.3)。
   */
  private forwardTracked(ctx: CommandContext, resolved: ResolvedEdit[]): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    const delMark = this.delStamp.resolve(ctx.revision!, 'delete')
    const insMark = this.insertStamp.resolve(ctx.revision!, 'insert')
    if (!delMark || !insMark) return null
    // 重放 (redo) 重新拍一张: 撤销已把段落恢复成动手之前的样子 (§8.3)
    this._snapshots = []

    const byNode = new Map<string, ResolvedEdit[]>()
    for (const r of resolved) {
      const arr = byNode.get(r.nodeId)
      if (arr) arr.push(r)
      else byNode.set(r.nodeId, [r])
    }

    interface Frag { text: string; mark?: RevisionMark }
    interface Plan { nodeId: string; paraId: string; style: TextStyle; frags: Frag[] }
    const plans: Plan[] = []
    this._restore = []
    this._rejected = []

    for (const [nodeId, rs] of byNode) {
      const node = pool.nodes.get(nodeId) as
        { type?: string; text?: string; value?: ControlValue; element?: ElementMeta; revision?: RevisionMark } | undefined
      if (!node) continue
      const oldText = node.type === 'smarttext'
        ? (smartTextFindReplaceText(node as unknown as { text: string; value?: ControlValue }) ?? '')
        : (node.text || '')

      if (node.type === 'smarttext') {
        // 控件值是数据不是文字内容 —— 不产生留痕 (契约 §12.13)
        const sorted = rs.slice().sort((a, b) => b.localStart - a.localStart)
        let cur = oldText
        for (const r of sorted) cur = cur.slice(0, r.localStart) + r.newText + cur.slice(r.localEnd)
        const reason = this.replaceSmartValue(ctx, nodeId, node as unknown as SmartTextNode, cur)
        if (reason) this._rejected.push({ paragraphPath: rs[0].paragraphPath, matchedText: oldText, reason })
        else this._restore.push({ nodeId, oldText, isSmart: true, oldValue: node.value })
        continue
      }

      const baseMark = node.revision
      const sorted = rs.slice().sort((a, b) => a.localStart - b.localStart)
      const frags: Frag[] = []
      let cursor = 0
      for (const r of sorted) {
        if (r.localStart > cursor) {
          frags.push({ text: oldText.slice(cursor, r.localStart), ...(baseMark ? { mark: { ...baseMark } } : {}) })
        }
        const covered = oldText.slice(r.localStart, r.localEnd)
        // 规则: 待接受的插入被替换 = 取消它, 不叠 delete (契约 §12.13)
        if (covered !== '' && baseMark?.type !== 'insert') frags.push({ text: covered, mark: { ...delMark } })
        if (r.newText !== '') frags.push({ text: r.newText, mark: { ...insMark } })
        cursor = Math.max(cursor, r.localEnd)
      }
      if (cursor < oldText.length) {
        frags.push({ text: oldText.slice(cursor), ...(baseMark ? { mark: { ...baseMark } } : {}) })
      }
      if (frags.length === 0) continue

      plans.push({
        nodeId,
        paraId: rs[0].paragraphPath[rs[0].paragraphPath.length - 1],
        style: extractStyle(node as unknown as TextNode),
        frags,
      })
      this._restore.push({ nodeId, oldText, isSmart: false, oldValue: undefined })
    }

    if (this._restore.length === 0) return null

    // ---- 铸造片段节点 (契约 §8.3: redo 复用同一批 id) ----
    const freshSpecs = plans.flatMap(p => p.frags.slice(1).map(f => ({ f, style: p.style })))
    const freshIds = this.mint.run(pool, () => freshSpecs.map(({ f, style }) => {
      const n = createTextNode(f.text, style)
      if (f.mark) n.revision = { ...f.mark }
      pool.addNode(n)
      return n.id
    }))

    // ---- 落盘 ----
    let next = 0
    const touched = new Set<string>()
    for (const plan of plans) {
      const para = pool.nodes.get(plan.paraId) as Paragraph | undefined
      if (!para) { next += plan.frags.length - 1; continue }
      if (!touched.has(plan.paraId)) {
        touched.add(plan.paraId)
        this._snapshots.push(captureParagraphSnapshot(pool, para))
      }
      const first = plan.frags[0]
      pool.updateNode(plan.nodeId, { text: first.text } as Partial<TextNode>)
      if (first.mark) pool.updateNode(plan.nodeId, { revision: first.mark } as Partial<TextNode>)
      else pool.deleteNodeField(plan.nodeId, 'revision')

      const extraIds = plan.frags.slice(1).map(() => freshIds[next++])
      const idx = para.children.indexOf(plan.nodeId)
      if (extraIds.length > 0 && idx >= 0) {
        pool.detachChild(plan.paraId, idx)
        pool.insertChildren(plan.paraId, [plan.nodeId, ...extraIds], idx)
      }
    }
    for (const pid of touched) {
      const para = pool.nodes.get(pid)
      if (para) normalizeParagraph(para as Paragraph, pool)
    }

    const last = this.edits[this.edits.length - 1]
    const cursor = {
      paragraphPath: last.paragraphPath,
      offset: last.startOffset + last.newText.length,
      visible: true,
    }
    this._restoreCursor = cursor
    return { cursor, invalidation: 'flowbody' }
  }

  invert(ctx: CommandContext): ICommand | null {
    if (ctx.mode !== 'local') return null
    if (this._snapshots.length > 0) {
      return new RestoreParagraphsCommand(
        generateCommandId(), Date.now(), this.author, this._snapshots,
      )
    }
    if (this._restore.length === 0) return null
    return new RestoreTextCommand(
      generateCommandId(), Date.now(), this.author,
      this._restore, this._restoreCursor,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'replace-text', id: this.id, timestamp: this.timestamp,
      author: this.author, changes: { edits: this.edits },
    }
  }
}

/**
 * RestoreTextCommand — ReplaceTextCommand 的逆操作。
 * 仅在 undo 时被 CommandUndoRedoStack 临时调用 forward(), 不入栈, 故无需 invert。
 */
class RestoreTextCommand implements ICommand {
  readonly type = 'restore-text'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private readonly restore: Array<{ nodeId: string; oldText: string; isSmart: boolean; oldValue?: ControlValue }>
  private readonly cursor: Partial<CursorState>

  constructor(
    id: string, timestamp: number, author: string,
    restore: Array<{ nodeId: string; oldText: string; isSmart: boolean; oldValue?: ControlValue }>,
    cursor: Partial<CursorState>,
  ) {
    this.id = id
    this.timestamp = timestamp
    this.author = author
    this.restore = restore
    this.cursor = cursor
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    for (const r of this.restore) {
      if (r.isSmart) {
        // VR-3: 撤销恢复同样经 SetControlValueCommand 唯一路径
        new SetControlValueCommand(generateCommandId(), Date.now(), this.author, r.nodeId, r.oldValue).forward(ctx)
      } else {
        pool.updateNode(r.nodeId, { text: r.oldText } as Partial<TextNode>)
      }
    }
    return { cursor: this.cursor, invalidation: 'flowbody' }
  }

  serialize(): SerializedCommand {
    return {
      type: 'restore-text', id: this.id, timestamp: this.timestamp,
      author: this.author,
    }
  }
}
