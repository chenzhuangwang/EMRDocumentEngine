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

import type { TextNode, ControlValue, ElementMeta, ElementEnumOption, SmartTextNode } from '../../document/core/DocumentModel'
import { smartTextFindReplaceText } from '../../document/factory/ElementFormatter'
import { SetControlValueCommand } from './SetControlValueCommand'
import { validateControlValue } from '../../document/control/ControlValue'
import type { ControlValuePermissions } from '../../document/control/ControlValue'
import type { NodePool } from '../../document/core/NodePool'
import type { CursorState } from '../../state/EditorRuntimeState'
import type { CommandContext, ICommand, SerializedCommand, StatePatch } from '../ICommand'
import { generateCommandId } from '../ICommand'

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
        const element = (node as unknown as SmartTextNode).element
        // B 写权限 (VR-8) 与字典候选 (VR-7), 与 SetControlValueCommand 同源
        const permissions: ControlValuePermissions = {
          editable: ctx.templateDefinitions?.get(nodeId)?.editable,
        }
        const dictionaryId = element.format?.dictionary
        const dictionaryCandidates = dictionaryId ? ctx.dictionaries?.resolve(dictionaryId) : undefined

        const coerced = coerceSmartReplacement(element, cur, permissions, dictionaryCandidates)
        if (!coerced.ok) {
          this._rejected.push({ paragraphPath: rs[0].paragraphPath, matchedText: oldText, reason: coerced.reason })
          continue
        }
        // VR-3: 运行时值写入唯一路径 → SetControlValueCommand (层 A 值型 + 层 B 写权限)
        const oldValue = node.value
        const valueCmd = new SetControlValueCommand(generateCommandId(), Date.now(), this.author, nodeId, coerced.value)
        if (valueCmd.forward(ctx) === null) {
          this._rejected.push({ paragraphPath: rs[0].paragraphPath, matchedText: oldText, reason: 'write_locked' })
          continue
        }
        this._restore.push({ nodeId, oldText, isSmart, oldValue })
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

  invert(ctx: CommandContext): ICommand | null {
    if (ctx.mode !== 'local') return null
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
