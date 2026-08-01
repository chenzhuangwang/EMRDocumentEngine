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

  // undo 快照
  private _snapshot: {
    rightText: string
    rightStyle: TextStyle | undefined
    rightChildren: string[]
    currentParaChildren: string[]
    truncatedTextNodeId: string | null
    originalText: string
  } | null = null

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
    // 先保存撤销快照
    this._snapshot = {
      rightText: '',
      rightStyle: undefined,
      rightChildren: [],
      currentParaChildren: [...currentPara.children],
      truncatedTextNodeId: null,
      originalText: '',
    }

    let rightText = ''
    let rightStyle: TextStyle | undefined
    const rightChildren: string[] = []

    const resolved = pool.resolveCharOffset(currentPara.id, this.offset)
    if (resolved) {
      const textNode = pool.nodes.get(resolved.textNodeId) as unknown as
        { text: string; font?: string; size?: number; bold?: boolean; italic?: boolean } | undefined
      if (textNode) {
        this._snapshot.truncatedTextNodeId = resolved.textNodeId
        this._snapshot.originalText = textNode.text
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

    // 完成快照: 记录拆分后的右侧数据
    this._snapshot.rightText = rightText
    this._snapshot.rightStyle = rightStyle
    this._snapshot.rightChildren = [...rightChildren]

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
    // Step 4: 光标定位到粘贴内容末尾 + 清空选区
    const lastId = this.insertedParaIds[this.insertedParaIds.length - 1] || this.insertedParaIds[0] || currentPara.id
    const lastPlaced = pool.nodes.get(lastId) as Paragraph | undefined
    let endOffset = 0
    if (lastPlaced) {
      for (const cid of lastPlaced.children) {
        const n = pool.nodes.get(cid) as { type?: string; text?: string } | undefined
        endOffset += n?.type === 'text' ? ((n.text || '').length) : 1
      }
    }
    return {
      cursor: { paragraphPath: [...this.path.slice(0, -1), lastId], offset: endOffset },
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

  invert(ctx: CommandContext): ICommand | null {
    if (this.insertedParaIds.length === 0 || !this._snapshot) return null
    // 返回一个执行反向操作的命令: 删除插入的段落 + 恢复原状
    return new UndoPasteCommand(
      generateCommandId(), Date.now(), this.author,
      this.path, this.insertedParaIds, this._snapshot,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'insert-nodes', id: this.id, timestamp: this.timestamp,
      author: this.author, path: this.path, offset: this.offset,
      text: JSON.stringify(this.nodes),
    }
  }
}

// ================================================================
// UndoPasteCommand — 粘贴撤销: 删除插入段落 + 恢复原段落
// ================================================================
class UndoPasteCommand implements ICommand {
  readonly type = 'undo-paste'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private path: string[]
  private paraIds: string[]
  private snapshot: {
    currentParaChildren: string[]
    truncatedTextNodeId: string | null
    originalText: string
  }

  constructor(id: string, ts: number, author: string, path: string[], paraIds: string[], snapshot: { currentParaChildren: string[]; truncatedTextNodeId: string | null; originalText: string }) {
    this.id = id; this.timestamp = ts; this.author = author
    this.path = path; this.paraIds = paraIds; this.snapshot = snapshot
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx

    // 1. 从 body 中移除所有插入的段落 (从后往前避免索引漂移)
    const parentId = this.path.length >= 2 ? this.path[this.path.length - 2] : pool.rootIds.body
    const siblings = [...pool.getChildren(parentId)]
    for (const id of [...this.paraIds].reverse()) {
      const idx = siblings.indexOf(id)
      if (idx >= 0) { pool.removeChild(parentId, idx); siblings.splice(idx, 1) }
    }

    // 2. 恢复原段落 children
    const currentPara = pool.nodes.get(this.path[this.path.length - 1]) as { children: string[] } | undefined
    if (currentPara) currentPara.children = [...this.snapshot.currentParaChildren]

    // 3. 恢复被截断的文本节点
    if (this.snapshot.truncatedTextNodeId) {
      pool.updateNode(this.snapshot.truncatedTextNodeId, { text: this.snapshot.originalText } as Partial<unknown>)
    }

    return { invalidation: 'flowbody' }
  }

  serialize(): SerializedCommand {
    return { type: 'undo-paste', id: this.id, timestamp: this.timestamp, author: this.author }
  }
}