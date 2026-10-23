// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// SplitParagraphCommand — 回车拆段 (架构 §6.6, v20.34)
//
// forward: 字符偏移定位 → 截断 TextNode → 分裂 children → 新段落插入 FlowBody
// ================================================================

import type { Paragraph, TextNode, DocumentTree } from '../../document/core/DocumentModel'
import { createParagraph, createTextNode, extractStyle } from '../../document/factory/ElementFormatter'
import {
  ICommand, CommandContext, StatePatch, SerializedCommand, PositionalCommand, generateCommandId,
} from '../ICommand'
import { MintedOnce } from './MintedNodes'
import {
  captureParagraphSnapshot, RestoreParagraphsCommand, type ParagraphSnapshot,
} from './ParagraphSnapshot'
import { resolveParagraphRegion, isPoolRegion } from '../../state/CaretScope'

export class SplitParagraphCommand extends PositionalCommand {
  readonly type = 'split-paragraph'
  readonly offset: number
  private newParaId?: string
  /** 拆段前原段落的整段快照 (撤销时按它原样恢复 run 边界与节点 id) */
  private _beforeSnapshot: ParagraphSnapshot | null = null
  /** 铸造一次台账 (契约 §8.3): redo 复用首次的段落/文本节点 id */
  private mint = new MintedOnce()

  constructor(id: string, timestamp: number, author: string, path: string[], offset: number) {
    super(id, timestamp, author, path)
    this.offset = offset
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, doc } = ctx
    const para = pool.nodes.get(this.path[this.path.length - 1]) as Paragraph | undefined
    if (!para) return null

    // 拆段前的整段快照 (每次 forward 都重拍: redo 时原段落已被还原, 拍的正是
    // 拆段前那一刻)。撤销不能用"并段"近似 —— 并段会把接缝两侧本来就相邻的
    // run 合成一个, 并在切点处重造节点, run 边界与节点 id 都不再是原样 (§8.2)。
    this._beforeSnapshot = captureParagraphSnapshot(pool, para)

    // 1. 定位分裂点并对**原段落**截断 —— 每次 forward 都要做:
    //    undo 已把原段落还原, 重放必须重新切这一刀。
    //    (空段落 resolveCharOffset 返回 null → 直接落成"新空段落")
    const resolved = pool.resolveCharOffset(para.id, this.offset)
    let rightChildren: string[] = []
    let afterText: string | null = null
    let styleSource: TextNode | undefined

    if (resolved) {
      const { textNodeId, localOffset } = resolved
      const targetNode = pool.nodes.get(textNodeId) as TextNode | undefined
      if (!targetNode) return null
      const isText = (targetNode as unknown as { type?: string }).type === 'text'
      // 段落内 children 相对 index; 分裂点 = splitIdx(+1 若是 text 或 localOffset>=1)
      const splitIdx = para.children.indexOf(textNodeId)

      if (isText) {
        const textNode = targetNode as TextNode
        const beforeText = textNode.text.slice(0, localOffset)
        afterText = textNode.text.slice(localOffset)
        // 总是截断原始 TextNode (beforeText 可能为空字符串, 必须更新)
        pool.updateNode(textNode.id, { text: beforeText } as Partial<TextNode>)
        // 截断原始段落 children: 只保留到 splitIdx (含被截断的 TextNode)
        rightChildren = para.children.slice(splitIdx + 1)
        if (rightChildren.length > 0) pool.truncateChildren(para.id, splitIdx + 1)
        styleSource = textNode
      } else {
        // 非文本内联原子 (控件/图片等, localOffset: 0=前, 1=后): 只按边界切,
        // 绝不切它的占位文本 (修复: 控件后按 Enter 把 `[复选框]` 的残片拆成新段落文字)。
        // localOffset 1 = 光标在控件后 → 控件留在左段。
        const keepCount = splitIdx + (localOffset >= 1 ? 1 : 0)
        rightChildren = para.children.slice(keepCount)
        if (rightChildren.length > 0) pool.truncateChildren(para.id, keepCount)
      }
    }

    // 2. 铸造一次 (契约 §8.3): 新段落与拆出的文本节点在重放时必须复用同一批 id ——
    //    否则"在新段里打字"那条命令构造时捕获的段落 id 会悬空, redo 静默丢失。
    //    once 区只放**铸造**; children 的搬运在下面每次 forward 都做。
    const roots = this.mint.run(pool, () => {
      const p = createParagraph()
      pool.addNode(p)
      const ids: string[] = [p.id]
      if (afterText) {
        const afterNode = createTextNode(
          afterText, styleSource ? extractStyle(styleSource) : undefined,
        )
        pool.addNode(afterNode)
        p.children = [afterNode.id]
        ids.push(afterNode.id)
      }
      return ids
    })
    const newParaId = roots[0]
    const afterNodeId: string | undefined = roots.length > 1 ? roots[1] : undefined

    const newPara = pool.nodes.get(newParaId) as Paragraph
    this.newParaId = newParaId
    // 继承样式 (每次 forward 都设; 值来自已还原的原段落, 幂等)
    Object.assign(newPara, {
      alignment: para.alignment, indent: para.indent,
      firstLineIndent: para.firstLineIndent,
      lineHeight: para.lineHeight, list: para.list,
      outlineLevel: para.outlineLevel,
    })

    // 3. 每次 forward 重建新段落的 children: 拆出的文本节点 + 右侧原有子节点
    newPara.children = afterNodeId ? [afterNodeId] : []
    for (const childId of rightChildren) {
      pool.insertChild(newPara.id, childId, newPara.children.length)
    }

    // 4. 在所属区域 (body / cell / header / footer) 中插入新段落
    return this.insertAndReturn(para, newPara, pool, doc)
  }

  /** 在段落所属区域 (body / cell / header / footer) 中插入新段落, 返回光标指向新段落的 patch
   *
   *  v21.0 Phase 3: 支持 cell 内段落拆分; v21.1: 支持页眉/页脚段落拆分。
   *  通过 resolveParagraphRegion 统一确定兄弟容器, 避免把新段落误插入 body。
   */
  private insertAndReturn(
    para: Paragraph,
    newPara: Paragraph,
    pool: import('../../document/core/NodePool').NodePool,
    doc: DocumentTree,
  ): StatePatch | null {
    const region = resolveParagraphRegion(para.id, doc, pool)
    if (region) {
      // 直接在新段落所属区域的原段落之后插入 (body/section/cell 走 NodePool;
      // header/footer 是文档级 string[] 数组, 直接 splice)
      if (isPoolRegion(region)) {
        pool.insertChild(region.containerId, newPara.id, region.index + 1)
      } else {
        region.siblings.splice(region.index + 1, 0, newPara.id)
      }
      return {
        cursor: { paragraphPath: [...this.path.slice(0, -1), newPara.id], offset: 0 },
        invalidation: region.type === 'cell' ? 'table' : 'flowbody',
      }
    }

    // 兜底: 段落无法定位区域 (理论不可达) → 插入默认父节点
    const defaultParentId = this.path.length >= 2 ? this.path[this.path.length - 2] : pool.rootIds.body
    const siblings = [...pool.getChildren(defaultParentId)]
    pool.insertChild(defaultParentId, newPara.id, siblings.length)
    return {
      cursor: { paragraphPath: [...this.path.slice(0, -1), newPara.id], offset: 0 },
      invalidation: 'flowbody',
    }
  }

  invert(): ICommand | null {
    if (!this.newParaId || !this._beforeSnapshot) return null
    return new RestoreSplitCommand(
      generateCommandId(), Date.now(), this.author,
      this.newParaId, this._beforeSnapshot,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'split-paragraph', id: this.id, timestamp: this.timestamp,
      author: this.author, path: this.path, offset: this.offset,
      mergeTargetPath: this.newParaId ? [...this.path.slice(0, -1), this.newParaId] : undefined,
    }
  }
}

/**
 * 撤销拆段 — 摘除新段落子树, 再按拆段前的整段快照恢复原段落。
 *
 * 为什么不用「并段」近似: 拆段可能在 run 的任意位置切开, 也可能恰好切在
 * run 边界; 并段只在接缝处合并一对 run, 前者需要合并、后者不能合并, 同一条
 * 规则覆盖不了两种情况 —— 只有快照能逐字节还原节点 id 与 run 边界 (§8.2)。
 */
class RestoreSplitCommand implements ICommand {
  readonly type = 'restore-split-paragraph'
  constructor(
    readonly id: string,
    readonly timestamp: number,
    readonly author: string,
    private readonly newParaId: string,
    private readonly snapshot: ParagraphSnapshot,
  ) {}

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, doc } = ctx

    // 1. 新段落从所属容器摘除 (子树先留着, 下面按 id 注销)
    const region = resolveParagraphRegion(this.newParaId, doc, pool)
    if (!region) return null
    if (isPoolRegion(region)) pool.detachChild(region.containerId, region.index)
    else region.siblings.splice(region.index, 1)

    // 2. 注销新段落及其子树。右侧原有子节点也在其中 —— 它们属于快照,
    //    第 3 步会按快照重新注册 (id 与内容逐字节不变)。
    const stack = [this.newParaId]
    while (stack.length > 0) {
      const id = stack.pop()!
      const node = pool.nodes.get(id) as { children?: readonly string[] } | undefined
      if (!node) continue
      for (const child of node.children ?? []) stack.push(child)
      pool.removeNode(id)
    }

    // 3. 原段落按快照恢复 (摘除现状 → 重新注册 → 恢复 children 顺序)
    return new RestoreParagraphsCommand(
      generateCommandId(), Date.now(), this.author, [this.snapshot],
    ).forward(ctx)
  }

  invert(): ICommand | null { return null }

  serialize(): SerializedCommand {
    return { type: this.type, id: this.id, timestamp: this.timestamp, author: this.author }
  }
}
