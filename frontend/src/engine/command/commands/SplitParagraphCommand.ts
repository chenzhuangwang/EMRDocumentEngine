// ================================================================
// SplitParagraphCommand — 回车拆段 (架构 §6.6, v20.34)
//
// forward: 字符偏移定位 → 截断 TextNode → 分裂 children → 新段落插入 FlowBody
// ================================================================

import type { Paragraph, TextNode, DocumentTree } from '../../document/core/DocumentModel'
import { createParagraph, createTextNode, extractStyle } from '../../document/factory/ElementFormatter'
import { ICommand, CommandContext, StatePatch, SerializedCommand, PositionalCommand } from '../ICommand'
import { MergeParagraphCommand } from './MergeParagraphCommand'
import { resolveParagraphRegion } from '../../state/CaretScope'

export class SplitParagraphCommand extends PositionalCommand {
  readonly type = 'split-paragraph'
  readonly offset: number
  private newParaId?: string

  constructor(id: string, timestamp: number, author: string, path: string[], offset: number) {
    super(id, timestamp, author, path)
    this.offset = offset
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, doc } = ctx
    const para = pool.nodes.get(this.path[this.path.length - 1]) as Paragraph | undefined
    if (!para) return null

    // 1. 按字符偏移定位 TextNode + localOffset
    const resolved = pool.resolveCharOffset(para.id, this.offset)

    if (!resolved) {
      // 空段落 (children=[]) → 创建新空段落, 光标移到新段落
      return this.splitEmptyParagraph(para, pool, doc)
    }

    const { textNodeId, localOffset } = resolved
    const textNode = pool.nodes.get(textNodeId) as TextNode | undefined
    if (!textNode) return null

    const beforeText = textNode.text.slice(0, localOffset)
    const afterText = textNode.text.slice(localOffset)

    // 2. 分裂 children
    const splitIdx = para.children.indexOf(textNodeId)
    const rightChildren = para.children.slice(splitIdx + 1)
    // 总是截断原始 TextNode (beforeText 可能为空字符串, 必须更新)
    pool.updateNode(textNode.id, { text: beforeText } as Partial<TextNode>)
    // 截断原始段落 children: 只保留到 splitIdx (含被截断的 TextNode)
    if (rightChildren.length > 0) {
      pool.truncateChildren(para.id, splitIdx + 1)
    }

    // 3. 构造新段落 (继承样式)
    const newPara = createParagraph()
    if (afterText) {
      const afterNode = createTextNode(afterText, extractStyle(textNode))
      pool.addNode(afterNode)
      newPara.children = [afterNode.id]
    }
    Object.assign(newPara, {
      alignment: para.alignment, indent: para.indent,
      lineHeight: para.lineHeight, list: para.list,
      outlineLevel: para.outlineLevel,
    })
    pool.addNode(newPara)
    this.newParaId = newPara.id

    // 4. 插入右半 children
    for (const childId of rightChildren) {
      pool.insertChild(newPara.id, childId, newPara.children.length)
    }

    // 5. 在 FlowBody 中插入新段落
    return this.insertAndReturn(para, newPara, pool, doc)
  }

  /** 空段落拆分: 创建新空段落, 光标移至新段落 */
  private splitEmptyParagraph(
    para: Paragraph,
    pool: import('../../document/core/NodePool').NodePool,
    doc: DocumentTree,
  ): StatePatch | null {
    const newPara = createParagraph()
    Object.assign(newPara, {
      alignment: para.alignment, indent: para.indent,
      lineHeight: para.lineHeight, list: para.list,
      outlineLevel: para.outlineLevel,
    })
    pool.addNode(newPara)
    this.newParaId = newPara.id
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
      // 直接在新段落所属区域的原段落之后插入 (body/header/footer/cell 数组)
      if (region.type === 'body' || region.type === 'cell') {
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
    if (!this.newParaId) return null
    return new MergeParagraphCommand(
      this.id + '_inv', Date.now(), this.author,
      [...this.path.slice(0, -1), this.newParaId],
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
