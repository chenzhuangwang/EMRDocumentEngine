// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// InsertImageCommand — 光标处插入图片 (架构 §5, TASK-447)
//
// 图片插入在文本中间时需要拆分文本节点 (与 InsertTextCommand 一致的拆分语义),
// 因此使用专用命令而非通用 InsertInlineNodeCommand。
//
// undo: 摘除图片 + 拆分出的右半文本节点, 并恢复被截断的文本节点。
// ================================================================

import type { BaseNode, TextNode } from '../../document/core/DocumentModel'
import { createTextNode, extractStyle } from '../../document/factory/ElementFormatter'
import {
  ICommand, CommandContext, StatePatch, SerializedCommand, generateCommandId,
} from '../ICommand'
import { MintedOnce } from './MintedNodes'

export class InsertImageCommand implements ICommand {
  readonly type = 'insert-image'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private path: string[]
  private offset: number
  private dataUrl: string
  private naturalW?: number
  private naturalH?: number

  private insertedImageId: string | null = null
  private splitAfterNodeId: string | null = null
  private truncatedTextNodeId: string | null = null
  private originalText = ''
  /** 铸造一次台账 (契约 §8.3): 图片与拆分出的后半段文本在 redo 时复用同一批 id */
  private mint = new MintedOnce()

  constructor(
    id: string, timestamp: number, author: string,
    path: string[], offset: number, dataUrl: string, naturalW?: number, naturalH?: number,
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.path = path; this.offset = offset
    this.dataUrl = dataUrl; this.naturalW = naturalW; this.naturalH = naturalH
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    const paraId = this.path[this.path.length - 1]

    // 限制显示宽度不超过内容区域
    const maxW = 794 - 180 // pageWidth - margins
    const displayW = Math.min(this.naturalW || maxW, maxW)
    const displayH = this.naturalW && this.naturalH
      ? (displayW / this.naturalW) * this.naturalH
      : 200

    const para = pool.nodes.get(paraId) as { children?: readonly string[] } | undefined

    // 落点解析 (**每次** forward 都做, undo 已还原段落, 结果与首次一致 ——
    // 与 InsertInlineNodeCommand 同语义)。铸造决策随之定下, 但铸造本身只做一次。
    let targetIdx = -1
    let localOffset = 1
    let splitText: TextNode | null = null
    let splitAt = 0
    if (para?.children) {
      const resolved = pool.resolveCharOffset(paraId, this.offset)
      if (resolved) {
        targetIdx = para.children.indexOf(resolved.textNodeId)
        localOffset = resolved.localOffset
        const target = pool.nodes.get(resolved.textNodeId)
        if (target && (target as { type?: string }).type === 'text') {
          const t = target as unknown as TextNode
          // 光标在文本中间 → 拆成左右两半, 图片落于其间
          if (localOffset > 0 && localOffset < t.text.length) {
            splitText = t
            splitAt = localOffset
          }
        }
      }
    }

    // 铸造一次 (契约 §8.3): 图片节点 (以及文本中间分支拆出的后半段) 在 redo 时
    // 必须复用同一批 id, 否则后续以图片 id 为目标的命令在重放时解析不到。
    const roots = this.mint.run(pool, () => {
      const imgNode = {
        type: 'image' as const,
        id: generateCommandId(),
        src: this.dataUrl,
        width: displayW,
        height: displayH,
        naturalWidth: this.naturalW,
        naturalHeight: this.naturalH,
        wrapMode: 'top-bottom' as const,
      }
      pool.addNode(imgNode as unknown as BaseNode)
      const ids = [imgNode.id]
      if (splitText) {
        const afterNode = createTextNode(splitText.text.slice(splitAt), extractStyle(splitText))
        pool.addNode(afterNode)
        ids.push(afterNode.id)
      }
      return ids
    })
    const imageId = roots[0]
    const afterNodeId: string | null = roots.length > 1 ? roots[1] : null
    this.insertedImageId = imageId
    this.splitAfterNodeId = afterNodeId
    this.truncatedTextNodeId = splitText ? splitText.id : null
    this.originalText = splitText ? splitText.text : ''

    // 落位 —— 每次 forward 都做 (重放时节点只是被重新注册, 尚未在父容器里)
    if (para?.children) {
      if (splitText && afterNodeId) {
        pool.updateNode(splitText.id, { text: splitText.text.slice(0, splitAt) } as Partial<TextNode>)
        pool.insertChildren(paraId, [imageId, afterNodeId], targetIdx + 1)
      } else if (targetIdx >= 0) {
        // 目标是文本首/尾, 或内联非文本节点 (image/field/footnote_ref):
        // localOffset 0=前, 1=后
        pool.insertChild(paraId, imageId, targetIdx + (localOffset >= 1 ? 1 : 0))
      } else {
        // 空段落 / 越界 / 悬空引用 → 追加到末尾
        pool.insertChild(paraId, imageId, para.children.length)
      }
    }

    // 光标移到图片之后 (图片占 1 字符), 使后续输入落在图片之后而非之前
    const afterOffset = pool.getCharOffset(paraId, imageId, 1)
    return {
      cursor: { paragraphPath: [...this.path], offset: afterOffset, visible: true },
      invalidation: 'paragraph',
    }
  }

  invert(_ctx: CommandContext): ICommand | null {
    if (!this.insertedImageId) return null
    return new RemoveImageCommand(
      generateCommandId(), Date.now(), this.author,
      this.path, this.offset,
      this.insertedImageId, this.splitAfterNodeId, this.truncatedTextNodeId, this.originalText,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'insert-image', id: this.id, timestamp: this.timestamp,
      author: this.author, path: this.path, offset: this.offset,
    }
  }
}

class RemoveImageCommand implements ICommand {
  readonly type = 'remove-image'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private path: string[]
  private offset: number
  private imageId: string
  private afterNodeId: string | null
  private truncatedTextNodeId: string | null
  private originalText: string

  constructor(
    id: string, timestamp: number, author: string,
    path: string[], offset: number,
    imageId: string, afterNodeId: string | null, truncatedTextNodeId: string | null, originalText: string,
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.path = path; this.offset = offset
    this.imageId = imageId; this.afterNodeId = afterNodeId
    this.truncatedTextNodeId = truncatedTextNodeId; this.originalText = originalText
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    const paraId = this.path[this.path.length - 1]
    const para = pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
    if (para?.children) {
      const imageIdx = para.children.indexOf(this.imageId)
      if (imageIdx >= 0) pool.detachChild(paraId, imageIdx)
      if (this.afterNodeId) {
        const afterIdx = para.children.indexOf(this.afterNodeId)
        if (afterIdx >= 0) pool.detachChild(paraId, afterIdx)
      }
    }
    pool.removeNode(this.imageId)
    if (this.afterNodeId) pool.removeNode(this.afterNodeId)
    if (this.truncatedTextNodeId) {
      pool.updateNode(this.truncatedTextNodeId, { text: this.originalText } as Partial<TextNode>)
    }
    return {
      cursor: { paragraphPath: [...this.path], offset: this.offset, visible: true },
      invalidation: 'paragraph',
    }
  }

  serialize(): SerializedCommand {
    return { type: 'remove-image', id: this.id, timestamp: this.timestamp, author: this.author }
  }
}
