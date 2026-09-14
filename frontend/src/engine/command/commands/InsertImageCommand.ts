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

import type { TextNode } from '../../document/core/DocumentModel'
import { createTextNode, extractStyle } from '../../document/factory/ElementFormatter'
import {
  ICommand, CommandContext, StatePatch, SerializedCommand, generateCommandId,
} from '../ICommand'

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
    pool.addNode(imgNode)
    this.insertedImageId = imgNode.id

    const para = pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
    if (para?.children) {
      const resolved = pool.resolveCharOffset(paraId, this.offset)
      if (resolved) {
        const target = pool.nodes.get(resolved.textNodeId)
        const idx = para.children.indexOf(resolved.textNodeId)
        if (target && (target as { type?: string }).type === 'text') {
          const text = (target as unknown as { text: string }).text
          const lo = resolved.localOffset
          if (lo > 0 && lo < text.length) {
            // 光标在文本中间 → 拆分文本, 图片插入拆分点
            const afterNode = createTextNode(text.slice(lo), extractStyle(target as unknown as TextNode))
            pool.addNode(afterNode)
            pool.updateNode(target.id, { text: text.slice(0, lo) } as Partial<TextNode>)
            pool.insertChildren(paraId, [imgNode.id, afterNode.id], idx + 1)
            this.splitAfterNodeId = afterNode.id
            this.truncatedTextNodeId = target.id
            this.originalText = text
          } else {
            // 光标在文本首/尾 → 图片插到文本前/后
            pool.insertChild(paraId, imgNode.id, idx + (lo === 0 ? 0 : 1))
          }
        } else {
          // 内联非文本节点 (image/field/footnote_ref) → localOffset 0=前, 1=后
          pool.insertChild(paraId, imgNode.id, idx + (resolved.localOffset >= 1 ? 1 : 0))
        }
      } else {
        pool.insertChild(paraId, imgNode.id, para.children.length)
      }
    }

    // 光标移到图片之后 (图片占 1 字符), 使后续输入落在图片之后而非之前
    const afterOffset = pool.getCharOffset(paraId, imgNode.id, 1)
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
