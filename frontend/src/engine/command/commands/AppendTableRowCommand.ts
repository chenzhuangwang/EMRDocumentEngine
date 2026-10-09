// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// AppendTableRowCommand — 可增长表追加一行 (契约 §12.9, PRD F8.2)
//
// 克隆**最后一行**的结构追加到表尾: 同一套字段, 再来一行实例
// (用药清单 / 检查结果 的填写语义)。
//
// 门控由命令层消费 (契约 §12.9): Table.dynamicRows !== true → 拒绝,
// 返回 null 不入 undo 栈。UI 藏不藏按钮是便利, 不是强制。
//
// 克隆规则 (§12.9):
//   - 每个源单元格 → 一个新单元格; colspan 保留 (网格对齐),
//     rowspan 归 1 (新末行不能向下跨行)。
//   - text / field 连同样式克隆。
//   - smarttext 控件 → **新节点** (同 ElementMeta + 同 TemplateDefinition),
//     但 value 不设 —— 新行按构造就是空的 (§12.6.1 undefined = 空态)。
//     复制源值等于静默复制临床数据。
//   - definition.single === true 的控件**不克隆** (§12.1 一文档至多一个)。
//
// UNDO 必须覆盖两层 (契约 §12.9): 本命令既写 node pool 又写
// TemplateDefinitionStore, 而后者在池外。快照式的 TableStructureCommand
// 只克隆表格子树, 用它会让还原后的节点集与 store 不一致、留下孤儿定义。
// 故本命令自带显式 forward/invert —— 与 InsertControlCommand (§12.4) 同形。
//
// 已知限制 (§12.9, 已记录不静默忽略): 单元格内的嵌套表格, 以及
// text/smarttext/field 之外的内联节点 (如 image), 暂不克隆。
// ================================================================

import type {
  BaseNode, FieldNode, Paragraph, ParagraphStyle, SmartTextNode, Table, TableCell, TableRow, TextNode,
} from '../../document/core/DocumentModel'
import { NodeType } from '../../document/core/DocumentModel'
import type { NodePool } from '../../document/core/NodePool'
import {
  createFieldNode, createParagraph, createSmartTextNode, createTableCell,
  createTableRow, createTextNode, extractStyle,
} from '../../document/factory/ElementFormatter'
import type { TemplateDefinitionStore, TemplateDefinition } from '../../template/TemplateDefinition'
import type { CommandContext, ICommand, SerializedCommand, StatePatch } from '../ICommand'
import { generateCommandId } from '../ICommand'
import { MintedOnce } from './MintedNodes'

/** 深拷贝纯数据 (与 MergeParagraphCommand / UpdateControlElementCommand 同法)。
 *  undefined 原样返回 —— JSON.parse(JSON.stringify(undefined)) 会抛。
 *  顺带丢掉值为 undefined 的键 (样式平铺在节点上, 大量字段为空)。 */
function deepClone<T>(value: T): T {
  if (value === undefined || value === null) return value
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 段落样式显式取字段 —— 节点把 ParagraphStyle 平铺在自己身上
 * (Paragraph extends BaseNode, ParagraphStyle), 不能整体展开 (会带上
 * id/type/children)。工厂侧也没有 extractParagraphStyle。
 */
const PARAGRAPH_STYLE_KEYS = [
  'alignment', 'indent', 'firstLineIndent', 'lineHeight',
  'spaceBefore', 'spaceAfter', 'list', 'outlineLevel',
] as const

function paragraphStyleOf(para: Paragraph): ParagraphStyle {
  const raw: Record<string, unknown> = {}
  for (const key of PARAGRAPH_STYLE_KEYS) {
    const v = (para as unknown as Record<string, unknown>)[key]
    if (v !== undefined) raw[key] = v
  }
  return deepClone(raw) as ParagraphStyle
}

export class AppendTableRowCommand implements ICommand {
  readonly type = 'append-table-row'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private tableId: string
  /** forward 产出, 供 invert 定位与回滚 (redo 时重置) */
  private createdRowId: string | null = null
  /** 本次克隆写进 store 的 nodeId, undo 时逐条删除, 避免孤儿定义 */
  private createdStoreIds: string[] = []
  /** 铸造一次台账 (契约 §8.3): 新行及其子树在 redo 时复用同一批 id */
  private mint = new MintedOnce()
  /** 首次铸造时写入 store 的定义 (nodeId → 定义), 重放时按同一批 id 重写 */
  private mintedDefs: Array<{ nodeId: string; def: TemplateDefinition }> = []

  constructor(id: string, timestamp: number, author: string, tableId: string) {
    this.id = id
    this.timestamp = timestamp
    this.author = author
    this.tableId = tableId
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, templateDefinitions } = ctx

    const table = pool.nodes.get(this.tableId) as Table | undefined
    if (!table || table.type !== NodeType.TABLE) return null
    // 门控由命令层消费 (契约 §12.9)
    if (table.dynamicRows !== true) return null

    const rowIds = table.children
    if (rowIds.length === 0) return null      // 无源行结构可克隆
    const sourceRow = pool.nodes.get(rowIds[rowIds.length - 1]) as TableRow | undefined
    if (!sourceRow || sourceRow.type !== NodeType.ROW) return null

    // 铸造一次 (契约 §8.3): 新行 + 克隆出的 cell/段落/内联节点在 redo 时复用
    // 同一批 id。cloneInline 内写 store 的定义另存在 mintedDefs, 供重放重写。
    const roots = this.mint.run(pool, () => {
      this.mintedDefs.length = 0
      const newCells = sourceRow.children
        .map((cellId) => this.cloneCell(cellId, pool, templateDefinitions))
        .filter((c): c is TableCell => c !== null)
      const newRow = createTableRow(newCells, sourceRow.height)
      pool.addNode(newRow)
      return [newRow.id]
    })
    const rowId = roots[0]
    this.createdRowId = rowId

    // 落位 —— 每次 forward 都做 (重放时新行只是被重新注册, 尚未在表里)
    pool.insertChild(this.tableId, rowId, rowIds.length)

    // store 在 undo 时被删空 (UndoAppendTableRowCommand) → 重放按同一批 id 重写,
    // 否则新行的控件丢掉设计期定义 (契约 §12.4 孤儿)。
    this.createdStoreIds = []
    for (const { nodeId, def } of this.mintedDefs) {
      templateDefinitions?.set(nodeId, deepClone(def))
      this.createdStoreIds.push(nodeId)
    }
    return { invalidation: 'table' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    if (!this.createdRowId) return null
    return new UndoAppendTableRowCommand(
      generateCommandId(), Date.now(), this.author,
      this.tableId, this.createdRowId, this.createdStoreIds,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'append-table-row', id: this.id, timestamp: this.timestamp,
      author: this.author, changes: { tableId: this.tableId },
    }
  }

  // ---- 克隆 ----

  private cloneCell(
    cellId: string, pool: NodePool, defs?: TemplateDefinitionStore,
  ): TableCell | null {
    const src = pool.nodes.get(cellId) as TableCell | undefined
    if (!src || src.type !== NodeType.CELL) return null

    const blockIds: string[] = []
    for (const blockId of src.children) {
      const cloned = this.cloneBlock(blockId, pool, defs)
      if (cloned) blockIds.push(cloned)
    }

    const cell = createTableCell(blockIds, {
      // colspan 保留 (网格对齐); rowspan 不设 —— 新末行不能向下跨行
      colspan: src.colspan,
      isHeader: src.isHeader,
      backgroundColor: src.backgroundColor,
      verticalAlign: src.verticalAlign,
    })
    pool.addNode(cell)
    return cell
  }

  /** 克隆单元格内的块 (段落)。嵌套表格等非段落块暂不克隆 (§12.9 限制)。 */
  private cloneBlock(
    blockId: string, pool: NodePool, defs?: TemplateDefinitionStore,
  ): string | null {
    const src = pool.nodes.get(blockId) as Paragraph | undefined
    if (!src || src.type !== NodeType.PARAGRAPH) return null

    const childIds: string[] = []
    for (const inlineId of src.children) {
      const cloned = this.cloneInline(inlineId, pool, defs)
      if (cloned) childIds.push(cloned)
    }

    const para = createParagraph(childIds, paragraphStyleOf(src))
    pool.addNode(para)
    return para.id
  }

  /**
   * 克隆单元格内的内联节点。返回 null 表示该节点**有意不克隆**
   * (single 唯一性控件, 或暂不支持的类型 §12.9)。
   */
  private cloneInline(
    inlineId: string, pool: NodePool, defs?: TemplateDefinitionStore,
  ): string | null {
    const src = pool.nodes.get(inlineId) as BaseNode | undefined
    if (!src) return null

    switch (src.type) {
      case NodeType.TEXT: {
        const t = src as TextNode
        const node = createTextNode(t.text, deepClone(extractStyle(t)))
        pool.addNode(node)
        return node.id
      }

      case NodeType.SMART_TEXT: {
        const st = src as SmartTextNode
        const def = defs?.get(st.id)
        // 唯一性控件不克隆 (契约 §12.1/§12.9): single 就是「一文档至多一个」
        if (def?.single === true) return null

        // value 不传 → undefined, 新行按构造为空 (§12.6.1)
        // extractStyle 的形参是 TextNode, 但三者都把 TextStyle 平铺在自身上,
        // 走同一个提取器以免样式字段两处维护。
        const node = createSmartTextNode(
          st.text, deepClone(st.element), deepClone(extractStyle(st as unknown as TextNode)),
        )
        pool.addNode(node)

        if (def && defs) {
          defs.set(node.id, deepClone(def))
          // 记下「nodeId → 定义」, 重放时按同一 id 重写 (契约 §8.3)
          this.mintedDefs.push({ nodeId: node.id, def: deepClone(def) })
        }
        return node.id
      }

      case NodeType.FIELD: {
        const f = src as FieldNode
        const node = createFieldNode(
          f.fieldType, f.format, deepClone(extractStyle(f as unknown as TextNode)),
        )
        pool.addNode(node)
        return node.id
      }

      default:
        return null   // image / separator / 其它内联类型暂不克隆 (§12.9 限制)
    }
  }
}

/**
 * UndoAppendTableRowCommand — AppendTableRowCommand 的逆操作 (契约 §12.9)。
 * 摘除整行子树 (pool.removeChild 递归清理后代) + 删除本次克隆写进 store 的
 * 定义条目。仅在 undo 时被临时 forward(), 不入栈, 故无需 invert。
 */
class UndoAppendTableRowCommand implements ICommand {
  readonly type = 'undo-append-table-row'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private tableId: string
  private rowId: string
  private storeIds: readonly string[]

  constructor(
    id: string, timestamp: number, author: string,
    tableId: string, rowId: string, storeIds: readonly string[],
  ) {
    this.id = id
    this.timestamp = timestamp
    this.author = author
    this.tableId = tableId
    this.rowId = rowId
    this.storeIds = storeIds
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    const table = pool.nodes.get(this.tableId) as { children?: readonly string[] } | undefined
    const idx = table?.children?.indexOf(this.rowId) ?? -1
    if (idx >= 0) pool.removeChild(this.tableId, idx)
    else pool.removeNode(this.rowId)

    // 清理克隆出的设计期定义, 避免孤儿 (§12.4 同旨)
    for (const nodeId of this.storeIds) ctx.templateDefinitions?.delete(nodeId)

    return { invalidation: 'table' }
  }

  serialize(): SerializedCommand {
    return {
      type: 'undo-append-table-row', id: this.id,
      timestamp: this.timestamp, author: this.author,
    }
  }
}
