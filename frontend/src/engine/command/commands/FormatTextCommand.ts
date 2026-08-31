// ================================================================
// FormatTextCommand — 样式格式化 (架构 §6.3b, v20.34)
//
// forward 前快照旧样式 → serialize 内嵌 oldStyles → invert 恢复旧样式
// ================================================================

import type { TextNode, TextStyle, Paragraph } from '../../document/core/DocumentModel'
import { extractStyle, createTextNode } from '../../document/factory/ElementFormatter'
import type { NodePool } from '../../document/core/NodePool'
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

// ================================================================
// FormatTextRangeCommand — 段内局部选区格式化 (架构 §6.3b, v20.35)
//
// 与 FormatTextCommand 的区别: 支持"段落内局部选区"。旧实现的
// collectSelectionTextNodeIds 只返回选区重叠的整段 TextNode id,
// 导致选中一段字符时整行被格式化。本命令在 forward 内先经 NodePool
// 受控入口把选区边界所在的 TextNode 拆分, 只对 [start,end) 内完整
// 覆盖的文本节点应用样式; invert 时先还原旧样式再逆序合并拆分, 精确
// 恢复拆分前的节点结构 (不依赖 sameStyle 的启发式合并)。
// ================================================================

export interface FormatRange {
  /** [docId, paraId] — 与 PositionalCommand.path 语义一致 */
  path: string[]
  /** 段内字符偏移 (inclusive) */
  start: number
  /** 段内字符偏移 (exclusive) */
  end: number
}

/** 全量替换样式 (清除格式 / 格式刷的"替换而非合并"语义) — 未指定字段重置为默认 */
export function replacementStyle(source: Partial<TextStyle>): Partial<TextNode> {
  return {
    font: source.font ?? 'SimSun',
    size: source.size ?? 16,
    bold: source.bold ?? undefined,
    italic: source.italic ?? undefined,
    underline: source.underline ?? undefined,
    underlineStyle: source.underlineStyle ?? undefined,
    strikeout: source.strikeout ?? undefined,
    color: source.color ?? undefined,
    highlight: source.highlight ?? undefined,
    superscript: source.superscript ?? undefined,
    subscript: source.subscript ?? undefined,
    letterSpacing: source.letterSpacing ?? undefined,
  }
}

/** 收集段落 [start,end) 内完整覆盖的文本节点 id (经边界拆分后即"精确命中") */
function collectTextNodeIdsInRange(pool: NodePool, paraId: string, start: number, end: number): string[] {
  const para = pool.nodes.get(paraId) as Paragraph | undefined
  if (!para) return []
  const ids: string[] = []
  let offset = 0
  for (const childId of para.children) {
    const node = pool.nodes.get(childId) as { type?: string; text?: string } | undefined
    const len = node?.type === 'text' ? (node.text || '').length : 1
    if (node?.type === 'text' && offset + len > start && offset < end) {
      ids.push(childId)
    }
    offset += len
  }
  return ids
}

export class FormatTextRangeCommand implements ICommand {
  readonly type = 'format-text-range'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  readonly ranges: FormatRange[]
  readonly changes: Partial<TextStyle>
  /** merge = 仅覆盖指定字段; replace = 全量替换 (清除/格式刷) */
  readonly mode: 'merge' | 'replace'

  private oldStyles = new Map<string, Partial<TextStyle>>()
  private splits: { paraId: string; nodeId: string; afterId: string }[] = []

  constructor(
    id: string, timestamp: number, author: string,
    ranges: FormatRange[], changes: Partial<TextStyle>, mode: 'merge' | 'replace' = 'merge',
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.ranges = ranges; this.changes = changes; this.mode = mode
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    for (const range of this.ranges) {
      const paraId = range.path[range.path.length - 1]
      const para = pool.nodes.get(paraId) as Paragraph | undefined
      if (!para) continue

      // 1. 拆分选区边界所在 TextNode, 使 [start,end) 隔离为独立节点
      this.splitAt(pool, paraId, range.start)
      this.splitAt(pool, paraId, range.end)

      // 2. 收集 [start,end) 内完整覆盖的文本节点
      const ids = collectTextNodeIdsInRange(pool, paraId, range.start, range.end)

      // 3. 应用样式 (先快照旧样式供 invert 还原)
      for (const nodeId of ids) {
        const node = pool.nodes.get(nodeId) as TextNode | undefined
        if (!node) continue
        this.oldStyles.set(nodeId, extractStyle(node))
        const next = this.mode === 'replace'
          ? replacementStyle(this.changes)
          : { ...extractStyle(node), ...this.changes }
        pool.updateNode(nodeId, next as Partial<TextNode>)
        pool.bumpNodeVersion(nodeId)
      }
    }
    return { invalidation: 'paragraph' }
  }

  /** 在段内 offset 处拆分 TextNode (若落在节点内部)。经 NodePool 受控入口, 记录拆分供 invert 合并 */
  private splitAt(pool: NodePool, paraId: string, offset: number): void {
    const res = pool.resolveCharOffset(paraId, offset)
    if (!res) return
    const raw = pool.nodes.get(res.textNodeId)
    if (!raw || (raw as { type?: string }).type !== 'text') return
    const node = raw as TextNode
    const len = node.text.length
    if (res.localOffset <= 0 || res.localOffset >= len) return

    const before = node.text.slice(0, res.localOffset)
    const after = node.text.slice(res.localOffset)
    const style = extractStyle(node)
    pool.updateNode(node.id, { text: before } as Partial<TextNode>)
    const afterNode = createTextNode(after, style)
    pool.addNode(afterNode)
    const para = pool.nodes.get(paraId) as Paragraph | undefined
    const idx = para ? para.children.indexOf(node.id) : -1
    pool.insertChild(paraId, afterNode.id, idx + 1)
    this.splits.push({ paraId, nodeId: node.id, afterId: afterNode.id })
  }

  invert(): ICommand | null {
    return new FormatTextRangeRevertCommand(
      generateCommandId(), Date.now(), this.author,
      this.oldStyles, this.splits,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'format-text-range', id: this.id, timestamp: this.timestamp,
      author: this.author, ranges: this.ranges,
      changes: this.changes as Record<string, unknown>,
      mode: this.mode,
      oldStyles: Object.fromEntries(this.oldStyles),
    }
  }
}

/** FormatTextRangeCommand 的逆操作 — 还原旧样式 + 逆序合并拆分, 精确恢复拆分前结构 */
class FormatTextRangeRevertCommand implements ICommand {
  readonly type = 'format-text-range-revert'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private oldStyles: Map<string, Partial<TextStyle>>
  private splits: { paraId: string; nodeId: string; afterId: string }[]

  constructor(
    id: string, timestamp: number, author: string,
    oldStyles: Map<string, Partial<TextStyle>>,
    splits: { paraId: string; nodeId: string; afterId: string }[],
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.oldStyles = oldStyles; this.splits = splits
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx

    // 1. 先还原旧样式 (合并前还原, 否则被合并节点的 id 已失效)
    for (const [nodeId, style] of this.oldStyles) {
      const node = pool.nodes.get(nodeId)
      if (node) {
        pool.updateNode(nodeId, style as Partial<TextNode>)
        pool.bumpNodeVersion(nodeId)
      }
    }

    // 2. 逆序合并拆分 (内层拆分先合并, 避免外层引用的 afterId 文本已被截断)
    for (const s of [...this.splits].reverse()) {
      const para = pool.nodes.get(s.paraId) as Paragraph | undefined
      const before = pool.nodes.get(s.nodeId) as TextNode | undefined
      const after = pool.nodes.get(s.afterId) as TextNode | undefined
      if (!para || !before || !after) continue
      pool.updateNode(s.nodeId, { text: before.text + after.text } as Partial<TextNode>)
      const idx = para.children.indexOf(s.afterId)
      if (idx >= 0) pool.removeChild(s.paraId, idx)
    }

    return { invalidation: 'paragraph' }
  }

  serialize(): SerializedCommand {
    return {
      type: 'format-text-range-revert', id: this.id, timestamp: this.timestamp,
      author: this.author,
    }
  }
}
