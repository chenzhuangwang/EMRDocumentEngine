// ================================================================
// SplitParagraphCommand — 回车拆段 (架构 §6.6, v20.34)
//
// forward: 字符偏移定位 → 截断 TextNode → 分裂 children → 新段落插入 FlowBody
// ================================================================

import type { Paragraph, TextNode } from '../../document/DocumentModel'
import { createParagraph, createTextNode, extractStyle } from '../../document/ElementFormatter'
import { ICommand, CommandContext, StatePatch, SerializedCommand, PositionalCommand } from '../ICommand'
import { MergeParagraphCommand } from './MergeParagraphCommand'

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
    const { pool } = ctx
    const para = pool.nodes.get(this.path[this.path.length - 1]) as Paragraph | undefined
    if (!para) return null

    // 1. 按字符偏移定位 TextNode + localOffset
    const resolved = pool.resolveCharOffset(para.id, this.offset)

    if (!resolved) {
      // 空段落 (children=[]) → 创建新空段落, 光标移到新段落
      return this.splitEmptyParagraph(para, pool)
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
      const paraChildren = (para as unknown as { children: string[] }).children
      paraChildren.splice(splitIdx + 1, rightChildren.length)
    }

    // 3. 构造新段落 (继承样式)
    const newPara = createParagraph()
    if (afterText) {
      const afterNode = createTextNode(afterText, extractStyle(textNode))
      pool.nodes.set(afterNode.id, afterNode)
      newPara.children = [afterNode.id]
    }
    Object.assign(newPara, {
      alignment: para.alignment, indent: para.indent,
      lineHeight: para.lineHeight, list: para.list,
      outlineLevel: para.outlineLevel,
    })
    pool.nodes.set(newPara.id, newPara)
    this.newParaId = newPara.id

    // 4. 插入右半 children
    for (const childId of rightChildren) {
      pool.insertChild(newPara.id, childId, newPara.children.length)
    }

    // 5. 在 FlowBody 中插入新段落
    return this.insertAndReturn(para, newPara, pool)
  }

  /** 空段落拆分: 创建新空段落, 光标移至新段落 */
  private splitEmptyParagraph(para: Paragraph, pool: import('../../document/NodePool').NodePool): StatePatch | null {
    const newPara = createParagraph()
    Object.assign(newPara, {
      alignment: para.alignment, indent: para.indent,
      lineHeight: para.lineHeight, list: para.list,
      outlineLevel: para.outlineLevel,
    })
    pool.nodes.set(newPara.id, newPara)
    this.newParaId = newPara.id
    return this.insertAndReturn(para, newPara, pool)
  }

  /** 在 FlowBody 中插入新段落, 返回光标指向新段落的 patch
   *
   *  v21.0 Phase 3: 支持 cell 内段落拆分。
   *  当 paragraphPath 为 [docId, paraId] 但 paraId 实际在 cell 内时,
   *  自动沿 pool 反向查找 cell → 将新段落插入 cell.children。
   */
  private insertAndReturn(para: Paragraph, newPara: Paragraph, pool: import('../../document/NodePool').NodePool): StatePatch {
    // 尝试使用 path 倒数第二位作为 parentId (body 段落场景)
    const defaultParentId = this.path.length >= 2 ? this.path[this.path.length - 2] : pool.rootIds.body
    const siblings = [...pool.getChildren(defaultParentId)]
    const paraIndex = siblings.indexOf(para.id)

    if (paraIndex >= 0) {
      // 标准路径: 段落直接在 flow body 中
      pool.insertChild(defaultParentId, newPara.id, paraIndex + 1)
      return {
        cursor: { paragraphPath: [...this.path.slice(0, -1), newPara.id], offset: 0 },
        invalidation: 'flowbody',
      }
    }

    // v21.0: 段落不在 flow body → 可能在 cell 内
    // 沿 pool 反向查找包含 para.id 的 cell
    let cellParentId: string | null = null
    for (const [, node] of pool.nodes) {
      if (node.type !== 'cell') continue
      const cell = node as unknown as { id: string; children?: string[] }
      if (!cell.children?.includes(para.id)) continue
      cellParentId = cell.id
      break
    }

    if (cellParentId) {
      const cellChildren = [...pool.getChildren(cellParentId)]
      const cellIndex = cellChildren.indexOf(para.id)
      pool.insertChild(cellParentId, newPara.id, cellIndex >= 0 ? cellIndex + 1 : cellChildren.length)
      return {
        cursor: { paragraphPath: [...this.path.slice(0, -1), newPara.id], offset: 0 },
        invalidation: 'table',
      }
    }

    // 兜底: 无论如何尝试插入到默认父节点
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
