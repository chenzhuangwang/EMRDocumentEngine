// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

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

import type { BaseNode, Paragraph, TextNode, RevisionMark, TextStyle } from '../../document/core/DocumentModel'
import type { NodePool } from '../../document/core/NodePool'
import { generateCommandId } from '../ICommand'
import type { ICommand } from '../ICommand'
import { CommandContext, StatePatch, SerializedCommand, PositionalCommand } from '../ICommand'
import { InsertTextCommand } from './InsertTextCommand'
import { normalizeParagraph } from './ParagraphUtils'
import { MintedOnce } from './MintedNodes'
import { createTextNode, extractStyle } from '../../document/factory/ElementFormatter'
import { RevisionStamp, NO_REVISION } from '../../revision/Revision'
import {
  captureParagraphSnapshot, RestoreParagraphsCommand,
  type ParagraphSnapshot,
} from './ParagraphSnapshot'

/** 段落显示长度 (文本按字符数, 非文本原子节点按 1) */
function paragraphCharLength(pool: NodePool, para: Paragraph): number {
  let len = 0
  for (const id of para.children) {
    const node = pool.nodes.get(id)
    if (!node) continue
    len += (node as unknown as { type?: string }).type === 'text'
      ? ((node as unknown as TextNode).text ?? '').length
      : 1
  }
  return len
}

export class DeleteRangeCommand extends PositionalCommand {
  readonly type = 'delete-range'
  readonly startOffset: number
  readonly endOffset: number
  private _deletedText = ''
  /** 删除开始处文本节点的样式 — 撤销时原样写回, 否则默认样式会把带格式的 run 拆开 */
  private _targetStyle: TextStyle | undefined
  /** 删除范围涉及非文本节点时捕获的整段快照; 否则保持 null (走文本反转) */
  private _paragraphSnapshot: ParagraphSnapshot | null = null
  /** 铸造一次台账 (契约 §8.3): 空段落补的空文本节点在 redo 时复用同一 id */
  private mint = new MintedOnce()
  /**
   * 追踪删除时拆分出来的 before/after 文本节点 (契约 §12.13)。
   * 与 `mint` 分开: 一个 MintedOnce 只能承载一组根 id。
   */
  private splitMint = new MintedOnce()
  /** 本次盖戳 (契约 §12.13) — 首次 forward 解析, 重放复用 */
  private stamp = new RevisionStamp()
  private tracked = false

  get deletedText(): string { return this._deletedText }

  // ---- 连续退格合并 (契约 §8.2 / CommandUndoRedoStack 的 500ms 窗口) ----
  //
  // 只合并「纯文本、未追踪、无整段快照」的**向左连续**删除 (Backspace)。
  // 向右删除 (Delete) 的两次范围相同 (光标不后退), 合并成一个范围只能删一个字,
  // 故此不合并 —— 宁可多一步撤销, 不可少删字。
  canMergeWith(other: ICommand): boolean {
    if (!(other instanceof DeleteRangeCommand)) return false
    if (this.tracked || other.tracked) return false
    if (this._paragraphSnapshot || other._paragraphSnapshot) return false
    if (this.path.join('.') !== other.path.join('.')) return false
    // 第二次删的范围必须紧接在第一次之前: [o-2,o-1) 紧接 [o-1,o)
    return other.endOffset === this.startOffset && other.startOffset < other.endOffset
  }

  mergeWith(other: ICommand): ICommand {
    const o = other as DeleteRangeCommand
    const merged = new DeleteRangeCommand(
      this.id, this.timestamp, this.author, [...this.path],
      o.startOffset, this.endOffset,
    )
    // 文档顺序: 先删的字符在后、后删的在前
    merged._deletedText = o.deletedText + this.deletedText
    // 合并区间从后一条的起点开始, 撤销也应由那个 run 的样式接住
    merged._targetStyle = o._targetStyle
    merged._paragraphSnapshot = null
    merged.tracked = false
    return merged
  }

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

    // 记下起点 run 的样式 (撤销用): 不传样式时 InsertTextCommand 按默认样式
    // 重建文字 —— 带字号/加粗的 run 被删一个字再撤销, 会变成"原样式 + 默认样式"
    // 两个 run, 逐字节不等 (契约 §8.3)。
    const startNode = pool.nodes.get(start.textNodeId)
    if ((startNode as { type?: string } | undefined)?.type === 'text') {
      this._targetStyle = extractStyle(startNode as TextNode)
    }

    // Step 1.5: 先快照整段 (供 invert 精确还原), 两种情形:
    //   a) 范围触及非文本节点 —— 文本反转重建不出非文本节点 (既有);
    //   b) 整段被删空 —— Step 4 会补一个空文本节点, 纯文本反转 (InsertTextCommand)
    //      无法把它撤掉, 会留下一个多余的空文本节点。
    // 两种都走整段快照精确还原 (RestoreParagraphsCommand), 否则 undo 不是精确逆 (§8.3)。
    //
    // 追踪开启时**一律**快照 (契约 §12.13): 本命令此时会把文字留在原地加删除线、
    // 或把待删的空格从待插 run 里摘走, 这些改动纯文本反转还原不出。
    const tracked = (() => {
      if (this.stamp.isResolved) return this.tracked
      this.stamp.resolve(ctx.revision ?? NO_REVISION, 'delete')
      this.tracked = this.stamp.value !== null
      return this.tracked
    })()
    const emptiesParagraph =
      this.startOffset === 0 && this.endOffset >= paragraphCharLength(pool, para)
    // c) 跨节点删除 —— 被删文字可能横跨多种样式, 而纯文本反转只按**插入目标**
    //    的一份样式重建; 且 normalize 可能吞掉被删空的 run. 样式与节点身份都会丢.
    // d) 整段覆盖某个 run —— InsertText 只能在目标 run 里补字, 还原不出被移除
    //    节点的 id (契约 §8.3: 带 id 的序列化逐字节相同).
    const crossesNodes = start.textNodeId !== end.textNodeId
    const removesWholeNode =
      this.rangeRemovesWholeNode(pool, para, this.startOffset, this.endOffset)
    if (tracked || crossesNodes || removesWholeNode
      || this.rangeTouchesNonText(pool, para, this.startOffset, this.endOffset)
      || emptiesParagraph) {
      this._paragraphSnapshot = captureParagraphSnapshot(pool, para)
    }
    const mark = this.stamp.value

    // Step 2: 提取被删文本 + 执行删除 (追踪开启时改为"留文加痕", 见 applyTracked)
    if (tracked && mark) {
      this.applyTracked(pool, para, mark)
    } else if (start.textNodeId === end.textNodeId) {
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
    // (契约 §12.13: 标记不同的节点不合并 —— 判据在 normalizeParagraph 里)
    normalizeParagraph(para, pool)

    // Step 4: 防止空段落僵尸 — 删除全部内容后至少保留一个空文本节点
    if (para.children.length === 0) {
      // 铸造一次 (契约 §8.3): redo 时补的空文本节点必须复用同一 id。逆操作走
      // Step 1.5 的整段快照 (不经过这里), 故这里只需保证**重放**产出同一 id。
      const [emptyTextId] = this.mint.run(pool, () => {
        const emptyText = createTextNode('')
        pool.addNode(emptyText as unknown as BaseNode)
        return [emptyText.id]
      })
      para.children = [emptyTextId]
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
      return new RestoreParagraphsCommand(
        generateCommandId(), Date.now(), this.author, [this._paragraphSnapshot],
      )
    }
    return new InsertTextCommand(
      generateCommandId(), Date.now(), this.author,
      this.path, this.startOffset, this._deletedText, this._targetStyle,
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

  /**
   * 追踪删除 (契约 §12.13): 文字**留在文档里**, 改为打 `delete` 标记。
   *
   * 三条规则, 都来自"留痕是文字自身的属性"这一个前提:
   *
   *   1. **删掉待接受的插入 = 取消它** —— 带 `insert` 标记的文字被删时直接移除,
   *      绝不叠加 `delete`。一次没被接受的插入被撤销, 不该变成一条删除记录
   *      (否则接受后那份文字会**复活**)。
   *   2. **已经是待删的就直接去掉该片段** —— 同一段文字被删两次不该有两层痕迹。
   *   3. **非文本节点不可挂标记** —— image / smarttext 落到范围内仍是真删
   *      (结构性改动不追踪, 契约 §12.13 的显式边界)。
   *
   * 部分覆盖必然要把一个 TextNode 切成 before | 覆盖段 | after。切开后**每个片段
   * 各自保留自己的标记**: 未覆盖的片段继承原节点的标记 (拆段不是"取消修订"),
   * 覆盖段拿新的 delete 标记。
   */
  private applyTracked(
    pool: NodePool,
    para: Paragraph,
    mark: RevisionMark,
  ): void {
    this._deletedText = ''
    // ---- 第一趟 (只读): 把每个子节点拆成片段, 算出最终样子 ----
    /** keep = 原样不动; edit = 复用原 id 但改 text/revision; fresh = 新节点 */
    type Piece =
      | { kind: 'keep'; id: string }
      | { kind: 'edit'; source: TextNode; id: string; text: string; mark?: RevisionMark }
      | { kind: 'fresh'; source: TextNode; text: string; mark?: RevisionMark }
    const pieces: Piece[] = []
    const dropped: string[] = []
    let offset = 0
    for (const childId of para.children) {
      const node = pool.nodes.get(childId)
      if (!node) continue
      const nodeType = (node as unknown as Record<string, unknown>).type
      const isText = nodeType === 'text'
      const len = isText ? ((node as TextNode).text ?? '').length : 1
      const nodeStart = offset
      const nodeEnd = offset + len
      offset = nodeEnd

      if (nodeEnd <= this.startOffset || nodeStart >= this.endOffset) {
        pieces.push({ kind: 'keep', id: childId })
        continue
      }
      if (!isText) {
        // 规则 3: 非文本节点不可挂标记 → 真删 (不产出片段)
        dropped.push(childId)
        continue
      }

      const tn = node as TextNode
      const ls = Math.max(0, this.startOffset - nodeStart)
      const le = Math.min(len, this.endOffset - nodeStart)
      const head = tn.text.slice(0, ls)
      const covered = tn.text.slice(ls, le)
      const tail = tn.text.slice(le)
      this._deletedText += covered
      const existing = tn.revision
      // 规则 1/2: 待接受的插入被删 = 取消 (整段去掉); 已是待删的片段也不重复加痕
      const cancel = existing?.type === 'insert'
      const alreadyDeleted = existing?.type === 'delete'

      let reuseId: string | null = tn.id
      const emit = (text: string, pieceMark: RevisionMark | undefined): void => {
        if (text === '') return
        if (reuseId !== null) {
          pieces.push({ kind: 'edit', source: tn, id: reuseId, text, ...(pieceMark ? { mark: pieceMark } : {}) })
          reuseId = null
        } else {
          pieces.push({ kind: 'fresh', source: tn, text, ...(pieceMark ? { mark: pieceMark } : {}) })
        }
      }
      emit(head, existing ? { ...existing } : undefined)
      if (!cancel && !alreadyDeleted) emit(covered, { ...mark })
      emit(tail, existing ? { ...existing } : undefined)
      // 三段全空 (整节点被取消) → 原节点注销
      if (reuseId !== null) dropped.push(tn.id)
    }

    // ---- 铸造新片段节点 (契约 §8.3: redo 复用同一批 id) ----
    const fresh = pieces.filter((p): p is Extract<Piece, { kind: 'fresh' }> => p.kind === 'fresh')
    const mintedIds = this.splitMint.run(pool, () => fresh.map((p) => {
      const n = createTextNode(p.text, extractStyle(p.source))
      if (p.mark) n.revision = { ...p.mark }
      pool.addNode(n)
      return n.id
    }))
    let next = 0

    // ---- 第二趟: 落到池上 ----
    const ids: string[] = []
    for (const p of pieces) {
      if (p.kind === 'keep') { ids.push(p.id); continue }
      if (p.kind === 'fresh') {
        const id = mintedIds[next++]
        ids.push(id)
        continue
      }
      pool.updateNode(p.id, { text: p.text } as Partial<TextNode>)
      // updateNode 写 revision: undefined 会留下"键在值空"; 无标记时真正删键
      if (p.mark) pool.updateNode(p.id, { revision: p.mark } as Partial<TextNode>)
      else pool.deleteNodeField(p.id, 'revision')
      ids.push(p.id)
    }
    para.children = ids

    // 被丢弃的原节点注销, 不留孤儿
    for (const id of dropped) {
      if (!ids.includes(id)) pool.removeNode(id)
    }
  }

  /** [startOffset, endOffset) 是否整段覆盖任一文本 run (含空 run) */
  private rangeRemovesWholeNode(pool: NodePool, para: Paragraph, startOffset: number, endOffset: number): boolean {
    let offset = 0
    for (const childId of para.children) {
      const node = pool.nodes.get(childId)
      if (!node) continue
      const isText = (node as unknown as { type?: string }).type === 'text'
      const len = isText ? ((node as unknown as TextNode).text ?? '').length : 1
      const nodeStart = offset
      const nodeEnd = offset + len
      offset = nodeEnd
      // 非文本节点的整段覆盖已由 rangeTouchesNonText 覆盖
      if (isText && nodeStart >= startOffset && nodeEnd <= endOffset) return true
    }
    return false
  }

  /** 判断 [startOffset, endOffset) 是否触及任何非文本节点 (决定是否快照整段) */
  private rangeTouchesNonText(pool: NodePool, para: Paragraph, startOffset: number, endOffset: number): boolean {    let offset = 0
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
