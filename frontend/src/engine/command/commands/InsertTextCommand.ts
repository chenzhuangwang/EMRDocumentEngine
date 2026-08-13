// ================================================================
// InsertTextCommand — Run 模型文本插入 (架构 §6.2, v20.34)
//
// 字符偏移语义: offset = 段落可见文本 UTF-16 字符偏移
// forward 内部强制经 resolveCharOffset → (textNodeId, localOffset)
// 严禁将 offset 直接用作 para.children 数组下标
// ================================================================

import type { Paragraph, TextNode, TextStyle } from '../../document/DocumentModel'
import { extractStyle, sameStyle, createTextNode } from '../../document/ElementFormatter'
import {
  ICommand, CommandContext, StatePatch,
  SerializedCommand, PositionalCommand, generateCommandId,
} from '../ICommand'
import { DeleteRangeCommand } from './DeleteRangeCommand'
import { normalizeParagraph } from './ParagraphUtils'

export class InsertTextCommand extends PositionalCommand {
  readonly type = 'insert-text'
  readonly text: string
  readonly style?: TextStyle

  constructor(
    id: string, timestamp: number, author: string,
    path: string[], offset: number,
    text: string, style?: TextStyle,
  ) {
    super(id, timestamp, author, path)
    this.offset = offset
    this.text = text
    this.style = style
  }
  readonly offset: number

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    const para = pool.nodes.get(this.path[this.path.length - 1]) as Paragraph | undefined
    if (!para) return null

    // Step 1: 字符偏移 → (textNodeId, localOffset)
    const resolved = pool.resolveCharOffset(para.id, this.offset)
    const textNodeId = resolved?.textNodeId ?? null
    const localOffset = resolved?.localOffset ?? 0
    const style = this.style ?? { font: 'SimSun', size: 16 }

    // Step 2: 定位 TextNode, 在文本层面插入/拆分
    if (textNodeId) {
      const textNode = pool.nodes.get(textNodeId) as TextNode | undefined
      if (textNode && sameStyle(textNode, style)) {
        // 样式一致 → 在 localOffset 处直接插入字符串
        const newText = textNode.text.slice(0, localOffset) + this.text + textNode.text.slice(localOffset)
        pool.updateNode(textNode.id, { text: newText } as Partial<TextNode>)
        normalizeParagraph(para, pool)
        return {
          cursor: { paragraphPath: this.path, offset: this.offset + [...this.text].length },
          invalidation: 'paragraph',
        }
      }
      if (textNode) {
        // 样式不同 → 拆分 TextNode + 插入新 TextNode
        const before = textNode.text.slice(0, localOffset)
        const after = textNode.text.slice(localOffset)
        pool.updateNode(textNode.id, { text: before || '' } as Partial<TextNode>)
        const newNode = createTextNode(this.text, style)
        pool.nodes.set(newNode.id, newNode)
        const idx = para.children.indexOf(textNodeId)
        pool.insertChild(para.id, newNode.id, idx + 1)
        if (after) {
          const afterNode = createTextNode(after, extractStyle(textNode))
          pool.nodes.set(afterNode.id, afterNode)
          pool.insertChild(para.id, afterNode.id, idx + 2)
        }
      } else {
        // 悬空引用: textNodeId 指向的节点不在池中 → 清理孤儿 id 后头部插入,
        // 避免静默吞掉输入 (否则光标 offset 递增但无文字写入)
        const danglingIdx = para.children.indexOf(textNodeId)
        if (danglingIdx >= 0) para.children.splice(danglingIdx, 1)
        const newNode = createTextNode(this.text, style)
        pool.nodes.set(newNode.id, newNode)
        pool.insertChild(para.id, newNode.id, 0)
      }
    } else {
      // offset=0 或空段落 → 在 para.children 头部插入
      const newNode = createTextNode(this.text, style)
      pool.nodes.set(newNode.id, newNode)
      pool.insertChild(para.id, newNode.id, 0)
    }
    normalizeParagraph(para, pool)
    return {
      cursor: { paragraphPath: this.path, offset: this.offset + [...this.text].length },
      invalidation: 'paragraph',
    }
  }

  invert(ctx: CommandContext): ICommand | null {
    if (ctx.mode !== 'local') return null
    return new DeleteRangeCommand(
      generateCommandId(), Date.now(), this.author,
      this.path, this.offset, this.offset + [...this.text].length,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'insert-text', id: this.id, timestamp: this.timestamp,
      author: this.author, path: this.path, offset: this.offset,
      text: this.text, style: this.style as Record<string, unknown> | undefined,
    }
  }
}
