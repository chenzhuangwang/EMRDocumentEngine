// ================================================================
// DeleteRangeCommand — 范围删除 (架构 §6.3, v20.34)
//
// startOffset/endOffset = 字符偏移, forward 内部强制经 resolveCharOffset
// serialize 内嵌 deletedText 用于 invert 和协作重放
// ================================================================

import type { Paragraph, TextNode } from '../../document/core/DocumentModel'
import { generateCommandId } from '../ICommand'
import type { ICommand } from '../ICommand'
import { CommandContext, StatePatch, SerializedCommand, PositionalCommand } from '../ICommand'
import { InsertTextCommand } from './InsertTextCommand'
import { normalizeParagraph } from './ParagraphUtils'
import { createTextNode } from '../../document/factory/ElementFormatter'

export class DeleteRangeCommand extends PositionalCommand {
  readonly type = 'delete-range'
  readonly startOffset: number
  readonly endOffset: number
  private _deletedText = ''

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

    // Step 2: 提取被删文本 + 执行删除
    if (start.textNodeId === end.textNodeId) {
      // 单 TextNode 内删除
      const node = pool.nodes.get(start.textNodeId) as TextNode | undefined
      if (!node) return null
      this._deletedText = node.text.slice(start.localOffset, end.localOffset)
      const newText = node.text.slice(0, start.localOffset) + node.text.slice(end.localOffset)
      if (newText) {
        pool.updateNode(node.id, { text: newText } as Partial<TextNode>)
      } else {
        pool.removeChild(para.id, para.children.indexOf(start.textNodeId))
      }
    } else {
      // 跨 TextNode 删除
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
}
