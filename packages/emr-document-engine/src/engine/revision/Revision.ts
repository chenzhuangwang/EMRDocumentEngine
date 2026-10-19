// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// Revision — 修订留痕的**唯一盖戳点** (契约 §12.13)
//
// 留痕要回答三件事: 现在追不追踪、是谁改的、什么时候改的。三件事都**不在命令里**:
// 命令只该知道"我这次改动的这段文字属于谁、什么时候"。所以事实由
// CommandManager.buildContext() 一次性注入, 命令用 RevisionStamp 落章。
//
// 为什么必须集中 (而不是每个命令各写一遍):
//   - 时钟只读一次。若各命令自己 `new Date()`, 同一次用户操作里跨两个命令的
//     文字会拿到不同的时间戳, 而 undo/redo 重放时更是每次一个新时钟 ——
//     §8.3 的「带 id 的序列化逐字节相同」当场破。
//   - 未开启追踪时不产生标记这件事只有一个判据 (ctx.tracking), 不是五份。
//   - 将来加"哪些改动算修订"的规则时, 改一处而不是改一个清单。
//
// 命令的重放语义: **首次 forward 缓存, 之后复用**。见 RevisionStamp。
// ================================================================

import type { RevisionMark } from '../document/core/DocumentModel'

/** 当前修订者 (PRD F21.6 的"修订者颜色"按 authorId 分派, 故 id 与 name 都要) */
export interface RevisionUser {
  name: string
  id?: string
}

/**
 * 盖戳上下文 —— 由 CommandManager 在**每次执行**时构造一次 (契约 §12.13)。
 *
 * `at` 在这里取一次时钟, 之后同一个 ctx 被同一次执行内触发的所有命令共享
 * (含 MacroCommand 的子命令, 它们拿到的是同一个 ctx)。
 */
export interface RevisionContext {
  /** 修订追踪开关 (Editor.setTrackChanges) */
  tracking: boolean
  /** 当前用户; 未设置时留痕不带作者 (仍记录"有人改过") */
  user?: RevisionUser
  /** epoch ms — 本次执行的唯一时刻 */
  at: number
}

/** 追踪关闭、也无人时仍可用的空上下文 (命令在无 ctx 时的安全回退: 不盖戳) */
export const NO_REVISION: RevisionContext = { tracking: false, at: 0 }

/**
 * 一次盖戳的**可重放**结果 (契约 §12.13 / §8.3)。
 *
 * 命令首次 forward 时 `resolve()` 记下标记, 之后每次 redo 都拿到**同一个对象内容**
 * —— 否则 `at` 每次都换一个时钟, redo 出来的文档与首次逐字节不同。
 */
export class RevisionStamp {
  private mark: RevisionMark | null = null
  private resolved = false

  /**
   * 解析本次要盖的标记; `null` = 不盖。
   *
   * 只在本命令的首次 forward 里读 ctx —— 重放时 ctx 里是新的时钟, 用它会污染。
   */
  resolve(ctx: RevisionContext, type: 'insert' | 'delete'): RevisionMark | null {
    if (!this.resolved) {
      this.resolved = true
      this.mark = ctx.tracking ? makeMark(type, ctx) : null
    }
    return this.mark
  }

  /** 已解析出的标记 (未解析或判定不盖时为 null) */
  get value(): RevisionMark | null { return this.mark }

  /** 是否已经解析过 (供命令判断本次 forward 是否为首次) */
  get isResolved(): boolean { return this.resolved }
}

/** 纯函数形式 (不需要重放语义的一次性用途, 如导入器/命令内部临时判断) */
export function makeMark(type: 'insert' | 'delete' | 'modify', ctx: RevisionContext): RevisionMark {
  const mark: RevisionMark = { type }
  if (ctx.user?.name) mark.author = ctx.user.name
  if (ctx.user?.id) mark.authorId = ctx.user.id
  if (ctx.at > 0) mark.at = ctx.at
  return mark
}

/**
 * 两个标记是否"同类" —— 用于判断合并文本节点时标记会不会被抹掉。
 *
 * 比 type + 作者,**不比时间**: 同一段连续输入可能跨两次命令 (两次 at 不同),
 * 但它们是同一条修订记录, 该合就合。不能合的是: 一个有标记一个没有 (合了标记
 * 丢失)、insert 与 delete (合了删除线消失或被删文字被染成新增色)、
 * 两个不同作者 (合了会张冠李戴)。
 */
export function sameRevisionKind(
  a: RevisionMark | undefined,
  b: RevisionMark | undefined,
): boolean {
  if (!a || !b) return !a && !b
  return a.type === b.type && a.authorId === b.authorId && a.author === b.author
}

/**
 * 文档里一处修订的只读条目 (契约 §12.13) —— `Editor.listRevisions()` 的返回元素。
 *
 * 带 `text` 是有意的: 审阅面板要显示"改的是哪段字"。不给的话 UI 只能拿着
 * nodeId 再向引擎要一次文字, 那就成了第二个查询入口。
 * 这是**读**模型, 不参与持久化 —— 与 RevisionMark 本身无关。
 */
export interface RevisionListEntry {
  nodeId: string
  paraId: string
  /** 光标定位路径 —— 与全仓一致的 2 元素 [documentRootId, paragraphId] (§31.4) */
  paragraphPath: string[]
  /**
   * 该修订在**段落内**的字符偏移 (与光标同一口径: 文本计 length, 原子内联计 1)。
   * 面板点击定位用它 —— 只给段落 id 的话会跳到段首, 不是"这一处修订"。
   */
  offset: number
  type: RevisionMark['type']
  /** 该文字节点的当前文字 (面板展示片段用) */
  text: string
  author?: string
  at?: number
}
