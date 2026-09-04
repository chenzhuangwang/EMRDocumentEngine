// ================================================================
// DeleteRangeCommand — 范围删除 (架构 §6.3, v20.34)
//
// startOffset/endOffset = 字符偏移, forward 内部强制经 resolveCharOffset
// serialize 内嵌 deletedText 用于 invert 和协作重放
//
// 非文本原子节点 (image/field/smarttext/bookmark 等, 段内占 1 字符):
//   - 单节点命中 (start.textNodeId === end.textNodeId 且非 text) 或跨节点
//     删除落入范围时, 与文本节点一样整体删除 (旧实现仅处理 text, 图片等
//     会被静默遗留或触发 node.text.slice 崩溃)。
//   - 删除范围涉及非文本节点时, forward 先快照整段子节点, invert 用
//     RestoreDeleteRangeCommand 精确还原 (文本反转 InsertTextCommand 无法
//     重建非文本节点, 且跨非文本节点删除时 deletedText 拼接会丢失位置)。
// ================================================================

import type { BaseNode, Paragraph, TextNode } from '../../document/core/DocumentModel'
import type { NodePool } from '../../document/core/NodePool'
import { generateCommandId } from '../ICommand'
import type { ICommand } from '../ICommand'
import { CommandContext, StatePatch, SerializedCommand, PositionalCommand } from '../ICommand'
import { InsertTextCommand } from './InsertTextCommand'
import { normalizeParagraph } from './ParagraphUtils'
import { createTextNode } from '../../document/factory/ElementFormatter'

/** 段落删除前的完整子节点快照 (供 invert 精确还原) */
interface ParagraphSnapshot {
  childIds: string[]
  nodes: BaseNode[]
}

function cloneNode(node: BaseNode): BaseNode {
  return JSON.parse(JSON.stringify(node)) as BaseNode
}

export class DeleteRangeCommand extends PositionalCommand {
  readonly type = 'delete-range'
  readonly startOffset: number
  readonly endOffset: number
  private _deletedText = ''
  /** 删除范围涉及非文本节点时捕获的整段快照; 否则保持 null (走文本反转) */
  private _paragraphSnapshot: ParagraphSnapshot | null = null

  get deletedText(): string { return this._deletedText }

  constructor(
    id: string, timestamp: number, author: string,
    path: string[], startOffset: number, endOffset: number,
  ) {
    super(id, timestamp, author, path)
    this.startOffset = startOffset
    this.endOffset = endOffset
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    const para = pool.nodes.get(this.path[this.path.length - 1]) as Paragraph | undefined
    if (!para) return null

    // Step 1: 字符偏移 → (textNodeId, localOffset)
    const start = pool.resolveCharOffset(para.id, this.startOffset)
    const end = pool.resolveCharOffset(para.id, this.endOffset)
    if (!start || !end) return null
    if (this.startOffset >= this.endOffset) return null

    // Step 1.5: 范围触及非文本节点时, 先快照整段 (供 invert 精确还原)
    if (this.rangeTouchesNonText(pool, para, this.startOffset, this.endOffset)) {
      this._paragraphSnapshot = {
        childIds: [...para.children],
        nodes: para.children.map(id => cloneNode(pool.nodes.get(id)!)),
      }
    }

    // Step 2: 提取被删文本 + 执行删除
    if (start.textNodeId === end.textNodeId) {
      const node = pool.nodes.get(start.textNodeId)
      if (!node) return null
      if ((node as unknown as Record<string, unknown>).type === 'text') {
        // 单 TextNode 内删除
        const tn = node as TextNode
        this._deletedText = tn.text.slice(start.localOffset, end.localOffset)
        const newText = tn.text.slice(0, start.localOffset) + tn.text.slice(end.localOffset)
        if (newText) {
          pool.updateNode(node.id, { text: newText } as Partial<TextNode>)
        } else {
          pool.removeChild(para.id, para.children.indexOf(start.textNodeId))
        }
      } else {
        // 单非文本原子节点 (image/field/smarttext 等) 整体删除
        pool.removeChild(para.id, para.children.indexOf(start.textNodeId))
      }
    } else {
      // 跨节点删除
      let offset = 0
      const toRemove: string[] = []
      for (const childId of para.children) {
        const node = pool.nodes.get(childId)
        if (!node) { toRemove.push(childId); continue }
        const len = (node as unknown as Record<string, unknown>).type === 'text'
          ? ((node as TextNode).text).length : 1
        const nodeEnd = offset + len
        if (nodeEnd <= this.startOffset) { offset = nodeEnd; continue }
        if (offset >= this.endOffset) break

        if ((node as unknown as Record<string, unknown>).type === 'text') {
          const tn = node as TextNode
          const localStart = Math.max(0, this.startOffset - offset)
          const localEnd = Math.min(len, this.endOffset - offset)
          if (localStart === 0 && localEnd === len) {
            this._deletedText += tn.text
            toRemove.push(childId)
          } else {
            this._deletedText += tn.text.slice(localStart, localEnd)
            const newText = tn.text.slice(0, localStart) + tn.text.slice(localEnd)
            pool.updateNode(tn.id, { text: newText } as Partial<TextNode>)
          }
        } else {
          // 非文本原子节点 (image/field/smarttext 等) 落入范围 → 整体删除
          toRemove.push(childId)
        }
        offset = nodeEnd
      }
      for (const id of toRemove) {
        const idx = para.children.indexOf(id)
        if (idx >= 0) pool.removeChild(para.id, idx)
      }
    }

    // Step 3: 删除后合并相邻同样式 TextNode
    normalizeParagraph(para, pool)

    // Step 4: 防止空段落僵尸 — 删除全部内容后至少保留一个空文本节点
    if (para.children.length === 0) {
      const emptyText = createTextNode('')
      para.children = [emptyText.id]
      pool.addNode(emptyText as unknown as import('../../document/core/DocumentModel').BaseNode)
    }

    return {
      cursor: { paragraphPath: this.path, offset: this.startOffset },
      // 删除后清除选区，防止下次按键读到过期 offset 再次触发 deleteSelection
      selection: { active: false },
      invalidation: 'paragraph',
    }
  }

  invert(ctx: CommandContext): ICommand | null {
    if (ctx.mode !== 'local') return null
    if (this._paragraphSnapshot) {
      return new RestoreDeleteRangeCommand(
        generateCommandId(), Date.now(), this.author, this.path, this._paragraphSnapshot,
      )
    }
    return new InsertTextCommand(
      generateCommandId(), Date.now(), this.author,
      this.path, this.startOffset, this._deletedText,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'delete-range', id: this.id, timestamp: this.timestamp,
      author: this.author, path: this.path,
      startOffset: this.startOffset, endOffset: this.endOffset,
      deletedText: this._deletedText,
    }
  }

  /** 判断 [startOffset, endOffset) 是否触及任何非文本节点 (决定是否快照整段) */
  private rangeTouchesNonText(pool: NodePool, para: Paragraph, startOffset: number, endOffset: number): boolean {
    let offset = 0
    for (const childId of para.children) {
      const node = pool.nodes.get(childId)
      if (!node) continue
      const len = (node as unknown as Record<string, unknown>).type === 'text'
        ? ((node as unknown as { text: string }).text).length : 1
      const nodeEnd = offset + len
      if (nodeEnd > startOffset && offset < endOffset) {
        if ((node as unknown as Record<string, unknown>).type !== 'text') return true
      }
      offset = nodeEnd
    }
    return false
  }
}

/**
 * RestoreDeleteRangeCommand — DeleteRangeCommand 的逆操作 (仅非文本删除路径)。
 * 仅在 undo 时被临时 forward(), 不入栈, 故无需 invert。
 */
class RestoreDeleteRangeCommand implements ICommand {
  readonly type = 'restore-delete-range'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private path: string[]
  private snapshot: ParagraphSnapshot

  constructor(id: string, timestamp: number, author: string, path: string[], snapshot: ParagraphSnapshot) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.path = path; this.snapshot = snapshot
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    const paraId = this.path[this.path.length - 1]
    const para = pool.nodes.get(paraId) as Paragraph | undefined
    if (!para) return null

    // 1. 摘除并删除当前全部子节点 (释放 id 供快照节点重新注册)
    for (let i = para.children.length - 1; i >= 0; i--) {
      pool.removeChild(paraId, i)
    }
    // 2. 重新注册快照节点 (再深拷贝, 避免与快照共享引用)
    for (const n of this.snapshot.nodes) {
      pool.addNode(cloneNode(n))
    }
    // 3. 恢复原始子节点顺序
    para.children = [...this.snapshot.childIds]

    return { invalidation: 'paragraph' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    return null
  }

  serialize(): SerializedCommand {
    return { type: 'restore-delete-range', id: this.id, timestamp: this.timestamp, author: this.author, path: this.path }
  }
}
