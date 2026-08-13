// ================================================================
// MergeParagraphCommand — 退格并段 (架构 §6.6, v20.34)
//
// forward: 当前段 children 追加到上一段 → 合并 → 删除当前段
// invert: 子树快照式 — forward 前存储被删段落的完整快照
// ================================================================

import type { Paragraph } from '../../document/DocumentModel'
import { ICommand, CommandContext, StatePatch, SerializedCommand, PositionalCommand } from '../ICommand'
import { normalizeParagraph } from './ParagraphUtils'

export class MergeParagraphCommand extends PositionalCommand {
  readonly type = 'merge-paragraph'
  private deletedParaId?: string
  private deletedParaSnapshot?: string
  private mergeOffset?: number

  constructor(id: string, timestamp: number, author: string, path: string[]) {
    super(id, timestamp, author, path)
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    const currentPara = pool.nodes.get(this.path[this.path.length - 1]) as Paragraph | undefined
    if (!currentPara) return null

    // 1. 找上一段
    const parentId = this.path.length >= 2 ? this.path[this.path.length - 2] : pool.rootIds.body
    const siblings = [...pool.getChildren(parentId)]
    if (siblings.length === 0) return null
    const currentIdx = siblings.indexOf(currentPara.id)
    if (currentIdx <= 0) return null
    const prevNode = pool.nodes.get(siblings[currentIdx - 1])
    // 上一兄弟必须是段落, 才能合并; 否则 (表格/图片/分隔符等) 退格不并段,
    // 避免把 text 节点误插进表格的 children (rows) 破坏结构
    if (!prevNode || prevNode.type !== 'paragraph') return null
    const prevPara = prevNode as Paragraph

    // 2. 快照被删段落子树
    this.deletedParaId = currentPara.id
    this.deletedParaSnapshot = JSON.stringify(currentPara)

    // 3. 当前段全部 children 追加到上一段
    for (const childId of currentPara.children) {
      pool.insertChild(prevPara.id, childId, prevPara.children.length)
    }

    // 3.1 当前段有列表样式而上一段没有 → 传播列表样式
    if (currentPara.list && !prevPara.list) {
      pool.updateNode(prevPara.id, { list: currentPara.list } as Partial<Paragraph>)
    }

    // 4. 合并上一段
    normalizeParagraph(prevPara, pool)

    // 5. 删除当前段
    pool.removeChild(parentId, currentIdx)

    // 6. 光标定位到合并点
    let charCount = 0
    for (const childId of prevPara.children) {
      const node = pool.nodes.get(childId)
      if (node && (node as unknown as Record<string, unknown>).type === 'text') {
        charCount += ((node as unknown as Record<string, unknown>).text as string).length
      } else { charCount += 1 }
    }
    this.mergeOffset = charCount

    return {
      cursor: { paragraphPath: [...this.path.slice(0, -1), prevPara.id], offset: charCount },
      invalidation: 'flowbody',
    }
  }

  invert(): ICommand | null {
    return null  // v20.34: 子树恢复需在 Phase 2 实现
  }

  serialize(): SerializedCommand {
    return {
      type: 'merge-paragraph', id: this.id, timestamp: this.timestamp,
      author: this.author, path: this.path,
      deletedParaId: this.deletedParaId,
      deletedParaSnapshot: this.deletedParaSnapshot,
      mergeOffset: this.mergeOffset,
    }
  }
}
