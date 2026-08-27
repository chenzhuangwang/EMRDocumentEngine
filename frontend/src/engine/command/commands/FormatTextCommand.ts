// ================================================================
// FormatTextCommand — 样式格式化 (架构 §6.3b, v20.34)
//
// forward 前快照旧样式 → serialize 内嵌 oldStyles → invert 恢复旧样式
// ================================================================

import type { TextNode, TextStyle } from '../../document/core/DocumentModel'
import { extractStyle } from '../../document/factory/ElementFormatter'
import { ICommand, CommandContext, StatePatch, SerializedCommand, generateCommandId } from '../ICommand'

export class FormatTextCommand implements ICommand {
  readonly type = 'format-text'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  readonly nodeIds: string[]
  readonly changes: Partial<TextStyle>
  private oldStyles = new Map<string, Partial<TextStyle>>()

  constructor(
    id: string, timestamp: number, author: string,
    nodeIds: string[], changes: Partial<TextStyle>,
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.nodeIds = nodeIds; this.changes = changes
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    for (const nodeId of this.nodeIds) {
      const node = pool.nodes.get(nodeId) as TextNode | undefined
      if (!node) continue
      this.oldStyles.set(nodeId, extractStyle(node))
      pool.updateNode(nodeId, { ...extractStyle(node), ...this.changes } as Partial<TextNode>)
      pool.bumpNodeVersion(nodeId)
    }
    return { invalidation: 'node' }
  }

  invert(): ICommand | null {
    return new FormatTextCommand(
      generateCommandId(), Date.now(), this.author,
      this.nodeIds,
      Object.fromEntries(this.oldStyles) as Partial<TextStyle>,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'format-text', id: this.id, timestamp: this.timestamp,
      author: this.author, nodeIds: this.nodeIds,
      changes: this.changes as Record<string, unknown>,
      oldStyles: Object.fromEntries(this.oldStyles),
    }
  }
}

/** 清除选中文本所有格式 */
export class ClearFormatCommand implements ICommand {
  readonly type = 'clear-format'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  readonly nodeIds: string[]
  private oldStyles = new Map<string, Partial<TextStyle>>()

  constructor(id: string, timestamp: number, author: string, nodeIds: string[]) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.nodeIds = nodeIds
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    for (const nodeId of this.nodeIds) {
      const node = pool.nodes.get(nodeId) as TextNode | undefined
      if (!node) continue
      this.oldStyles.set(nodeId, extractStyle(node))
      // 重置为默认样式 — 必须显式清除所有格式字段 (Object.assign 是浅合并)
      pool.updateNode(nodeId, {
        font: 'SimSun',
        size: 16,
        bold: undefined,
        italic: undefined,
        underline: undefined,
        underlineStyle: undefined,
        strikeout: undefined,
        color: undefined,
        highlight: undefined,
        superscript: undefined,
        subscript: undefined,
        letterSpacing: undefined,
      } as Partial<TextNode>)
      pool.bumpNodeVersion(nodeId)
    }
    return { invalidation: 'node' }
  }

  invert(): ICommand | null {
    return new FormatTextCommand(
      generateCommandId(), Date.now(), this.author,
      this.nodeIds,
      Object.fromEntries(this.oldStyles) as Partial<TextStyle>,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'clear-format', id: this.id, timestamp: this.timestamp,
      author: this.author, nodeIds: this.nodeIds,
      oldStyles: Object.fromEntries(this.oldStyles),
    }
  }
}

/** 格式刷 — 复制源样式应用到目标 (架构 §6.3b) */
export class FormatPainterCommand implements ICommand {
  readonly type = 'format-painter'
  readonly id: string; readonly timestamp: number; readonly author: string
  readonly targetNodeIds: string[]
  readonly sourceStyle: Partial<TextStyle>
  private oldStyles = new Map<string, Partial<TextStyle>>()

  constructor(
    id: string, timestamp: number, author: string,
    targetNodeIds: string[], sourceStyle: Partial<TextStyle>,
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.targetNodeIds = targetNodeIds; this.sourceStyle = sourceStyle
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    for (const nodeId of this.targetNodeIds) {
      const node = pool.nodes.get(nodeId) as TextNode | undefined
      if (!node) continue
      this.oldStyles.set(nodeId, extractStyle(node))
      // 格式刷是"替换"而非"合并": 源没有的属性目标也应清除
      pool.updateNode(nodeId, {
        font: this.sourceStyle.font ?? 'SimSun',
        size: this.sourceStyle.size ?? 16,
        bold: this.sourceStyle.bold ?? undefined,
        italic: this.sourceStyle.italic ?? undefined,
        underline: this.sourceStyle.underline ?? undefined,
        underlineStyle: this.sourceStyle.underlineStyle ?? undefined,
        strikeout: this.sourceStyle.strikeout ?? undefined,
        color: this.sourceStyle.color ?? undefined,
        highlight: this.sourceStyle.highlight ?? undefined,
        superscript: this.sourceStyle.superscript ?? undefined,
        subscript: this.sourceStyle.subscript ?? undefined,
        letterSpacing: this.sourceStyle.letterSpacing ?? undefined,
      } as Partial<TextNode>)
      pool.bumpNodeVersion(nodeId)
    }
    return { invalidation: 'node' }
  }

  invert(): ICommand | null {
    return new FormatTextCommand(
      generateCommandId(), Date.now(), this.author,
      this.targetNodeIds,
      Object.fromEntries(this.oldStyles) as Partial<TextStyle>,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'format-painter', id: this.id, timestamp: this.timestamp,
      author: this.author, targetNodeIds: this.targetNodeIds,
      sourceStyle: this.sourceStyle as Record<string, unknown>,
      oldStyles: Object.fromEntries(this.oldStyles),
    }
  }
}
