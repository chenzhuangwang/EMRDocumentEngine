// ================================================================
// InsertNodesCommand — 粘贴命令 (v4 就地拼接修复)
//
// forward:
//   1. 光标处拆分当前段落, 右半文本+子节点暂存
//   2. 反序列化粘贴段落
//   3. 首段并入左半 (当前段落) — 单段落粘贴就地追加, 不产生新段落
//   4. 其余段落作为新段落插入
//   5. 右半追加到末段
//   6. 光标定位到粘贴内容末尾
//
// 关键修复:
//   - 单段落粘贴: 就地拼接, 不再多出一个空行/新段落
//   - 多段落粘贴: 首段并入左半, 末段与右半合并, 与标准编辑器语义一致
//   - 撤销: detachChild 摘除 + createdLeafIds 精确清理, 不误删原始右半节点
// ================================================================

import type { Paragraph, TextNode, TextStyle, ElementMeta } from '../../document/core/DocumentModel'
import {
  createParagraph, createTextNode, createSmartTextNode, extractStyle,
} from '../../document/factory/ElementFormatter'
import { generateId } from '../../document/core/DocumentModel'
import {
  ICommand, CommandContext, StatePatch,
  SerializedCommand, PositionalCommand, generateCommandId,
} from '../ICommand'
import type { SerializedPara } from '../ClipboardManager'
import { normalizeParagraph } from './ParagraphUtils'
import { resolveParagraphRegion } from '../../state/CaretScope'

/** 文本样式字段 (过滤掉 id/type/children) */
const TEXT_STYLE_KEYS = [
  'font', 'size', 'bold', 'italic', 'underline', 'underlineStyle',
  'strikeout', 'color', 'highlight', 'superscript', 'subscript', 'letterSpacing',
]

export class InsertNodesCommand extends PositionalCommand {
  readonly type = 'insert-nodes'
  readonly nodes: SerializedPara[]
  private insertedParaIds: string[] = []
  /** 本次 forward 新建的叶节点 (文本/smarttext/...) id, 供撤销精确清理 */
  private createdLeafIds: string[] = []

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
    currentParaChildren: string[]
    truncatedTextNodeId: string | null
    originalText: string
  } | null = null

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, doc } = ctx
    if (this.nodes.length === 0) return null

    const currentPara = pool.nodes.get(this.path[this.path.length - 1]) as Paragraph | undefined
    if (!currentPara) return null

    const parentId = this.path.length >= 2 ? this.path[this.path.length - 2] : pool.rootIds.body

    // ================================================================
    // 撤销快照
    // ================================================================
    this._snapshot = {
      currentParaChildren: [...currentPara.children],
      truncatedTextNodeId: null,
      originalText: '',
    }
    this.insertedParaIds = []
    this.createdLeafIds = []

    // ================================================================
    // Step 1: 光标处拆分当前段落 → 左半 (currentPara) + 右半 (rightText/rightChildren)
    // ================================================================
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
          rightStyle = extractStyle(textNode as unknown as TextNode)
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
    // Step 2: 反序列化粘贴段落
    // ================================================================
    const pastedParas = this.nodes.map(sn => this.deserializePara(sn, pool))
    const first = pastedParas[0]
    const last = pastedParas[pastedParas.length - 1]

    // ================================================================
    // Step 3: 首段并入左半 (currentPara) — 单段落粘贴 = 就地追加, 不产生新段
    // ================================================================
    for (const childId of first.children) {
      currentPara.children.push(childId)
    }
    pool.removeNode(first.id)  // 首段包装节点已并入 currentPara, 丢弃
    normalizeParagraph(currentPara, pool)

    // ================================================================
    // Step 4: 其余段落作为新段落插入 (currentPara 之后)
    // 使用 resolveParagraphRegion 确定区域, 页眉/页脚粘贴不泄漏到 body。
    // ================================================================
    const region = resolveParagraphRegion(currentPara.id, doc, pool)
    if (region) {
      let insertAt = region.index + 1
      for (let i = 1; i < pastedParas.length; i++) {
        region.siblings.splice(insertAt, 0, pastedParas[i].id)
        this.insertedParaIds.push(pastedParas[i].id)
        insertAt++
      }
    } else {
      // 兜底: 段落无法定位区域 (理论不可达) → 插入默认父节点
      const siblings = [...pool.getChildren(parentId)]
      const baseIdx = siblings.indexOf(currentPara.id)
      let insertAt = baseIdx + 1
      for (let i = 1; i < pastedParas.length; i++) {
        pool.insertChild(parentId, pastedParas[i].id, insertAt)
        this.insertedParaIds.push(pastedParas[i].id)
        insertAt++
      }
    }

    // ================================================================
    // Step 5: 光标定位到粘贴内容末尾 (右半追加之前)
    // ================================================================
    const cursorPara = pastedParas.length >= 2 ? last : currentPara
    let cursorOffset = 0
    for (const cid of cursorPara.children) {
      const n = pool.nodes.get(cid) as { type?: string; text?: string } | undefined
      cursorOffset += n?.type === 'text' ? ((n.text || '').length) : 1
    }

    // ================================================================
    // Step 6: 右半追加到末段 (cursorPara)
    // ================================================================
    if (rightText.length > 0) {
      const tn = createTextNode(rightText, rightStyle)
      pool.addNode(tn)
      this.createdLeafIds.push(tn.id)
      cursorPara.children.push(tn.id)
    }
    for (const childId of rightChildren) {
      cursorPara.children.push(childId)
    }
    normalizeParagraph(cursorPara, pool)

    return {
      cursor: { paragraphPath: [...this.path.slice(0, -1), cursorPara.id], offset: cursorOffset },
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
  // 副作用: 新建叶节点 id 记入 createdLeafIds, 供撤销清理
  // ================================================================
  private deserializePara(sn: SerializedPara, pool: import('../../document/core/NodePool').NodePool): Paragraph {
    const para = createParagraph()
    // 恢复段落样式 (不含 id/type/children)
    Object.assign(para, sn.style)
    para.children = []

    for (const childSn of sn.children) {
      if (childSn.type === 'smarttext') {
        // smarttext: 保持结构化字段类型 (避免降级为 text)
        const style: Record<string, unknown> = {}
        for (const k of TEXT_STYLE_KEYS) { if (k in childSn) style[k] = childSn[k] }
        const element = (childSn.element as ElementMeta) ||
          { code: { internal: '', dataElement: '' }, name: '' }
        const st = createSmartTextNode((childSn.text as string) || '', element, style as unknown as TextStyle)
        pool.addNode(st)
        this.createdLeafIds.push(st.id)
        para.children.push(st.id)
      } else if (childSn.type === 'text') {
        const style: Record<string, unknown> = {}
        for (const k of TEXT_STYLE_KEYS) { if (k in childSn) style[k] = childSn[k] }
        const tn = createTextNode((childSn.text as string) || '', style as unknown as TextStyle)
        if (childSn.element) (tn as unknown as Record<string, unknown>).element = childSn.element
        pool.addNode(tn)
        this.createdLeafIds.push(tn.id)
        para.children.push(tn.id)
      } else {
        // 非文本: 全字段复制, 但重新生成 ID
        const node = { ...childSn } as Record<string, unknown>
        delete node.id // 擦除旧 ID
        node.id = generateId() // 新节点 UUID
        pool.addNode(node as unknown as import('../../document/core/DocumentModel').BaseNode)
        this.createdLeafIds.push(node.id as string)
        para.children.push(node.id as string)
      }
    }

    pool.addNode(para)
    return para
  }

  invert(_ctx: CommandContext): ICommand | null {
    if (!this._snapshot) return null
    // 返回一个执行反向操作的命令: 摘除插入段落 + 清理新建叶节点 + 恢复原状
    return new UndoPasteCommand(
      generateCommandId(), Date.now(), this.author,
      this.path, this.insertedParaIds, this.createdLeafIds, this._snapshot,
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
// UndoPasteCommand — 粘贴撤销: 摘除插入段落 + 恢复原段落
// ================================================================
class UndoPasteCommand implements ICommand {
  readonly type = 'undo-paste'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private path: string[]
  private paraIds: string[]
  private createdLeafIds: string[]
  private snapshot: {
    currentParaChildren: string[]
    truncatedTextNodeId: string | null
    originalText: string
  }

  constructor(
    id: string, ts: number, author: string, path: string[],
    paraIds: string[], createdLeafIds: string[],
    snapshot: { currentParaChildren: string[]; truncatedTextNodeId: string | null; originalText: string },
  ) {
    this.id = id; this.timestamp = ts; this.author = author
    this.path = path; this.paraIds = paraIds; this.createdLeafIds = createdLeafIds
    this.snapshot = snapshot
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, doc } = ctx

    // 1. 从当前段落所在区域摘除插入的段落 (不删子树, 保留原始右半节点引用)
    const regionPara = pool.nodes.get(this.path[this.path.length - 1])
    const region = regionPara ? resolveParagraphRegion(regionPara.id, doc, pool) : null
    if (region) {
      for (const id of this.paraIds) {
        const idx = region.siblings.indexOf(id)
        if (idx >= 0) region.siblings.splice(idx, 1)
      }
    } else {
      const parentId = this.path.length >= 2 ? this.path[this.path.length - 2] : pool.rootIds.body
      const siblings = [...pool.getChildren(parentId)]
      for (const id of this.paraIds) {
        const idx = siblings.indexOf(id)
        if (idx >= 0) { pool.detachChild(parentId, idx); siblings.splice(idx, 1) }
      }
    }

    // 2. 删除插入的段落包装节点
    for (const id of this.paraIds) {
      pool.removeNode(id)
    }

    // 3. 精确删除本次 forward 新建的叶节点 (已并入 currentPara 的首段子节点 / 右半文本节点)
    for (const id of this.createdLeafIds) {
      pool.removeNode(id)
    }

    // 4. 恢复原段落 children
    const currentPara = pool.nodes.get(this.path[this.path.length - 1]) as { children: string[] } | undefined
    if (currentPara) currentPara.children = [...this.snapshot.currentParaChildren]

    // 5. 恢复被截断的文本节点
    if (this.snapshot.truncatedTextNodeId) {
      pool.updateNode(this.snapshot.truncatedTextNodeId, { text: this.snapshot.originalText } as Partial<unknown>)
    }

    return { invalidation: 'flowbody' }
  }

  serialize(): SerializedCommand {
    return { type: 'undo-paste', id: this.id, timestamp: this.timestamp, author: this.author }
  }
}
