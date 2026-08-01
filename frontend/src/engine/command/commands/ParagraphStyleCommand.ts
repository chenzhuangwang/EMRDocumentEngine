// ================================================================
// ParagraphStyleCommand — 段落格式命令 (对齐/缩进/列表)
// ================================================================

import type { Paragraph, ParagraphStyle } from '../../document/DocumentModel'
import { ICommand, CommandContext, StatePatch, SerializedCommand, generateCommandId } from '../ICommand'

export class ParagraphStyleCommand implements ICommand {
  readonly type = 'paragraph-style'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  readonly paraId: string
  readonly changes: Partial<ParagraphStyle>
  private oldStyle: Partial<ParagraphStyle> | null = null

  constructor(
    id: string, timestamp: number, author: string,
    paraId: string, changes: Partial<ParagraphStyle>,
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.paraId = paraId; this.changes = changes
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    const para = pool.nodes.get(this.paraId) as Paragraph | undefined
    if (!para) return null

    this.oldStyle = {
      alignment: para.alignment,
      indent: para.indent,
      lineHeight: para.lineHeight,
      list: para.list,
      outlineLevel: para.outlineLevel,
    }
    pool.updateNode(this.paraId, { ...this.changes } as Partial<Paragraph>)
    return { invalidation: 'paragraph' }
  }

  invert(): ICommand | null {
    if (!this.oldStyle) return null
    return new ParagraphStyleCommand(
      generateCommandId(), Date.now(), this.author,
      this.paraId, this.oldStyle,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'paragraph-style', id: this.id, timestamp: this.timestamp,
      author: this.author, paraId: this.paraId,
      changes: this.changes as Record<string, unknown>,
    }
  }
}
