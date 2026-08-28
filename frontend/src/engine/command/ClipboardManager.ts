// ================================================================
// ClipboardManager — 编辑器内存剪贴板 (重构 v2)
//
// 复制: 复用与选区渲染一致的 offset 范围计算 → 段落级深度克隆
//   - 段落内按 offset 裁剪文本节点 (同 renderSelectionUnified 算法)
//   - 深度克隆保留全部字段: text, style, smarttext element meta, image
//   - 所有克隆节点生成全新 UUID
//   - 纯文本同步写入系统剪贴板
//
// 粘贴: 返回结构化节点数据 → InsertNodesCommand 消费
// ================================================================

import type { DocumentTree } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'
import { generateCommandId } from './ICommand'
import { generateId } from '../document/core/DocumentModel'
import { resolveCellPosition } from '../state/CaretScope'
import type { ClipboardHost } from '../host/EditorHost'

// ---- 类型 ----

export interface ClipboardData {
  nodes: SerializedPara[]
  plainText: string
}

export interface SerializedPara {
  type: string
  id: string
  style: Record<string, unknown>
  children: SerializedChild[]
}

export interface SerializedChild {
  type: string
  id: string
  [key: string]: unknown
}

// ---- 剪贴板 ----

export class ClipboardManager {
  private data: ClipboardData | null = null
  private clipboard: ClipboardHost

  constructor(clipboard: ClipboardHost) {
    this.clipboard = clipboard
  }

  hasData(): boolean { return this.data !== null }

  /** 内存剪贴板的纯文本表示 (null 表示无数据) — 供外部剪贴板同步对比 */
  getPlainText(): string | null {
    return this.data?.plainText ?? null
  }

  /**
   * 复制: 遍历选区范围内的段落 → 按 offset 裁剪 → 深度克隆
   *
   * 范围计算: 与 renderSelectionUnified 完全一致
   *   body 段落顺序 bodyChildren → aIdx/fIdx → lo/hi
   *   同段落: clipStart=min(anchor,focus), clipEnd=max(anchor,focus)
   *   跨段落: 首段 clipStart=loOff/clipEnd=∞, 末段 clipStart=0/clipEnd=hiOff
   */
  copy(
    anchorPath: string[], anchorOffset: number,
    focusPath: string[], focusOffset: number,
    _doc: DocumentTree, pool: NodePool,
  ): void {
    if (anchorPath.length === 0 || focusPath.length === 0) return

    const aId = anchorPath[anchorPath.length - 1]
    const fId = focusPath[focusPath.length - 1]

    // 检测 scope: body / cell (与 deleteSelectedRange 的选区域判定一致)
    const aCell = resolveCellPosition(aId, pool)
    const fCell = resolveCellPosition(fId, pool)

    // 跨域选区禁止复制 (body↔cell, 或不同 cell)
    if ((aCell && !fCell) || (!aCell && fCell)) return
    if (aCell && fCell && (aCell.tableId !== fCell.tableId || aCell.row !== fCell.row || aCell.col !== fCell.col)) return

    // 选区段落列表: cell 内用 cell.children, body 用 body.children
    let siblings: readonly string[]
    if (aCell) {
      const tableNode = pool.nodes.get(aCell.tableId) as { children?: string[] } | undefined
      const rowNode = tableNode ? pool.nodes.get(tableNode.children?.[aCell.row] || '') as { children?: string[] } | undefined : undefined
      const cellNode = rowNode ? pool.nodes.get(rowNode.children?.[aCell.col] || '') as { children?: string[] } | undefined : undefined
      siblings = cellNode?.children ?? []
    } else {
      siblings = pool.getChildren(pool.rootIds.body)
    }

    const aIdx = siblings.indexOf(aId)
    const fIdx = siblings.indexOf(fId)
    if (aIdx < 0 || fIdx < 0) return

    const lo = Math.min(aIdx, fIdx)
    const hi = Math.max(aIdx, fIdx)
    const samePara = lo === hi
    const loOff = aIdx === lo ? anchorOffset : focusOffset
    const hiOff = aIdx === hi ? anchorOffset : focusOffset

    const nodes: SerializedPara[] = []
    const plainParts: string[] = []

    for (let pi = lo; pi <= hi; pi++) {
      const paraId = siblings[pi]
      if (!paraId) continue
      const para = pool.nodes.get(paraId) as unknown as Record<string, unknown> | undefined
      if (!para || para.type !== 'paragraph') continue

      let clipStart = 0
      let clipEnd = Infinity
      if (samePara) {
        clipStart = Math.min(anchorOffset, focusOffset)
        clipEnd = Math.max(anchorOffset, focusOffset)
      } else if (pi === lo) { clipStart = loOff }
      else if (pi === hi) { clipEnd = hiOff }

      const result = this.cloneParagraph(para, pool, clipStart, clipEnd)
      if (result) {
        nodes.push(result.serialized)
        plainParts.push(result.plainText)
      }
    }

    // 仅当有有效段落数据时才写入内存剪贴板
    const plainText = plainParts.join('\n')
    if (nodes.length > 0) {
      this.data = { nodes, plainText }
      console.debug(`[Clipboard] copy: ${nodes.length} paragraphs, plainText="${plainText.slice(0, 80)}"`)
    } else {
      console.debug('[Clipboard] copy: no nodes selected, memory clipboard NOT set')
    }

    // 系统剪贴板: 使用局部 plainText 而非 this.data.plainText, 防止 null 引用
    // (writeText 最佳努力, 永不 reject — 无剪贴板/非安全上下文静默降级)
    this.clipboard.writeText(plainText)
  }

  /**
   * 深度克隆单个段落, 按字符偏移裁剪文本/非文本节点
   *
   * clipStart/clipEnd 在函数入口立即标准化为 lo/hi,
   * 防御外部调用方 anchor/focus 颠倒传入
   */
  private cloneParagraph(
    para: Record<string, unknown>,
    pool: NodePool,
    clipStart: number,
    clipEnd: number,
  ): { serialized: SerializedPara; plainText: string } | null {
    // 防御标准化: lo <= hi 恒成立, 区间为 [lo, hi)
    const lo = Math.min(clipStart, clipEnd)
    const hi = Math.max(clipStart, clipEnd)
    console.debug(`[Clipboard] cloneParagraph: raw=(${clipStart},${clipEnd}) normalized=(${lo},${hi})`)

    const sp: SerializedPara = {
      type: 'paragraph',
      id: generateId(),
      style: {},
      children: [],
    }

    // 段落样式全量复制
    for (const k of ['alignment', 'indent', 'lineHeight', 'list', 'outlineLevel',
      'spaceBefore', 'spaceAfter']) {
      if (k in para) sp.style[k] = para[k]
    }

    let plainText = ''
    let charOffset = 0
    const children = (para as { children?: string[] }).children ?? []

    for (const childId of children) {
      const child = pool.nodes.get(childId) as unknown as Record<string, unknown> | undefined
      if (!child) continue

      const isText = child.type === 'text'

      // 计算该 child 的偏移区间 [itemStart, itemEnd):
      // 仅 text 按字符长度计, 其余 (含 smarttext/image/field) 占 1 偏移单位,
      // 与 resolveCharOffset / getParagraphLength 的权威语义保持一致。
      const itemStart = charOffset
      const itemEnd = itemStart + (isText ? ((child.text as string) || '').length : 1)

      // 交集判断: [itemStart, itemEnd) 与 [lo, hi) 无重叠 → 跳过
      if (itemEnd <= lo || itemStart >= hi) {
        console.debug(`[Clipboard] SKIP child type=${child.type} [${itemStart},${itemEnd}) vs [${lo},${hi})`)
        charOffset = itemEnd
        continue
      }
      console.debug(`[Clipboard] HIT  child type=${child.type} [${itemStart},${itemEnd}) vs [${lo},${hi})`)

      if (isText) {
        // 文本节点: 按偏移裁剪
        const fullText = (child.text as string) || ''
        const len = fullText.length
        const localS = Math.max(0, lo - itemStart)   // 截取起点 (相对)
        const localE = Math.min(len, hi - itemStart)  // 截取终点 (相对)
        const clippedText = fullText.slice(localS, localE)

        const cc: SerializedChild = { type: 'text', id: generateId(), text: clippedText }
        for (const k of ['font', 'size', 'bold', 'italic', 'underline', 'underlineStyle',
          'strikeout', 'color', 'highlight', 'superscript', 'subscript', 'letterSpacing']) {
          if (k in child) cc[k] = child[k]
        }
        if (child.element) cc.element = child.element
        sp.children.push(cc)
        plainText += clippedText
      } else if (child.type === 'smarttext') {
        // smarttext: 原子节点, 整体克隆 (不裁剪 text), 显示值计入 plainText
        const cc: SerializedChild = { type: 'smarttext', id: generateId() }
        for (const k of Object.keys(child)) {
          if (k !== 'id' && k !== 'metadata') cc[k] = child[k]
        }
        sp.children.push(cc)
        plainText += (child.text as string) || ''
      } else {
        // 其他非文本节点 (image/field/footnote_ref/...): 有交集 → 完整克隆
        const cc: SerializedChild = { type: child.type as string, id: generateId() }
        for (const k of Object.keys(child)) {
          if (k !== 'id' && k !== 'metadata') cc[k] = child[k]
        }
        sp.children.push(cc)
        console.debug(`[Clipboard] cloneParagraph: non-text type=${child.type} at [${itemStart},${itemEnd})`)
      }

      charOffset = itemEnd
    }

    console.debug(
      `[Clipboard] cloneParagraph: result children=${sp.children.length} plainText="${plainText.slice(0, 50)}"`
    )

    // 空段落返回含空 children 的序列化段落 (代表一个空行)
    // 不再返回 null, 避免选区中的空行被丢弃
    return { serialized: sp, plainText }
  }

  /** 粘贴: 返回结构化数据 (再次刷新 UUID 由 InsertNodesCommand 负责) */
  paste(): { nodes: SerializedPara[]; plainText: string } | null {
    if (!this.data) return null
    return { nodes: this.data.nodes, plainText: this.data.plainText }
  }

  /**
   * 选择性粘贴: 仅保留文本 (TASK-517)
   * 去除所有格式, 每个段落生成一个纯文本 TextNode
   */
  pasteAsPlainText(): { nodes: SerializedPara[]; plainText: string } | null {
    if (!this.data) return null

    const nodes: SerializedPara[] = this.data.nodes.map(para => ({
      type: 'paragraph',
      id: generateCommandId(),
      style: {},
      children: [{
        type: 'text',
        id: generateCommandId(),
        text: para.children
          .map(c => c.text || '')
          .join(''),
        font: 'SimSun',
        size: 16,
      }],
    }))

    return { nodes, plainText: this.data.plainText }
  }

  /**
   * 选择性粘贴: 匹配目标格式 (TASK-517)
   * 保留段落结构, 但移除源文本格式 (font/size/bold/italic/color)
   */
  pasteMatchingDestination(destinationStyle?: { font?: string; size?: number }): { nodes: SerializedPara[]; plainText: string } | null {
    if (!this.data) return null

    const defaultFont = destinationStyle?.font || 'SimSun'
    const defaultSize = destinationStyle?.size || 16

    const nodes: SerializedPara[] = this.data.nodes.map(para => ({
      type: 'paragraph',
      id: generateCommandId(),
      style: {},
      children: para.children.map(c => ({
        type: c.type || 'text',
        id: generateCommandId(),
        text: c.text || '',
        font: defaultFont,
        size: defaultSize,
      })),
    }))

    return { nodes, plainText: this.data.plainText }
  }

  /** 从纯文本构造剪贴板 (外部粘贴兜底) */
  setPlainText(text: string): void {
    if (!text) { this.data = null; return }
    const sp: SerializedPara = {
      type: 'paragraph', id: generateId(), style: {},
      children: [{ type: 'text', id: generateId(), text, font: 'SimSun', size: 16 }],
    }
    this.data = { nodes: [sp], plainText: text }
  }

  clear(): void { this.data = null }
}
