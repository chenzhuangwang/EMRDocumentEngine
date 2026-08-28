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
  BaseNode, DocumentTree, Paragraph, PageSetup, CommentThread, FootnoteContent,
} from '../../document/core/DocumentModel'
import { createParagraph, createTextNode } from '../../document/factory/ElementFormatter'
import type { NodePool } from '../../document/core/NodePool'
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
  const ids: string[] = []
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()!
    ids.push(id)
    const node = pool.nodes.get(id)
    const children = (node as unknown as { children?: readonly string[] } | undefined)?.children
    if (children) for (const c of children) stack.push(c)
  }
  const cloned = JSON.parse(JSON.stringify(ids.map(id => pool.nodes.get(id)))) as BaseNode[]
  const map = new Map<string, BaseNode>()
  for (const n of cloned) if (n) map.set(n.id, n)
  return map
}

/** 新建空白段落 (含空 text 节点), 注册进 pool, 返回段落节点 */
function createTrailingParagraph(pool: NodePool): Paragraph {
  const text = createTextNode('')
  const para = createParagraph([text.id])
  pool.addNode(text)
  pool.addNode(para)
  return para
}

// ================================================================
// RemoveNodesCommand — 通用逆操作原语
// ================================================================

type Container =
  | { kind: 'paragraph'; paraId: string }
  | { kind: 'cell'; cellId: string }
  | { kind: 'body' }
  | { kind: 'header' }
  | { kind: 'footer' }
  | { kind: 'footnotes' }

interface NodeRemoval {
  container: Container
  nodeIds: string[]
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

  constructor(
    id: string, timestamp: number, author: string,
    removals: NodeRemoval[], removeThreadIds: string[] = [],
    restoreCursor?: Partial<CursorState>,
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.removals = removals
    this.removeThreadIds = removeThreadIds
    this.restoreCursor = restoreCursor
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, doc } = ctx

    for (const { container, nodeIds } of this.removals) {
      for (const nodeId of nodeIds) {
        if (container.kind === 'paragraph' || container.kind === 'cell') {
          const parentId = container.kind === 'paragraph' ? container.paraId : container.cellId
          const children = pool.getChildren(parentId)
          const idx = children.indexOf(nodeId)
          if (idx >= 0) pool.removeChild(parentId, idx)
          else removeSubtree(pool, nodeId)
        } else if (container.kind === 'body') {
          // doc.body.children 是 children 数组 (PROBLEM B choke point), 经 NodePool
          const idx = doc.body.children.indexOf(nodeId)
          if (idx >= 0) { pool.detachChild(doc.id, idx); removeSubtree(pool, nodeId) }
          else removeSubtree(pool, nodeId)
        } else {
          // header/footer/footnotes 是文档级 string[] (非 children 数组), 直接 splice
          const arr = this.docArray(doc, container)
          const idx = arr.indexOf(nodeId)
          if (idx >= 0) { arr.splice(idx, 1); removeSubtree(pool, nodeId) }
          else removeSubtree(pool, nodeId)
        }
      }
    }

    if (doc.comments && this.removeThreadIds.length > 0) {
      const ids = new Set(this.removeThreadIds)
      doc.comments = doc.comments.filter(t => !ids.has(t.id))
    }

    return { cursor: this.restoreCursor, invalidation: 'flowbody' }
  }

  private docArray(doc: DocumentTree, container: Container): string[] {
    switch (container.kind) {
      case 'header':
        if (!doc.header) doc.header = []
        return doc.header
      case 'footer':
        if (!doc.footer) doc.footer = []
        return doc.footer
      case 'footnotes':
        if (!doc.footnotes) doc.footnotes = []
        return doc.footnotes
      case 'body': case 'paragraph': case 'cell': throw new Error('pool-based container not handled here')
    }
  }

  serialize(): SerializedCommand {
    return { type: 'remove-nodes', id: this.id, timestamp: this.timestamp, author: this.author }
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

    const node = this.makeNode()
    pool.addNode(node)
    this.insertedNodeId = node.id

    const resolved = pool.resolveCharOffset(paraId, this.offset)
    if (resolved) {
      const idx = para.children.indexOf(resolved.textNodeId)
      if (idx >= 0) pool.insertChild(paraId, node.id, idx + 1)
      else pool.insertChild(paraId, node.id, para.children.length)
    } else {
      pool.insertChild(paraId, node.id, para.children.length)
    }
    return { invalidation: 'paragraph' }
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
    const idx = doc.body.children.indexOf(paraId)
    if (idx < 0) return null

    const block = this.makeBlock(pool)
    pool.insertChild(doc.id, block.id, idx + 1)
    this.insertedRootIds = [block.id]

    let cursor: Partial<CursorState> | undefined
    if (this.withTrailingParagraph) {
      const trail = createTrailingParagraph(pool)
      pool.insertChild(doc.id, trail.id, doc.body.children.indexOf(block.id) + 1)
      this.insertedRootIds.push(trail.id)
      if (this.moveCursorToTrailing) {
        cursor = { paragraphPath: [doc.id, trail.id], offset: 0, visible: true }
      }
    }

    return { cursor, invalidation: 'flowbody' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    return new RemoveNodesCommand(
      generateCommandId(), Date.now(), this.author,
      [{ container: { kind: 'body' }, nodeIds: this.insertedRootIds }],
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

    // 脚注内容 (含空段落) + 注册到 doc.footnotes
    const fnContent = this.makeContent(pool)
    this.insertedContentId = fnContent.id
    if (!doc.footnotes) doc.footnotes = []
    doc.footnotes.push(fnContent.id)

    // 脚注引用, 插入正文
    const fnRef = this.makeRef(fnContent.id)
    pool.addNode(fnRef)
    fnContent.refId = fnRef.id
    this.insertedRefId = fnRef.id

    const resolved = pool.resolveCharOffset(paraId, this.offset)
    if (resolved) {
      const idx = para.children.indexOf(resolved.textNodeId)
      if (idx >= 0) pool.insertChild(paraId, fnRef.id, idx + 1)
      else pool.insertChild(paraId, fnRef.id, para.children.length)
    } else {
      pool.insertChild(paraId, fnRef.id, para.children.length)
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
  private createdParaId: string | null = null

  constructor(id: string, timestamp: number, author: string, section: 'header' | 'footer') {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.section = section
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, doc } = ctx
    const arr = this.section === 'header'
      ? (doc.header ?? (doc.header = []))
      : (doc.footer ?? (doc.footer = []))
    if (arr.length > 0) return null
    const para = createTrailingParagraph(pool)
    arr.push(para.id)
    this.createdParaId = para.id
    return { invalidation: 'full' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    if (!this.createdParaId) return null
    return new RemoveNodesCommand(
      generateCommandId(), Date.now(), this.author,
      [{ container: { kind: this.section }, nodeIds: [this.createdParaId] }],
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'ensure-header-footer-paragraph', id: this.id, timestamp: this.timestamp,
      author: this.author, changes: { section: this.section },
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

  constructor(id: string, timestamp: number, author: string) {
    this.id = id; this.timestamp = timestamp; this.author = author
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, doc } = ctx
    // 已有段落则视为无操作 (body 非空即无需补段落)
    if (doc.body.children.length > 0) return null
    const para = createParagraph()
    pool.addNode(para)
    doc.body.children = [para.id]
    this.createdParaId = para.id
    return {
      cursor: { paragraphPath: [doc.id, para.id], offset: 0, visible: true },
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
    const children = cell.children ?? []
    for (const id of children) {
      if (pool.nodes.get(id)?.type === 'paragraph') return null  // 已有段落
    }
    const para = createParagraph()
    pool.addNode(para)
    cell.children = [...children, para.id]
    this.createdParaId = para.id
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
  private parentIndex = -1

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
    const idx = doc.body.children.indexOf(this.tableId)
    if (idx < 0) return null
    this.parentIndex = idx
    this.snapshot = cloneSubtree(pool, this.tableId)
    const changed = this.mutate(pool)
    if (!changed) {
      this.snapshot = null
      return null
    }
    return { invalidation: 'table' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    if (!this.snapshot || this.parentIndex < 0) return null
    return new RestoreTableCommand(
      generateCommandId(), Date.now(), this.author,
      this.tableId, this.snapshot, this.parentIndex,
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

  constructor(
    id: string, timestamp: number, author: string,
    tableId: string, snapshot: Map<string, BaseNode>, parentIndex: number,
  ) {
    this.id = id; this.timestamp = timestamp; this.author = author
    this.tableId = tableId; this.snapshot = snapshot; this.parentIndex = parentIndex
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool, doc } = ctx

    // 1. 摘除当前 table 子树
    const idx = doc.body.children.indexOf(this.tableId)
    if (idx >= 0) { pool.detachChild(doc.id, idx); removeSubtree(pool, this.tableId) }

    // 2. 重新注册快照节点
    for (const [, node] of this.snapshot) pool.addNode(node)

    // 3. 回到原位置
    const at = Math.min(this.parentIndex, doc.body.children.length)
    pool.insertChild(doc.id, this.tableId, at)

    return { invalidation: 'table' }
  }

  serialize(): SerializedCommand {
    return { type: 'restore-table', id: this.id, timestamp: this.timestamp, author: this.author }
  }
}
