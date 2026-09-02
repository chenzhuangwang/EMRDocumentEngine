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
// ================================================================

import type { TextNode, SmartTextNode } from '../../document/core/DocumentModel'
import { NodeType } from '../../document/core/DocumentModel'
import { smartTextDisplayValue } from '../../document/factory/ElementFormatter'
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

/** 解析结果: 段落级偏移 → 文本节点 + 节点内偏移 */
interface ResolvedEdit {
  nodeId: string
  localStart: number
  localEnd: number
  newText: string
}

/**
 * 将段落级字符偏移解析到文本节点。
 * 偏移语义与 FindReplaceEngine.findAll 一致: text/smarttext 计其全文长度,
 * 其余非文本节点计 1 个占位符 (对应 getParagraphText 的 '')。
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
    const node = pool.nodes.get(childId) as { type?: string; text?: string; value?: string } | undefined
    if (!node) { offset += 1; continue }

    if (node.type === 'text' || node.type === 'smarttext') {
      const nodeText = node.type === 'smarttext'
        ? smartTextDisplayValue(node as unknown as { text: string; value?: string })
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

export class ReplaceTextCommand implements ICommand {
  readonly type = 'replace-text'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  readonly edits: ReplaceEdit[]

  /** forward 时快照受影响节点的旧全文, 供 invert 恢复 */
  private _restore: Array<{ nodeId: string; oldText: string; isSmart: boolean; oldValue?: string }> = []
  private _restoreCursor: Partial<CursorState> = {}

  constructor(id: string, timestamp: number, author: string, edits: ReplaceEdit[]) {
    this.id = id
    this.timestamp = timestamp
    this.author = author
    this.edits = edits
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx

    // Step 1: 解析所有 edit
    const resolved: ResolvedEdit[] = []
    for (const e of this.edits) {
      const loc = resolveEditLocation(pool, e.paragraphPath, e.startOffset, e.endOffset)
      if (!loc) continue
      // editable 守卫 (契约 §12.1): editable:false 的 smarttext 不接受
      // find & replace 改写其 value, 视为只读控件, 跳过该替换。
      const target = pool.nodes.get(loc.nodeId)
      if (target?.type === NodeType.SMART_TEXT
        && ctx.templateDefinitions?.get(loc.nodeId)?.editable === false) {
        continue
      }
      resolved.push({ ...loc, newText: e.newText })
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
    for (const [nodeId, rs] of byNode) {
      const node = pool.nodes.get(nodeId) as { type?: string; text?: string; value?: string } | undefined
      if (!node) continue
      // smarttext 操作运行时值 (value), text 节点操作 text (契约 §2.1)
      const isSmart = node.type === 'smarttext'
      const oldText = isSmart
        ? smartTextDisplayValue(node as unknown as { text: string; value?: string })
        : (node.text || '')
      this._restore.push({ nodeId, oldText, isSmart, oldValue: isSmart ? node.value : undefined })

      const sorted = rs.slice().sort((a, b) => b.localStart - a.localStart)
      let cur = oldText
      for (const r of sorted) {
        cur = cur.slice(0, r.localStart) + r.newText + cur.slice(r.localEnd)
      }
      if (isSmart) {
        pool.updateNode(nodeId, { value: cur } as Partial<SmartTextNode>)
      } else {
        pool.updateNode(nodeId, { text: cur } as Partial<TextNode>)
      }
    }

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
  private readonly restore: Array<{ nodeId: string; oldText: string; isSmart: boolean; oldValue?: string }>
  private readonly cursor: Partial<CursorState>

  constructor(
    id: string, timestamp: number, author: string,
    restore: Array<{ nodeId: string; oldText: string; isSmart: boolean; oldValue?: string }>,
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
        pool.updateNode(r.nodeId, { value: r.oldValue } as Partial<SmartTextNode>)
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
