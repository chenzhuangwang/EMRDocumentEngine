// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// InsertTextCommand — Run 模型文本插入 (架构 §6.2, v20.34)
//
// 字符偏移语义: offset = 段落可见文本 UTF-16 字符偏移
// forward 内部强制经 resolveCharOffset → (textNodeId, localOffset)
// 严禁将 offset 直接用作 para.children 数组下标
// ================================================================

import type { Paragraph, TextNode, TextStyle, RevisionMark } from '../../document/core/DocumentModel'
import { extractStyle, sameStyle, createTextNode } from '../../document/factory/ElementFormatter'
import {
  ICommand, CommandContext, StatePatch,
  SerializedCommand, PositionalCommand, generateCommandId,
} from '../ICommand'
import { DeleteRangeCommand } from './DeleteRangeCommand'
import { normalizeParagraph } from './ParagraphUtils'
import { MintedOnce } from './MintedNodes'
import { RevisionStamp, NO_REVISION, sameRevisionKind } from '../../revision/Revision'

/** 两个标记是否同一作者 (撤销/续写时用于判断能否并入既有插入 run) */
function sameAuthor(a: RevisionMark, b: RevisionMark): boolean {
  return a.author === b.author && a.authorId === b.authorId
}

/**
 * 能否在既有 TextNode 里**原地追加**而不拆分 (契约 §12.13)。
 *
 * - 不追踪: 只在目标节点没有标记时可原地追加 —— 否则新敲的字会"继承"别人的
 *   修订标记, 而文本节点内没有第二份样式/标记可挂。
 * - 追踪: 只在目标节点本身就是**同一作者的待接受插入**时可原地追加
 *   (连续输入合成一条 run, 与 Word 同形); 其余一律拆成 before | new | after。
 */
function sameRevisionKindForInsert(existing: RevisionMark | undefined, next: RevisionMark | null): boolean {
  if (!next) return existing === undefined
  return existing?.type === 'insert' && sameAuthor(existing, next)
}

/** 两份样式是否逐字段相同 (合并连续输入的前提; undefined 与缺省字段视为不同, 宁可不合) */
function sameTextStyle(a?: TextStyle, b?: TextStyle): boolean {
  if (!a || !b) return a === b
  const keys: readonly (keyof TextStyle)[] = [
    'font', 'size', 'bold', 'italic', 'underline', 'underlineStyle', 'strikeout',
    'color', 'highlight', 'superscript', 'subscript', 'letterSpacing',
  ]
  return keys.every((k) => a[k] === b[k])
}

export class InsertTextCommand extends PositionalCommand {
  readonly type = 'insert-text'
  readonly text: string
  readonly style?: TextStyle
  /** 铸造一次台账 (契约 §8.3): redo 复用首次的文本节点 id */
  private mint = new MintedOnce()
  /**
   * 铸造时给新节点挂的标记 (契约 §12.13) — 只在首次 forward 解析, 重放复用。
   * 见 RevisionStamp: 重放若重新读时钟, redo 出的文档与首次不逐字节相同。
   */
  private stamp = new RevisionStamp()

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

  /**
   * 本次 forward 是否走了「直接追加进既有 TextNode」路径 (未拆分、未铸造)。
   *
   * 只有这条路径可以合并: 拆分路径的 undo 依赖 MintedOnce 台账与拆出的后半段,
   * 把两条合并成一条会让重放身份对不上 (契约 §8.3)。
   */
  private appendedInPlace = false

  /** 本次解析出的修订标记 (未追踪为 null) — 合并判定用 */
  get revisionMark(): RevisionMark | null { return this.stamp.value }

  // ---- 连续输入合并 (契约 §8.2 / CommandUndoRedoStack 的 500ms 窗口) ----

  canMergeWith(other: ICommand): boolean {
    if (!(other instanceof InsertTextCommand)) return false
    if (!this.appendedInPlace || !other.appendedInPlace) return false
    if (this.path.join('.') !== other.path.join('.')) return false
    // 只合并光标处连续追加: 第二段必须紧接第一段末尾
    if (other.offset !== this.offset + this.text.length) return false
    if (!sameTextStyle(this.style, other.style)) return false
    return sameRevisionKind(this.stamp.value ?? undefined, other.stamp.value ?? undefined)
  }

  mergeWith(other: ICommand): ICommand {
    const o = other as InsertTextCommand
    const merged = new InsertTextCommand(
      this.id, this.timestamp, this.author, [...this.path],
      this.offset, this.text + o.text, this.style,
    )
    merged.appendedInPlace = true
    // 复用第一条的盖戳台账: 合并后重放仍拿到首次解析出的同一个标记 (§8.3/§12.13)
    merged.stamp = this.stamp
    return merged
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    const para = pool.nodes.get(this.path[this.path.length - 1]) as Paragraph | undefined
    if (!para) return null

    // 本次要盖的标记 (追踪关闭 → null, 全文路径与旧行为逐字一致)
    const rctx = ctx.revision ?? NO_REVISION
    const newMark = this.stamp.resolve(rctx, 'insert')

    // Step 1: 字符偏移 → (textNodeId, localOffset)
    const resolved = pool.resolveCharOffset(para.id, this.offset)
    const textNodeId = resolved?.textNodeId ?? null
    const localOffset = resolved?.localOffset ?? 0
    const style = this.style ?? { font: 'SimSun', size: 16 }

    // Step 2: 判定目标节点是否为 text 节点。
    // resolveCharOffset 对内联非文本节点 (image/field/footnote_ref/cross_reference)
    // 返回该节点, localOffset 语义为 0=节点前、1=节点后。
    const targetNode = textNodeId ? pool.nodes.get(textNodeId) : undefined
    const isTextNode = !!targetNode &&
      (targetNode as unknown as Record<string, unknown>).type === 'text'

    if (!isTextNode) {
      // 非 text 目标 (内联非文本节点 / 悬空引用 / 空段落或越界):
      // 在正确位置新建 text 节点, 而非误用头部插入或把非文本节点当文本拆分。
      // 铸造一次 (契约 §8.3): redo 必须复用同一 id, 否则该节点在段落 children
      // 里的身份每次重放都变, 与「带 id 的序列化」判据不符。
      const [newNodeId] = this.mint.run(pool, () => {
        const n = createTextNode(this.text, style)
        if (newMark) n.revision = { ...newMark }
        pool.addNode(n)
        return [n.id]
      })
      if (textNodeId && targetNode) {
        // 内联非文本节点: localOffset 0=前, 1=后
        const idx = para.children.indexOf(textNodeId)
        pool.insertChild(para.id, newNodeId, idx + (localOffset >= 1 ? 1 : 0))
      } else if (textNodeId) {
        // 悬空引用: 清理孤儿 id 后头部插入, 避免静默吞掉输入
        const danglingIdx = para.children.indexOf(textNodeId)
        if (danglingIdx >= 0) pool.detachChild(para.id, danglingIdx)
        pool.insertChild(para.id, newNodeId, 0)
      } else {
        // offset=0 或空段落 → 在 para.children 头部插入
        pool.insertChild(para.id, newNodeId, 0)
      }
      normalizeParagraph(para, pool)
      return {
        cursor: { paragraphPath: this.path, offset: this.offset + [...this.text].length },
        invalidation: 'paragraph',
      }
    }

    // Step 3: 目标为 text 节点 → 在文本层面插入/拆分
    const textNode = targetNode as TextNode
    if (sameStyle(textNode, style) && sameRevisionKindForInsert(textNode.revision, newMark)) {
      // 样式一致 → 在 localOffset 处直接插入字符串
      const newText = textNode.text.slice(0, localOffset) + this.text + textNode.text.slice(localOffset)
      pool.updateNode(textNode.id, { text: newText } as Partial<TextNode>)
      // 只有这条路径可合并 (见 appendedInPlace 注释)
      this.appendedInPlace = true
      normalizeParagraph(para, pool)
      return {
        cursor: { paragraphPath: this.path, offset: this.offset + [...this.text].length },
        invalidation: 'paragraph',
      }
    }
    // 样式不同 → 拆分 TextNode + 插入新 TextNode
    const before = textNode.text.slice(0, localOffset)
    const after = textNode.text.slice(localOffset)
    pool.updateNode(textNode.id, { text: before || '' } as Partial<TextNode>)
    // 铸造一次 (契约 §8.3): 新文本节点与拆出的后半段在 redo 时复用同一批 id
    const roots = this.mint.run(pool, () => {
      const n = createTextNode(this.text, style)
      if (newMark) n.revision = { ...newMark }
      pool.addNode(n)
      const ids = [n.id]
      if (after) {
        // 拆出的后半段继承原节点的标记 (契约 §12.13): 拆段不是"取消修订",
        // 原封不动跟着文字走 —— 丢标记等于把待删文字悄悄变成正常文字。
        const a = createTextNode(after, extractStyle(textNode))
        if (textNode.revision) a.revision = { ...textNode.revision }
        pool.addNode(a)
        ids.push(a.id)
      }
      return ids
    })
    const newNodeId = roots[0]
    const afterNodeId: string | undefined = roots.length > 1 ? roots[1] : undefined
    const idx = para.children.indexOf(textNode.id)
    pool.insertChild(para.id, newNodeId, idx + 1)
    if (afterNodeId) {
      pool.insertChild(para.id, afterNodeId, idx + 2)
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
