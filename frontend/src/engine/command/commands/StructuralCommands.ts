// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// StructuralCommands — 结构性文档变更命令 (架构 §5/§8, v20.36)
//
// 将 Editor.ts 门面方法里直接改 doc/pool 的「插入/表格/批注/页面设置」等
// 操作收敛到 Command 系统, 满足 RULE 4 (所有变更经 Command) 与 RULE 5
// (受控变更点), 并补齐 undo/redo。
//
// 设计要点:
//   - RemoveNodesCommand 是「插入」类命令的通用逆操作原语: 按 (容器, 节点 id)
//     摘除节点并清理其子树, 可选恢复光标。
//   - 各插入命令 forward 时记录新建节点 id, invert 返回 RemoveNodesCommand。
//   - 表格结构操作 (merge/split/row/col) 用「表格子树快照」做 undo, 因为
//     colspan/rowspan 变更难以用增删节点逆推, 快照恢复最可靠。
//   - 序列化 (serialize) 对含闭包的命令仅保留元数据 (与 UndoPasteCommand 一致),
//     协作 (Phase 2) 的完整序列化待 collab 落地时补齐。
// ================================================================

import type {
  BaseNode, DocumentTree, Paragraph, PageSetup, CommentThread, FootnoteContent, TextNode,
} from '../../document/core/DocumentModel'
import { NodeType } from '../../document/core/DocumentModel'
import { createParagraph, createTextNode, createSection, extractStyle } from '../../document/factory/ElementFormatter'
import type { NodePool } from '../../document/core/NodePool'
import {
  ensureHfArray, hfArrayOf, trimHfArrayIfEmpty, type HeaderFooterVariant,
} from '../../document/core/HeaderFooterRegions'
import { normalizeParagraph } from './ParagraphUtils'
import { MintedOnce, captureMintedSubtree } from './MintedNodes'
import { resolveParagraphRegion, resolveBlockParent } from '../../state/CaretScope'
import type { CursorState } from '../../state/EditorRuntimeState'
import {
  ICommand, CommandContext, StatePatch, SerializedCommand, generateCommandId,
} from '../ICommand'

// ================================================================
// 共享辅助
// ================================================================

/** 删除 rootId 及其全部后代节点 (不依赖 NodePool.removeChild 的父子定位) */
export function removeSubtree(pool: NodePool, rootId: string): void {
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()!
    const node = pool.nodes.get(id)
    if (!node) continue
    const children = (node as unknown as { children?: readonly string[] }).children
    if (children) for (const c of children) stack.push(c)
    pool.removeNode(id)
  }
}

/** 深拷贝 rootId 子树 → { id → node } 快照 (供表格 undo 恢复) */
function cloneSubtree(pool: NodePool, rootId: string): Map<string, BaseNode> {
  // 单一实现: 与铸造侧台账共用 (契约 §8.3 / §11)
  return captureMintedSubtree(pool, [rootId])
}

/**
 * 造一个空白尾段落 (空 text + para), **不注册进池**。
 *
 * 「铸造一次、重放复用」的命令 (即 forward 会跑多次的) 一律用本函数 + MintedOnce:
 * 由 MintedOnce 负责把节点登记进池, 并在重放时按同一批 id 重新注册 (契约 §8.3)。
 */
function buildTrailingParagraph(): { text: TextNode; para: Paragraph } {
  const text = createTextNode('')
  const para = createParagraph([text.id])
  return { text, para }
}

// ================================================================
// RemoveNodesCommand — 通用逆操作原语
// ================================================================

type Container =
  | { kind: 'paragraph'; paraId: string }
  | { kind: 'cell'; cellId: string }
  | { kind: 'body' }
  | { kind: 'section'; sectionId: string }
  | { kind: 'header'; variant?: HeaderFooterVariant }
  | { kind: 'footer'; variant?: HeaderFooterVariant }
  | { kind: 'footnotes' }

interface NodeRemoval {
  container: Container
  nodeIds: string[]
}

/** 单个节点移除的恢复快照 (forward 时捕获, 供 invert 恢复) */
interface RemovalSnapshot {
  container: Container
  /** 移除时在父容器中的下标 (-1 表示非直接子节点, 仅 removeSubtree) */
  index: number
  rootId: string
  subtree: Map<string, BaseNode>
}

/** 只读空数组回退 (缺失容器 ≡ 空; 共享冻结实例, 防止误写) */
const NO_IDS: readonly string[] = Object.freeze([])

/** 只读解析 header/footer/footnotes 文档级数组 —— **不物化**缺失字段 */
function docArrayOfReadonly(doc: DocumentTree, container: Container): readonly string[] {
  switch (container.kind) {
    case 'header':
      return hfArrayOf(doc, 'header', container.variant ?? 'default')
    case 'footer':
      return hfArrayOf(doc, 'footer', container.variant ?? 'default')
    case 'footnotes':
      return doc.footnotes ?? NO_IDS
    case 'body': case 'paragraph': case 'cell': case 'section':
      throw new Error('pool-based container not handled here')
  }
}

/**
 * 受控**写**入口 —— 按需惰性创建文档级数组。
 *
 * 读路径一律走 `docArrayOfReadonly`。用写入口做只读查询会在文档里凭空造出
 * 它从未有过的键 (`firstPageHeader: []`), 而契约 §7.9 明说这些可选字段
 * 「缺失 ≡ 无内容, 不预创建、不补默认值」—— 键的存在性本身是被序列化出去的
 * 文档形状, 所以「查一下」不该改文档 (§6.2)。
 */
function docArrayOfWritable(doc: DocumentTree, container: Container): string[] {
  switch (container.kind) {
    case 'header':
      return ensureHfArray(doc, 'header', container.variant ?? 'default')
    case 'footer':
      return ensureHfArray(doc, 'footer', container.variant ?? 'default')
    case 'footnotes':
      if (!doc.footnotes) doc.footnotes = []
      return doc.footnotes
    case 'body': case 'paragraph': case 'cell': case 'section':
      throw new Error('pool-based container not handled here')
  }
}

/**
 * 移除后收尾: 可选文档级数组被删空 → 删回「缺失」态 (契约 §7.9 / §8.3)。
 *
 * 不这么做的话, 「插入脚注 → 撤销」会留下 `footnotes: []` —— 语义等价于缺失,
 * 但字节不等, 撤销就不是精确逆。default 页眉/页脚是预置的非可选字段, 留 `[]`。
 */
function trimDocArrayIfEmpty(doc: DocumentTree, container: Container): void {
  switch (container.kind) {
    case 'header':
      trimHfArrayIfEmpty(doc, 'header', container.variant ?? 'default')
      return
    case 'footer':
      trimHfArrayIfEmpty(doc, 'footer', container.variant ?? 'default')
      return
    case 'footnotes':
      if (doc.footnotes && doc.footnotes.length === 0) delete doc.footnotes
      return
    default:
      return
  }
}

/** 容器当前子节点数 (供恢复时下标夹取) */
function containerLengthOf(pool: NodePool, doc: DocumentTree, container: Container): number {
  switch (container.kind) {
    case 'paragraph': case 'cell': {
      const parentId = container.kind === 'paragraph' ? container.paraId : container.cellId
      return pool.getChildren(parentId).length
    }
    case 'section': return pool.getChildren(container.sectionId).length
    case 'body': return pool.getChildren(doc.id).length
    case 'header': return hfArrayOf(doc, 'header', container.variant ?? 'default').length
    case 'footer': return hfArrayOf(doc, 'footer', container.variant ?? 'default').length
    case 'footnotes': return doc.footnotes?.length ?? 0
  }
}

/** pool 内容器的父节点 id (body → 文档根; section/cell/paragraph → 自身 id) */
function poolParentIdOf(doc: DocumentTree, container: Container): string | null {
  switch (container.kind) {
    case 'body': return doc.id
    case 'section': return container.sectionId
    case 'cell': return container.cellId
    case 'paragraph': return container.paraId
    default: return null
  }
}

/** 容器内某节点的真实下标 (找不到返回 -1) */
function containerIndexOf(
  pool: NodePool, doc: DocumentTree, container: Container, nodeId: string,
): number {
  const poolParent = poolParentIdOf(doc, container)
  if (poolParent !== null) return pool.getChildren(poolParent).indexOf(nodeId)
  return docArrayOfReadonly(doc, container).indexOf(nodeId)
}

/**
 * 块级节点 (表格等) 的**真实**容器与下标 (契约 §31.6)。
 *
 * 委托 CaretScope.resolveBlockParent —— 不在此重复第二份"找父容器"的实现
 * (§11: 同一逻辑第二次出现即须抽取)。表格落在 Section 内时
 * `doc.body.children.indexOf` 返回 -1, 表格结构操作会静默拒绝。
 */
function findParentContainerOf(
  nodeId: string,
  doc: DocumentTree,
  pool: NodePool,
): { container: Container; index: number } | null {
  const parent = resolveBlockParent(nodeId, doc, pool)
  if (!parent) return null
  return parent.kind === 'section'
    ? { container: { kind: 'section', sectionId: parent.containerId }, index: parent.index }
    : { container: { kind: 'body' }, index: parent.index }
}

/** 将 rootId 插回容器指定下标 */
function insertIntoContainer(
  pool: NodePool, doc: DocumentTree, container: Container, index: number, rootId: string,
): void {
  const poolParent = poolParentIdOf(doc, container)
  if (poolParent !== null) {
    pool.insertChild(poolParent, rootId, index)
    return
  }
  docArrayOfWritable(doc, container).splice(index, 0, rootId)
}

/**
 * 按快照把表格子树**原地**恢复回其容器 (契约 §8.3 / §31.6)。
 *
 * 三个消费点共用同一实现 (§11): `RestoreTableCommand`(表格结构 undo)、
 * `TableStructureCommand`(redo 重放)、以及任何"表子树 after 快照"恢复。
 * 流程: 摘除当前 table 子树 → 按 id 重新注册快照节点 → 插回原下标。
 * 全程 id 不变, 这正是 §8.3 要求的「重放不换身份」。
 */
function restoreTableFromSnapshot(
  pool: NodePool, doc: DocumentTree, container: Container, index: number,
  tableId: string, snapshot: Map<string, BaseNode>,
): void {
  // 1. 摘除当前 table 子树 (真容器, 契约 §31.6)
  const cur = containerIndexOf(pool, doc, container, tableId)
  if (cur >= 0) {
    const poolParent = poolParentIdOf(doc, container)
    if (poolParent !== null) pool.detachChild(poolParent, cur)
    else docArrayOfWritable(doc, container).splice(cur, 1)
    removeSubtree(pool, tableId)
  }
  // 2. 重新注册快照节点 (id 保留)
  for (const [, node] of snapshot) pool.addNode(node)
  // 3. 回到原位置 (下标夹取到当前长度)
  const at = Math.min(index, containerLengthOf(pool, doc, container))
  insertIntoContainer(pool, doc, container, at, tableId)
}

export class RemoveNodesCommand implements ICommand {
  readonly type = 'remove-nodes'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private removals: NodeRemoval[]
  /** 需从 doc.comments 移除的 thread id (createComment undo) */
  private removeThreadIds: string[]
  private restoreCursor?: Partial<CursorState>
  /** forward 时捕获的子树快照, 供 invert 恢复 (deleteNode 直接入栈需可撤销) */
  private snapshots: RemovalSnapshot[] = []
  /**
   * body 被删空时补的那个空段落 id (仅 ensureBodyParagraph 开启时非空)。
   *
   * **为什么不用 MacroCommand{RemoveNodes, EnsureBodyParagraph}**: 那个组合在
   * undo 时不能精确还原 —— 逆序执行会先移除补的段落再插回被删块, 但
   * `EnsureBodyParagraphCommand` 恒插在下标 0, 而 `RestoreNodesCommand` 按**快照
   * 下标**插回, 于是原 `[section]` 会还原成 `[section, paragraph]`, 多出一个空段。
   * 补在**同一个命令内**并让 invert 先摘掉它, 才是精确的逆。
   * (这是 Editor 层"body 可编辑性"不变量的延续, 不是 Section 模型规则 ——
   *  模型层 `Section.children = []` 恒合法, 契约 §31.13。)
   */
  private createdParaId: string | null = null
  private ensureBodyParagraph: boolean
  /** 铸造一次台账 (契约 §8.3): redo 补的空段落必须复用同一 id */
  private mint = new MintedOnce()

  constructor(
    id: string, timestamp: number, author: string,
    removals: NodeRemoval[], removeThreadIds: string[] = [],
    restoreCursor?: Partial<CursorState>,
    opts: { ensureBodyParagraph?: boolean } = {},
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.removals = removals
    this.removeThreadIds = removeThreadIds
    this.restoreCursor = restoreCursor
    this.ensureBodyParagraph = opts.ensureBodyParagraph ?? false
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, doc } = ctx
    this.snapshots = []

    for (const { container, nodeIds } of this.removals) {
      for (const nodeId of nodeIds) {
        // 移除前捕获子树快照 (undo 恢复用)
        const subtree = cloneSubtree(pool, nodeId)

        // pool 内容器 (body / section / cell / paragraph): children 数组挂在池中
        // 节点上, 经 NodePool 受控 API (契约 §6.1 PROBLEM B choke point / §31.6)
        const poolParent = poolParentIdOf(doc, container)
        if (poolParent !== null) {
          const idx = pool.getChildren(poolParent).indexOf(nodeId)
          this.snapshots.push({ container, index: idx, rootId: nodeId, subtree })
          if (idx >= 0) { pool.detachChild(poolParent, idx); removeSubtree(pool, nodeId) }
          else removeSubtree(pool, nodeId)
          continue
        }

        // header/footer/footnotes 是文档级 string[] (非 children 数组), 直接 splice。
        // 先**只读**定位: 未命中就别碰写入口, 否则「删一个不存在的节点」会把
        // 可选数组凭空物化出来 (契约 §7.9 不预创建)。
        const idx = docArrayOfReadonly(doc, container).indexOf(nodeId)
        this.snapshots.push({ container, index: idx, rootId: nodeId, subtree })
        if (idx >= 0) {
          docArrayOfWritable(doc, container).splice(idx, 1)
          removeSubtree(pool, nodeId)
        } else {
          removeSubtree(pool, nodeId)
        }
      }
    }

    // 可选文档级数组被删空 → 删回「缺失」态, 使 undo 是精确逆 (契约 §7.9 / §8.3)
    for (const { container } of this.removals) trimDocArrayIfEmpty(doc, container)

    if (doc.comments && this.removeThreadIds.length > 0) {
      const ids = new Set(this.removeThreadIds)
      doc.comments = doc.comments.filter(t => !ids.has(t.id))
      // 删空 → 删键 (同 §7.9 可选数组的理由: 键的存在性是文档形状的一部分)
      if (doc.comments.length === 0) delete doc.comments
    }

    // body 被删空 → 补一个空段落, 保证编辑器仍有可落的 caret target。
    // 光标随之指向它; 没有可落点时 (restoreCursor undefined) 这是唯一有效的落点。
    let cursor = this.restoreCursor
    if (this.ensureBodyParagraph && pool.getChildren(doc.id).length === 0) {
      // 铸造一次 (契约 §8.3): invert 的 RestoreNodesCommand 按 createdParaId 摘除
      // 这个补段落; redo 时 id 漂移会让「精确逆」失效 (摘不掉的僵尸空段)。
      const [paraId] = this.mint.run(pool, () => {
        const para = createParagraph()
        pool.addNode(para)
        return [para.id]
      })
      pool.insertChild(doc.id, paraId, 0)
      this.createdParaId = paraId
      cursor = { paragraphPath: [doc.id, paraId], offset: 0, visible: true }
    }

    return { cursor, invalidation: 'flowbody' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    if (this.snapshots.length === 0) return null
    return new RestoreNodesCommand(
      generateCommandId(), Date.now(), this.author, this.snapshots,
      // 先摘掉补的空段落, 再按快照还原 —— 否则 undo 会多留一个段落
      this.createdParaId,
    )
  }

  serialize(): SerializedCommand {
    return { type: 'remove-nodes', id: this.id, timestamp: this.timestamp, author: this.author }
  }
}

/**
 * RestoreNodesCommand — RemoveNodesCommand 的逆操作。
 * 仅在 undo 时被临时 forward(), 不入栈, 故无需 invert。
 */
class RestoreNodesCommand implements ICommand {
  readonly type = 'restore-nodes'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private snapshots: RemovalSnapshot[]
  /** forward 时补出来的空段落 —— 必须先摘掉它, 才能精确还原被删前的 body */
  private createdParaId: string | null

  constructor(
    id: string, timestamp: number, author: string, snapshots: RemovalSnapshot[],
    createdParaId: string | null = null,
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.snapshots = snapshots
    this.createdParaId = createdParaId
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, doc } = ctx

    // 0. 摘掉 forward 补的空段落 (它不在任何快照里, 留着就不是精确逆)
    if (this.createdParaId) {
      const idx = pool.getChildren(doc.id).indexOf(this.createdParaId)
      if (idx >= 0) { pool.detachChild(doc.id, idx); removeSubtree(pool, this.createdParaId) }
    }

    // 逆序恢复 (后删先插), 使同容器多节点按原顺序还原
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      const { container, index, rootId, subtree } = this.snapshots[i]
      // 1. 重新注册子树节点 (root + 后代, cloneSubtree 已深拷贝)
      for (const [, node] of subtree) pool.addNode(node)
      // 2. 插回原位置 (下标夹取到当前长度, 越界 append)
      const len = containerLengthOf(pool, doc, container)
      const idx = Math.max(0, Math.min(index, len))
      insertIntoContainer(pool, doc, container, idx, rootId)
    }
    return { invalidation: 'flowbody' }
  }

  serialize(): SerializedCommand {
    return { type: 'restore-nodes', id: this.id, timestamp: this.timestamp, author: this.author }
  }
}

// ================================================================
// InsertInlineNodeCommand — 光标处插入单个内联节点
//   (field / smarttext / bookmark / cross_reference / comment_marker)
// ================================================================

export class InsertInlineNodeCommand implements ICommand {
  readonly type = 'insert-inline-node'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private path: string[]
  private offset: number
  private makeNode: () => BaseNode
  private insertedNodeId: string | null = null
  /** 铸造一次台账 (契约 §8.3) */
  private mint = new MintedOnce()

  constructor(
    id: string, timestamp: number, author: string,
    path: string[], offset: number, makeNode: () => BaseNode,
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.path = path; this.offset = offset; this.makeNode = makeNode
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    const paraId = this.path[this.path.length - 1]
    const para = pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
    if (!para?.children) return null

    // 字符偏移 → (textNodeId, localOffset)。localOffset 必须被使用: 只按
    // textNodeId 插入会把内联节点永远丢到该文本节点**末尾**, 光标落在长文本
    // 中间时"插入不到光标位置" (与 InsertTextCommand 同语义: 文本中间需拆分)。
    //
    // 落点解析每次 forward 都做 (undo 已还原段落, 结果与首次一致); 铸造只在
    // 首次做 (契约 §8.3)。
    const resolved = pool.resolveCharOffset(paraId, this.offset)
    const target = resolved ? pool.nodes.get(resolved.textNodeId) : undefined
    const targetIdx = resolved ? para.children.indexOf(resolved.textNodeId) : -1
    const textTarget = resolved && targetIdx >= 0 && target &&
      (target as unknown as { type?: string }).type === 'text'
      ? (target as unknown as TextNode)
      : undefined

    // 光标在文本中间 → 需要拆成左右两半, 内联节点落于其间
    // (与 InsertControlCommand 控件落位同语义)
    const localOffset = resolved ? resolved.localOffset : 0
    const splitsMiddle = !!textTarget && localOffset > 0 && localOffset < textTarget.text.length

    // 铸造一次 (契约 §8.3): 内联节点 (以及文本中间分支拆出的后半段) 在 redo 时
    // 必须复用同一批 id。
    const roots = this.mint.run(pool, () => {
      const n = this.makeNode()
      pool.addNode(n)
      const ids = [n.id]
      if (splitsMiddle && textTarget) {
        const afterNode = createTextNode(textTarget.text.slice(localOffset), extractStyle(textTarget))
        pool.addNode(afterNode)
        ids.push(afterNode.id)
      }
      return ids
    })
    const nodeId = roots[0]
    const afterNodeId: string | undefined = roots.length > 1 ? roots[1] : undefined
    this.insertedNodeId = nodeId

    // 落位 —— 每次 forward 都做
    if (textTarget && splitsMiddle && afterNodeId) {
      pool.updateNode(textTarget.id, { text: textTarget.text.slice(0, localOffset) } as Partial<TextNode>)
      pool.insertChildren(paraId, [nodeId, afterNodeId], targetIdx + 1)
    } else if (textTarget) {
      // 起始处 → 之前; 末尾 → 之后
      pool.insertChild(paraId, nodeId, targetIdx + (localOffset <= 0 ? 0 : 1))
    } else if (resolved && targetIdx >= 0) {
      // 目标是内联非文本节点 (控件/图片/域): localOffset 0=前, 1=后
      pool.insertChild(paraId, nodeId, targetIdx + (resolved.localOffset >= 1 ? 1 : 0))
    } else {
      // 空段落 / 越界 / 悬空引用 → 追加到末尾
      pool.insertChild(paraId, nodeId, para.children.length)
    }
    normalizeParagraph(para as unknown as Paragraph, pool)
    // 光标移到内联节点「之后」(内联节点 = 1 原子字符, 与 InsertControlCommand 同
    // 语义): 插入后继续打字应落在节点之后, 否则新字符会插到刚插入的域/图片之前。
    return {
      cursor: { paragraphPath: this.path, offset: this.offset + 1, visible: true },
      invalidation: 'paragraph',
    }
  }

  invert(_ctx: CommandContext): ICommand | null {
    if (!this.insertedNodeId) return null
    return new RemoveNodesCommand(
      generateCommandId(), Date.now(), this.author,
      [{ container: { kind: 'paragraph', paraId: this.path[this.path.length - 1] }, nodeIds: [this.insertedNodeId] }],
      [], { paragraphPath: this.path, offset: this.offset, visible: true },
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'insert-inline-node', id: this.id, timestamp: this.timestamp,
      author: this.author, path: this.path, offset: this.offset,
    }
  }
}

// ================================================================
// InsertBlockCommand — 光标段落后插入块级节点 (separator / section_break / table)
// ================================================================

export class InsertBlockCommand implements ICommand {
  readonly type = 'insert-block'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private path: string[]
  /** 创建并注册 block 子树到 pool, 返回顶级 block 节点 */
  private makeBlock: (pool: NodePool) => BaseNode
  private withTrailingParagraph: boolean
  private moveCursorToTrailing: boolean
  private insertedRootIds: string[] = []
  /** forward 时解析出的真实容器 (invert 必须按同一容器恢复, 契约 §31.6) */
  private insertContainer: Container = { kind: 'body' }
  /** 铸造一次台账 (契约 §8.3): 块与尾段落重放时复用同一批 id */
  private mint = new MintedOnce()

  constructor(
    id: string, timestamp: number, author: string,
    path: string[],
    makeBlock: (pool: NodePool) => BaseNode,
    opts: { withTrailingParagraph?: boolean; moveCursorToTrailing?: boolean } = {},
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.path = path; this.makeBlock = makeBlock
    this.withTrailingParagraph = opts.withTrailingParagraph ?? true
    this.moveCursorToTrailing = opts.moveCursorToTrailing ?? false
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, doc } = ctx
    const paraId = this.path[this.path.length - 1]

    // 用 R2 定位段落的**真实**容器与下标 (契约 §31.8): 旧实现硬要求
    // `doc.body.children.indexOf(paraId) >= 0`, 段落一旦落在 Section 内就
    // 返回 null —— 节内插入表格/分隔线/分节符静默失败。
    //
    // 仅支持 pool 内容器 body / section。cell / header / footer 维持既有语义
    // (表格 cell 只放段落, 不承载块级插入; 页眉页脚同理) —— 这是**有意的**拒绝,
    // 不是遍历不到; 不在此扩权, 以免把块级结构写进不该有的容器。
    //
    // 注意: 定位在**每次** forward 都做 (重放时锚点段落已由 undo 还原, 位置可能
    // 与首次相同但必须重算)。铸造只在首次做 (契约 §8.3)。
    const region = resolveParagraphRegion(paraId, doc, pool)
    if (!region || (region.type !== 'body' && region.type !== 'section')) return null
    const container: Container = region.type === 'section'
      ? { kind: 'section', sectionId: region.containerId }
      : { kind: 'body' }
    this.insertContainer = container
    const idx = region.index

    // 铸造一次: 块 (makeBlock 回调) + 尾段落。both 都只在**首次** forward 执行,
    // 之后按快照重新注册 —— 否则 redo 铸出的新 id 会让后续命令 (锚定在新建块/
    // 尾段落上的那些) 构造时捕获的引用悬空, 链无声断掉 (契约 §8.3)。
    const roots = this.mint.run(pool, () => {
      const block = this.makeBlock(pool)
      const ids = [block.id]
      if (this.withTrailingParagraph) {
        const { text, para } = buildTrailingParagraph()
        pool.addNode(text)
        pool.addNode(para)
        ids.push(para.id)
      }
      return ids
    })
    const blockId = roots[0]
    const trailId: string | undefined = roots.length > 1 ? roots[1] : undefined
    this.insertedRootIds = trailId ? [blockId, trailId] : [blockId]

    // 放回容器 —— 每次 forward 都做 (重放时节点只是被重新注册, 还不在容器里)
    insertIntoContainer(pool, doc, container, idx + 1, blockId)

    let cursor: Partial<CursorState> | undefined
    if (trailId) {
      const afterBlock = containerLengthOf(pool, doc, container) === 0
        ? 0
        : containerIndexOf(pool, doc, container, blockId) + 1
      insertIntoContainer(pool, doc, container, afterBlock, trailId)
      if (this.moveCursorToTrailing) {
        cursor = { paragraphPath: [doc.id, trailId], offset: 0, visible: true }
      }
    }

    return { cursor, invalidation: 'flowbody' }
  }
  invert(_ctx: CommandContext): ICommand | null {
    return new RemoveNodesCommand(
      generateCommandId(), Date.now(), this.author,
      [{ container: this.insertContainer, nodeIds: this.insertedRootIds }],
      [], { paragraphPath: this.path, offset: 0, visible: true },
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'insert-block', id: this.id, timestamp: this.timestamp,
      author: this.author, path: this.path,
    }
  }
}

// ================================================================
// InsertFootnoteCommand — 插入脚注 (正文引用 + 脚注内容)
// ================================================================

export class InsertFootnoteCommand implements ICommand {
  readonly type = 'insert-footnote'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private path: string[]
  private offset: number
  private makeRef: (fnContentId: string) => BaseNode
  private makeContent: (pool: NodePool) => FootnoteContent
  private insertedContentId: string | null = null
  private insertedRefId: string | null = null
  /** 铸造一次台账 (契约 §8.3): 脚注内容 + 引用在 redo 时复用同一批 id */
  private mint = new MintedOnce()

  constructor(
    id: string, timestamp: number, author: string,
    path: string[], offset: number,
    makeContent: (pool: NodePool) => FootnoteContent,
    makeRef: (fnContentId: string) => BaseNode,
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.path = path; this.offset = offset
    this.makeContent = makeContent
    this.makeRef = makeRef
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, doc } = ctx
    const paraId = this.path[this.path.length - 1]
    const para = pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
    if (!para?.children) return null

    // 铸造一次 (契约 §8.3): 脚注内容 (含内部空段落) 与引用在 redo 时必须复用
    // 同一批 id —— 后续命令可能以引用 id 为目标 ("光标落到脚注后继续打字")。
    const roots = this.mint.run(pool, () => {
      const fnContent = this.makeContent(pool)   // 内部注册 content + 段落 + 文本
      const fnRef = this.makeRef(fnContent.id)
      pool.addNode(fnRef)
      fnContent.refId = fnRef.id
      return [fnContent.id, fnRef.id]
    })
    const contentId = roots[0]
    const refId = roots[1]
    this.insertedContentId = contentId
    this.insertedRefId = refId

    // 落位 —— 每次 forward 都做。footnotes 是 doc 级 string[] (非池 children),
    // undo 时已被 RemoveNodesCommand 摘掉, 故不能放进 once 区, 否则重放后内容丢失。
    if (!doc.footnotes) doc.footnotes = []
    if (!doc.footnotes.includes(contentId)) doc.footnotes.push(contentId)

    const resolved = pool.resolveCharOffset(paraId, this.offset)
    if (resolved) {
      const idx = para.children.indexOf(resolved.textNodeId)
      if (idx >= 0) pool.insertChild(paraId, refId, idx + 1)
      else pool.insertChild(paraId, refId, para.children.length)
    } else {
      pool.insertChild(paraId, refId, para.children.length)
    }

    return { invalidation: 'paragraph' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    const removals: NodeRemoval[] = []
    if (this.insertedRefId) {
      removals.push({ container: { kind: 'paragraph', paraId: this.path[this.path.length - 1] }, nodeIds: [this.insertedRefId] })
    }
    if (this.insertedContentId) {
      removals.push({ container: { kind: 'footnotes' }, nodeIds: [this.insertedContentId] })
    }
    return new RemoveNodesCommand(
      generateCommandId(), Date.now(), this.author,
      removals, [], { paragraphPath: this.path, offset: this.offset, visible: true },
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'insert-footnote', id: this.id, timestamp: this.timestamp,
      author: this.author, path: this.path, offset: this.offset,
    }
  }
}

// ================================================================
// CreateCommentCommand — 创建批注 (CommentMarker + CommentThread)
// ================================================================

export class CreateCommentCommand implements ICommand {
  readonly type = 'create-comment'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private path: string[]
  private offset: number
  private makeMarker: () => BaseNode
  private makeThread: () => CommentThread
  private insertedMarkerId: string | null = null
  private insertedThreadId: string | null = null

  constructor(
    id: string, timestamp: number, author: string,
    path: string[], offset: number,
    makeMarker: () => BaseNode, makeThread: () => CommentThread,
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.path = path; this.offset = offset
    this.makeMarker = makeMarker
    this.makeThread = makeThread
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, doc } = ctx
    const paraId = this.path[this.path.length - 1]
    const para = pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
    if (!para?.children) return null

    const marker = this.makeMarker()
    pool.addNode(marker)
    this.insertedMarkerId = marker.id

    const resolved = pool.resolveCharOffset(paraId, this.offset)
    if (resolved) {
      const idx = para.children.indexOf(resolved.textNodeId)
      if (idx >= 0) pool.insertChild(paraId, marker.id, idx + 1)
      else pool.insertChild(paraId, marker.id, para.children.length)
    } else {
      pool.insertChild(paraId, marker.id, para.children.length)
    }

    const thread = this.makeThread()
    this.insertedThreadId = thread.id
    if (!doc.comments) doc.comments = []
    doc.comments.push(thread)

    return { invalidation: 'paragraph' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    const removals: NodeRemoval[] = []
    if (this.insertedMarkerId) {
      removals.push({ container: { kind: 'paragraph', paraId: this.path[this.path.length - 1] }, nodeIds: [this.insertedMarkerId] })
    }
    return new RemoveNodesCommand(
      generateCommandId(), Date.now(), this.author,
      removals, this.insertedThreadId ? [this.insertedThreadId] : [],
      { paragraphPath: this.path, offset: this.offset, visible: true },
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'create-comment', id: this.id, timestamp: this.timestamp,
      author: this.author, path: this.path, offset: this.offset,
    }
  }
}

// ================================================================
// AddCommentReplyCommand / ResolveCommentCommand — 批注回复与状态
// ================================================================

export class AddCommentReplyCommand implements ICommand {
  readonly type = 'add-comment-reply'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private threadId: string
  private replyId: string
  private content: string

  constructor(id: string, timestamp: number, author: string, threadId: string, replyId: string, content: string) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.threadId = threadId; this.replyId = replyId; this.content = content
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { doc } = ctx
    const thread = doc.comments?.find(t => t.id === this.threadId)
    if (!thread) return null
    thread.comments.push({ id: this.replyId, author: this.author, createdAt: this.timestamp, content: this.content })
    return { invalidation: 'none' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    return new RemoveCommentReplyCommand(generateCommandId(), Date.now(), this.author, this.threadId, this.replyId)
  }

  serialize(): SerializedCommand {
    return {
      type: 'add-comment-reply', id: this.id, timestamp: this.timestamp,
      author: this.author, changes: { threadId: this.threadId, replyId: this.replyId, content: this.content },
    }
  }
}

class RemoveCommentReplyCommand implements ICommand {
  readonly type = 'remove-comment-reply'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private threadId: string
  private replyId: string

  constructor(id: string, timestamp: number, author: string, threadId: string, replyId: string) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.threadId = threadId; this.replyId = replyId
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { doc } = ctx
    const thread = doc.comments?.find(t => t.id === this.threadId)
    if (!thread) return null
    thread.comments = thread.comments.filter(c => c.id !== this.replyId)
    return { invalidation: 'none' }
  }

  serialize(): SerializedCommand {
    return { type: 'remove-comment-reply', id: this.id, timestamp: this.timestamp, author: this.author }
  }
}

export class ResolveCommentCommand implements ICommand {
  readonly type = 'resolve-comment'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private threadId: string
  private resolved: boolean
  private oldStatus: CommentThread['status'] | null = null

  constructor(id: string, timestamp: number, author: string, threadId: string, resolved: boolean) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.threadId = threadId; this.resolved = resolved
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { doc } = ctx
    const thread = doc.comments?.find(t => t.id === this.threadId)
    if (!thread) return null
    this.oldStatus = thread.status
    thread.status = this.resolved ? 'resolved' : 'reopened'
    return { invalidation: 'none' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    if (this.oldStatus === null) return null
    // 精确恢复原状态 (open/reopened/resolved), 避免 open→reopened 的语义漂移
    return new RestoreCommentStatusCommand(generateCommandId(), Date.now(), this.author, this.threadId, this.oldStatus)
  }

  serialize(): SerializedCommand {
    return {
      type: 'resolve-comment', id: this.id, timestamp: this.timestamp,
      author: this.author, changes: { threadId: this.threadId, resolved: this.resolved },
    }
  }
}

class RestoreCommentStatusCommand implements ICommand {
  readonly type = 'restore-comment-status'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private threadId: string
  private status: CommentThread['status']

  constructor(id: string, timestamp: number, author: string, threadId: string, status: CommentThread['status']) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.threadId = threadId; this.status = status
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const thread = ctx.doc.comments?.find(t => t.id === this.threadId)
    if (!thread) return null
    thread.status = this.status
    return { invalidation: 'none' }
  }

  serialize(): SerializedCommand {
    return { type: 'restore-comment-status', id: this.id, timestamp: this.timestamp, author: this.author }
  }
}

// ================================================================
// SetPageSetupCommand — 页面设置变更 (canonical = DocumentTree.pageSetup)
// ================================================================

export class SetPageSetupCommand implements ICommand {
  readonly type = 'set-page-setup'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private patch: Partial<PageSetup>
  private old: Partial<PageSetup> | null = null

  constructor(id: string, timestamp: number, author: string, patch: Partial<PageSetup>) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.patch = patch
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { doc } = ctx
    const ps = doc.pageSetup
    const keys = Object.keys(this.patch) as (keyof PageSetup)[]
    this.old = {}
    for (const k of keys) this.old[k] = ps[k] as never
    Object.assign(ps, this.patch)
    return { invalidation: 'page_setup' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    if (!this.old) return null
    return new SetPageSetupCommand(generateCommandId(), Date.now(), this.author, this.old)
  }

  serialize(): SerializedCommand {
    return {
      type: 'set-page-setup', id: this.id, timestamp: this.timestamp,
      author: this.author, changes: this.patch as Record<string, unknown>,
    }
  }
}

// ================================================================
// EnsureHeaderFooterParagraphCommand — 进入页眉/页脚编辑时确保有段落
// ================================================================

export class EnsureHeaderFooterParagraphCommand implements ICommand {
  readonly type = 'ensure-header-footer-paragraph'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private section: 'header' | 'footer'
  /** 变体 (契约 §7.9) — 决定写入哪一个数组 (header / firstPageHeader / evenPageHeader …) */
  private variant: HeaderFooterVariant
  private createdParaId: string | null = null
  /** 铸造一次台账 (契约 §8.3) */
  private mint = new MintedOnce()

  constructor(
    id: string, timestamp: number, author: string,
    section: 'header' | 'footer', variant: HeaderFooterVariant = 'default',
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.section = section
    this.variant = variant
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, doc } = ctx
    const arr = ensureHfArray(doc, this.section, this.variant)
    // 守卫只在**首次** forward 生效: 重放时该数组非空正是本命令自己的产物,
    // 若仍按"已有内容就 no-op"提前返回, redo 会被静默丢弃、历史被无声缩短
    // (栈把命令从 redoStack 弹出后不再放回 undoStack)。
    if (arr.length > 0 && !this.mint.replaying) return null

    const [paraId] = this.mint.run(pool, () => {
      const { text, para } = buildTrailingParagraph()
      pool.addNode(text)
      pool.addNode(para)
      return [para.id]
    })
    arr.push(paraId)
    this.createdParaId = paraId
    return { invalidation: 'full' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    if (!this.createdParaId) return null
    return new RemoveNodesCommand(
      generateCommandId(), Date.now(), this.author,
      // 必须带同一 variant: 否则 undo 会去默认数组删, 而段落创建在变体数组里
      [{ container: { kind: this.section, variant: this.variant }, nodeIds: [this.createdParaId] }],
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'ensure-header-footer-paragraph', id: this.id, timestamp: this.timestamp,
      author: this.author, changes: { section: this.section, variant: this.variant },
    }
  }
}

// ================================================================
// EnsureBodyParagraphCommand — 空文档首次输入时确保 body 有段落
// ================================================================

export class EnsureBodyParagraphCommand implements ICommand {
  readonly type = 'ensure-body-paragraph'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private createdParaId: string | null = null
  /** 铸造一次台账 (契约 §8.3) */
  private mint = new MintedOnce()

  constructor(id: string, timestamp: number, author: string) {
    this.id = id; this.timestamp = timestamp; this.author = author
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, doc } = ctx
    // 已有内容则视为无操作 (body 非空即无需补段落)。
    // 口径经 NodePool: body.children 是 children 数组 (契约 §6.1 PROBLEM B
    // choke point), 读写都必须走受控 API, 不直接触碰数组。
    //
    // 守卫只在**首次** forward 生效: 重放时 body 里那个段落正是本命令自己的
    // 产物, 若仍按"非空就 no-op"提前返回, redo 会被静默丢弃 (契约 §8.3)。
    if (pool.getChildren(doc.id).length > 0 && !this.mint.replaying) return null

    const [paraId] = this.mint.run(pool, () => {
      const para = createParagraph()
      pool.addNode(para)
      return [para.id]
    })
    this.createdParaId = paraId
    // 放回容器 —— 每次 forward 都做 (重放时节点只是被重新注册, 还不在 body 里)
    pool.insertChild(doc.id, paraId, 0)
    return {
      cursor: { paragraphPath: [doc.id, paraId], offset: 0, visible: true },
      invalidation: 'flowbody',
    }
  }

  invert(_ctx: CommandContext): ICommand | null {
    if (!this.createdParaId) return null
    return new RemoveNodesCommand(
      generateCommandId(), Date.now(), this.author,
      [{ container: { kind: 'body' }, nodeIds: [this.createdParaId] }],
      [], { paragraphPath: [], offset: 0, visible: true },
    )
  }

  serialize(): SerializedCommand {
    return { type: 'ensure-body-paragraph', id: this.id, timestamp: this.timestamp, author: this.author }
  }
}

// ================================================================
// EnsureCellParagraphCommand — 导航进入空单元格时确保 cell 有段落
// ================================================================

export class EnsureCellParagraphCommand implements ICommand {
  readonly type = 'ensure-cell-paragraph'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private cellId: string
  /** undo 时恢复的光标 (通常为导航前的源段落) */
  private restoreCursor?: Partial<CursorState>
  private createdParaId: string | null = null
  /** 铸造一次台账 (契约 §8.3) */
  private mint = new MintedOnce()

  constructor(
    id: string, timestamp: number, author: string, cellId: string,
    restoreCursor?: Partial<CursorState>,
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.cellId = cellId
    this.restoreCursor = restoreCursor
  }

  /** 供调用方 (导航) 读取新建段落 ID, 用于定位光标 */
  get paragraphId(): string | null { return this.createdParaId }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    const cell = pool.nodes.get(this.cellId) as { children?: readonly string[] } | undefined
    if (!cell) return null
    // 守卫只在**首次** forward 生效 (契约 §8.3): 重放时那个段落正是本命令的产物
    if (!this.mint.replaying) {
      const children = cell.children ?? []
      for (const id of children) {
        if (pool.nodes.get(id)?.type === 'paragraph') return null  // 已有段落
      }
    }
    const [paraId] = this.mint.run(pool, () => {
      const para = createParagraph()
      pool.addNode(para)
      return [para.id]
    })
    this.createdParaId = paraId
    cell.children = [...(cell.children ?? []), paraId]
    return { invalidation: 'table' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    if (!this.createdParaId) return null
    return new RemoveNodesCommand(
      generateCommandId(), Date.now(), this.author,
      [{ container: { kind: 'cell', cellId: this.cellId }, nodeIds: [this.createdParaId] }],
      [], this.restoreCursor,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'ensure-cell-paragraph', id: this.id, timestamp: this.timestamp,
      author: this.author, changes: { cellId: this.cellId },
    }
  }
}

// ================================================================
// TableStructureCommand — 表格结构操作 (快照式 undo)
// ================================================================

export class TableStructureCommand implements ICommand {
  readonly type = 'table-structure'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private tableId: string
  /** 返回 true 表示实际变更; false 表示无操作 (不入 undo 栈) */
  private mutate: (pool: NodePool) => boolean
  private snapshot: Map<string, BaseNode> | null = null
  /**
   * 首次 forward 后的「表子树」快照 (契约 §8.3)。
   *
   * `mutate` 是黑盒回调 (经 TableOps), 会铸造新行/格并就地改写 span —— 重放时
   * **重跑它**既换 id 又叠加第二次变更。故首跑后抓一份 after 快照, 重放直接按它
   * 原地恢复, 与 `RestoreTableCommand` 同款机制 (共用 `restoreTableFromSnapshot`)。
   */
  private afterSnapshot: Map<string, BaseNode> | null = null
  private parentIndex = -1
  /** forward 时解析出的真实容器 (invert 必须按同一容器恢复, 契约 §31.6) */
  private parentContainer: Container = { kind: 'body' }

  constructor(
    id: string, timestamp: number, author: string,
    tableId: string, mutate: (pool: NodePool) => boolean,
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.tableId = tableId; this.mutate = mutate
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, doc } = ctx
    // 表格的真实容器与下标 (契约 §31.6): 表格可以落在 Section 内, 用
    // `doc.body.children.indexOf` 会返回 -1 → 表格结构操作静默拒绝。
    const parent = findParentContainerOf(this.tableId, doc, pool)
    if (!parent) return null
    this.parentContainer = parent.container
    this.parentIndex = parent.index

    // 重放 (契约 §8.3): 不重跑 mutate, 按首跑的 after 快照原地恢复 → id 全程不变。
    if (this.afterSnapshot) {
      restoreTableFromSnapshot(
        pool, doc, this.parentContainer, this.parentIndex, this.tableId, this.afterSnapshot,
      )
      return { invalidation: 'table' }
    }

    this.snapshot = cloneSubtree(pool, this.tableId)
    const changed = this.mutate(pool)
    if (!changed) {
      this.snapshot = null
      return null
    }
    this.afterSnapshot = cloneSubtree(pool, this.tableId)
    return { invalidation: 'table' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    if (!this.snapshot || this.parentIndex < 0) return null
    return new RestoreTableCommand(
      generateCommandId(), Date.now(), this.author,
      this.tableId, this.snapshot, this.parentIndex, this.parentContainer,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'table-structure', id: this.id, timestamp: this.timestamp,
      author: this.author, changes: { tableId: this.tableId },
    }
  }
}

class RestoreTableCommand implements ICommand {
  readonly type = 'restore-table'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private tableId: string
  private snapshot: Map<string, BaseNode>
  private parentIndex: number
  private parentContainer: Container

  constructor(
    id: string, timestamp: number, author: string,
    tableId: string, snapshot: Map<string, BaseNode>, parentIndex: number,
    parentContainer: Container = { kind: 'body' },
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.tableId = tableId; this.snapshot = snapshot; this.parentIndex = parentIndex
    this.parentContainer = parentContainer
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, doc } = ctx
    restoreTableFromSnapshot(
      pool, doc, this.parentContainer, this.parentIndex, this.tableId, this.snapshot,
    )
    return { invalidation: 'table' }
  }

  serialize(): SerializedCommand {
    return { type: 'restore-table', id: this.id, timestamp: this.timestamp, author: this.author }
  }
}

// ================================================================
// MoveBlockCommand — 把块级节点 (含整个 Section) 移到另一个容器/位置
//
// 契约 §31: 跨父移动此前**根本不存在** —— NodePool.moveChild 只在单个父内
// 重排且零调用者, 仓库里没有任何 MoveXxxCommand。"移动整章"因此需要新能力,
// 不是既有命令的扩展 (P3 冻结方案把它列为新命令是正确的)。
//
// 单命令完成跨父移动: forward 记录来源容器/下标, invert 原路移回。
// 子树节点身份不变 (它们仍在池中, 只换了父) —— 无需快照整棵子树。
// ================================================================

export class MoveBlockCommand implements ICommand {
  readonly type = 'move-block'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private nodeId: string
  private toParentId: string
  private toIndex: number
  /** forward 时解析出的来源容器/下标 (invert 原路移回) */
  private fromParentId: string | null = null
  private fromIndex = -1
  constructor(
    id: string, timestamp: number, author: string,
    nodeId: string, toParentId: string, toIndex: number,
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.nodeId = nodeId; this.toParentId = toParentId; this.toIndex = toIndex
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    // 来源容器: 用结构侧解析 (真容器真下标, 契约 §31.6) —— 不假设是 body
    const fromParent = findParentIdOf(pool, this.nodeId)
    if (!fromParent) return null
    const fromIndex = pool.getChildren(fromParent).indexOf(this.nodeId)
    if (fromIndex < 0) return null

    try {
      pool.moveChildTo(this.nodeId, fromParent, this.toParentId, this.toIndex)
    } catch {
      return null // 非法移动 (自环 / 目标已含该节点) → 显式拒绝, 不静默半途修改
    }
    this.fromParentId = fromParent
    this.fromIndex = fromIndex
    return { invalidation: 'flowbody' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    if (!this.fromParentId || this.fromIndex < 0) return null
    return new MoveBlockCommand(
      generateCommandId(), Date.now(), this.author,
      this.nodeId, this.fromParentId, this.fromIndex,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'move-block', id: this.id, timestamp: this.timestamp, author: this.author,
      changes: { nodeId: this.nodeId, toParentId: this.toParentId, toIndex: this.toIndex },
    }
  }
}

/**
 * 池中某节点的**直接父** id (无则 null)。
 *
 * 经 `pool.getChildren` 判定, 而不是直接读 `.children` —— 文档根的 children
 * 挂在 `body.children` 上, 直接读 `.children` 会把 body 级节点判成"没有父"。
 */
function findParentIdOf(pool: NodePool, nodeId: string): string | null {
  for (const [id] of pool.nodes) {
    if (pool.getChildren(id).includes(nodeId)) return id
  }
  return null
}

// ================================================================
// InsertSectionCommand — 在真容器指定下标处插入一个 Section
// (契约 §31.10 / §31.13: Section 只能住在 body 或另一个 Section 里)
// ================================================================

/** 插入节的选项 */
export interface InsertSectionOpts {
  /**
   * 是否同时建一个初始空段落 (编辑器默认 true)。
   *
   * **与模型层"节可以为空"是两件事**: `Section.children = []` 恒合法
   * (契约 §31.13, P1 已锁); 这里只回答"编辑器建节时要不要顺手给个可落 caret
   * 的位置"。显式传 false 即得空节 (导入/程序化构造走这条)。
   */
  withInitialParagraph?: boolean
  /** 节代码; 缺省 = 匿名节 (不写该字段, 不是写空串) */
  sectionCode?: string
}

export class InsertSectionCommand implements ICommand {
  readonly type = 'insert-section'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private containerId: string
  private index: number
  private opts: InsertSectionOpts
  /** forward 产出的新节 id (供门面在新节插入后选中它) */
  private newSectionId: string | null = null
  /** forward 时确定的容器身份 (invert 按同一容器恢复, 契约 §31.6) */
  private insertContainer: Container | null = null
  /** 铸造一次台账 (契约 §8.3): redo 复用首次的节点 id, 不重新铸造 */
  private mint = new MintedOnce()

  constructor(
    id: string, timestamp: number, author: string,
    /** 真容器 id: 文档根 id 或某个 Section 的 id (契约 §31.6) */
    containerId: string,
    /** 真结构下标 */
    index: number,
    opts: InsertSectionOpts = {},
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.containerId = containerId; this.index = index; this.opts = opts
  }

  get sectionId(): string | null { return this.newSectionId }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, doc } = ctx

    // 目标容器必须存在, 且必须是 body 或 Section —— 这是 §31.13 的显式拒绝。
    // 不在 cell / header / footer 里"想办法塞进去": 那是非法结构, 不是未支持。
    // 先判再改, 保证拒绝时不留下任何半成品, 也不产生 undo 条目。
    const container = this.containerId === doc.id ? undefined : pool.nodes.get(this.containerId)
    const legal = this.containerId === doc.id || container?.type === NodeType.SECTION
    if (!legal) return null

    // 铸造一次 (契约 §8.3)。once 区里包含「铸造 + 把初始段落插进节内」——
    // 这些在重放时都不能重做, 否则子节点会被插两次。
    const [sectionId, paraId] = this.mint.run(pool, () => {
      const section = createSection()
      if (this.opts.sectionCode !== undefined && this.opts.sectionCode !== '') {
        section.sectionCode = this.opts.sectionCode
      }
      pool.addNode(section)
      const roots: string[] = [section.id]
      if (this.opts.withInitialParagraph !== false) {
        const { text, para } = buildTrailingParagraph()
        pool.addNode(text)
        pool.addNode(para)
        pool.insertChild(section.id, para.id, 0)
        roots.push(para.id)
      }
      return roots
    })

    this.newSectionId = sectionId
    this.insertContainer = this.containerId === doc.id
      ? { kind: 'body' }
      : { kind: 'section', sectionId: this.containerId }

    // 把根放回容器 —— 每次 forward 都做 (重放时节点只是被重新注册, 还不在容器里)
    const len = pool.getChildren(this.containerId).length
    const at = Math.max(0, Math.min(this.index, len))
    pool.insertChild(this.containerId, sectionId, at)

    const cursor: Partial<CursorState> | undefined = paraId
      ? { paragraphPath: [doc.id, paraId], offset: 0, visible: true }
      : undefined

    return { cursor, invalidation: 'flowbody' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    if (!this.newSectionId) return null
    // 容器身份在 forward 时就已确定并记下 (body 还是某个节) —— 不在此刻反推,
    // 反推要再拿一次 doc 且容易写错 (契约 §31.6: 容器身份必须真)。
    if (!this.insertContainer) return null
    return new RemoveNodesCommand(
      generateCommandId(), Date.now(), this.author,
      [{ container: this.insertContainer, nodeIds: [this.newSectionId] }],
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'insert-section', id: this.id, timestamp: this.timestamp, author: this.author,
      changes: { containerId: this.containerId, index: this.index, ...this.opts },
    }
  }
}

// ================================================================
// UpdateSectionCommand — 写/清 Section.sectionCode (唯一可变语义属性)
// ================================================================

export class UpdateSectionCommand implements ICommand {
  readonly type = 'update-section'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private sectionId: string
  /** undefined = 清除该字段 (真删键, 不是写 undefined) */
  private next?: string
  private old?: string
  private hadOld = false

  constructor(
    id: string, timestamp: number, author: string,
    sectionId: string, next?: string,
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.sectionId = sectionId; this.next = next
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx
    const node = pool.nodes.get(this.sectionId) as { type?: string; sectionCode?: string } | undefined
    if (!node || node.type !== NodeType.SECTION) return null

    this.hadOld = 'sectionCode' in node
    this.old = node.sectionCode

    if (this.next === undefined) {
      // 真删键 (§12.6.1 规范空态: 缺失 ≡ 匿名, 与值 undefined 不等价)
      pool.deleteNodeField(this.sectionId, 'sectionCode')
    } else {
      pool.updateNode(this.sectionId, { sectionCode: this.next } as Partial<Paragraph>)
    }
    // sectionCode 不参与布局 (Section 不产出 item), 但 'none' 分支仍会重渲染 +
    // 发 contentChange, 大纲面板 / QC / 叠加层据此刷新 (与 UpdateDocumentTitle 同)。
    return { invalidation: 'none' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    return new UpdateSectionCommand(
      generateCommandId(), Date.now(), this.author,
      this.sectionId, this.hadOld ? this.old : undefined,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'update-section', id: this.id, timestamp: this.timestamp, author: this.author,
      changes: { sectionId: this.sectionId, sectionCode: this.next ?? null },
    }
  }
}
