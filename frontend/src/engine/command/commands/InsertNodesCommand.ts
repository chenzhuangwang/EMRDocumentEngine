// ================================================================
// InsertNodesCommand — 粘贴命令 (v3 精简修复)
//
// forward:
//   1. 光标处拆分当前段落, 右半文本+子节点暂存
//   2. 反序列化粘贴段落 → 全部注册到 pool → 批量 insertChild
//   3. 右半追加到最后一个段落后
//   4. 光标定位到粘贴内容首段
//
// 关键修复:
//   - 简化插入索引: 从 currentPara 位置 +1 开始连续插入
//   - 右半空文本不再创建新节点
//   - deserialize 过滤 id/type/children 防止覆盖
// ================================================================

import type { Paragraph, TextStyle } from '../../document/DocumentModel'
import {
  createParagraph, createTextNode, extractStyle,
} from '../../document/ElementFormatter'
import { generateId } from '../../document/DocumentModel'
import {
  ICommand, CommandContext, StatePatch,
  SerializedCommand, PositionalCommand, generateCommandId,
} from '../ICommand'
import type { SerializedPara, SerializedChild } from './ClipboardManager'

/** 文本样式字段 (过滤掉 id/type/children) */
const TEXT_STYLE_KEYS = [
  'font', 'size', 'bold', 'italic', 'underline', 'underlineStyle',
  'strikeout', 'color', 'highlight', 'superscript', 'subscript', 'letterSpacing',
]

export class InsertNodesCommand extends PositionalCommand {
  readonly type = 'insert-nodes'
  readonly nodes: SerializedPara[]
  private insertedParaIds: string[] = []

  constructor(
    id: string, timestamp: number, author: string,
    path: string[], offset: number,
    nodes: SerializedPara[],
  ) {
    super(id, timestamp, author, path)
    this.offset = offset
    this.nodes = nodes
  }
  readonly offset: number

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    if (this.nodes.length === 0) return null

    const currentPara = pool.nodes.get(this.path[this.path.length - 1]) as Paragraph | undefined
    if (!currentPara) return null

    const parentId = this.path.length >= 2 ? this.path[this.path.length - 2] : pool.rootIds.body

    // ================================================================
    // Step 1: 光标处拆分当前段落
    // ================================================================
    let rightText = ''
    let rightStyle: TextStyle | undefined
    const rightChildren: string[] = []

    const resolved = pool.resolveCharOffset(currentPara.id, this.offset)
    if (resolved) {
      const textNode = pool.nodes.get(resolved.textNodeId) as unknown as
        { text: string; font?: string; size?: number; bold?: boolean; italic?: boolean } | undefined
      if (textNode) {
        rightText = textNode.text.slice(resolved.localOffset)
        // 仅当有右侧文本时才截断原节点
        if (rightText.length > 0) {
          rightStyle = extractStyle(textNode as unknown as import('../../document/DocumentModel').TextNode)
          pool.updateNode(resolved.textNodeId,
            { text: textNode.text.slice(0, resolved.localOffset) } as Partial<unknown>)
        }
        // 拆分点之后的子节点移走
        const splitIdx = currentPara.children.indexOf(resolved.textNodeId)
        if (splitIdx >= 0) {
          rightChildren.push(...currentPara.children.slice(splitIdx + 1))
          currentPara.children.splice(splitIdx + 1)
        }
      }
    }

    // ================================================================
    // Step 2: 反序列化粘贴段落, 批量插入
    // ================================================================
    this.insertedParaIds = []

    // 固定插入位置: currentPara 之后
    const siblings = [...pool.getChildren(parentId)]
    const baseIdx = siblings.indexOf(currentPara.id)
    let insertAt = baseIdx + 1

    for (const sn of this.nodes) {
      const newPara = this.deserializePara(sn, pool)
      this.insertedParaIds.push(newPara.id)
      pool.insertChild(parentId, newPara.id, insertAt)
      insertAt++
    }

    // ================================================================
    // Step 3: 右半追加到最后一个段落
    // ================================================================
    const lastParaId = this.insertedParaIds[this.insertedParaIds.length - 1]
    const lastPara = lastParaId ? pool.nodes.get(lastParaId) as Paragraph | undefined : undefined

    if (lastPara && (rightText.length > 0 || rightChildren.length > 0)) {
      if (rightText.length > 0) {
        const tn = createTextNode(rightText, rightStyle)
        pool.nodes.set(tn.id, tn)
        lastPara.children.push(tn.id)
      }
      for (const childId of rightChildren) {
        lastPara.children.push(childId)
      }
    } else if (!lastPara && (rightText.length > 0 || rightChildren.length > 0)) {
      // 粘贴内容为空 → 右半回退到原段落
      if (rightText.length > 0) {
        const tn = createTextNode(rightText, rightStyle)
        pool.nodes.set(tn.id, tn)
        currentPara.children.push(tn.id)
      }
      for (const childId of rightChildren) {
        currentPara.children.push(childId)
      }
    }

    // ================================================================
    // Step 4: 光标定位 + 清空选区
    // ================================================================
    const cursorParaId = this.insertedParaIds[0] || currentPara.id
    return {
      cursor: { paragraphPath: [...this.path.slice(0, -1), cursorParaId], offset: 0 },
      selection: {
        anchor: { paragraphPath: [], offset: 0, visible: false },
        focus: { paragraphPath: [], offset: 0, visible: false },
        active: false, granularity: 'character',
      },
      invalidation: 'flowbody',
    }
  }

  // ================================================================
  // 反序列化: 段落 + 子节点 → 注册到 pool
  // 关键: createParagraph/createTextNode 自动生成新 UUID,
  //       禁止从序列化数据中恢复旧 ID, 防止池冲突
  // ================================================================
  private deserializePara(sn: SerializedPara, pool: import('../../document/NodePool').NodePool): Paragraph {
    const para = createParagraph()
    // 恢复段落样式 (不含 id/type/children)
    Object.assign(para, sn.style)
    para.children = []

    for (const childSn of sn.children) {
      if (childSn.type === 'text' || childSn.type === 'smarttext') {
        const style: Record<string, unknown> = {}
        for (const k of TEXT_STYLE_KEYS) { if (k in childSn) style[k] = childSn[k] }
        const tn = createTextNode((childSn.text as string) || '', style as unknown as TextStyle)
        if (childSn.element) (tn as Record<string, unknown>).element = childSn.element
        pool.nodes.set(tn.id, tn)
        para.children.push(tn.id)
      } else {
        // 非文本: 全字段复制, 但重新生成 ID
        const node = { ...childSn } as Record<string, unknown>
        delete node.id // 擦除旧 ID
        node.id = generateId() // 新节点 UUID
        pool.nodes.set(node.id as string, node as unknown as import('../../document/DocumentModel').BaseNode)
        para.children.push(node.id as string)
      }
    }

    pool.nodes.set(para.id, para)
    return para
  }

  invert(_ctx: CommandContext): ICommand | null {
    // 粘贴撤销需删除多个段落, 实现较复杂, 暂返回 null
    // 后续可通过复合命令 (MacroCommand) 实现
    return null
  }

  serialize(): SerializedCommand {
    return {
      type: 'insert-nodes', id: this.id, timestamp: this.timestamp,
      author: this.author, path: this.path, offset: this.offset,
      text: JSON.stringify(this.nodes),
    }
  }
}
