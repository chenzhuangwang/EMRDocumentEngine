// ============================================================
// StructuralCommands — 结构性命令 forward/undo 单元测试 (v20.36)
//
// 覆盖「全部改为 Command」新增的逆操作原语与 ensure 类命令:
//   - RemoveNodesCommand 的 cell 容器变体 (新代码, 此前零覆盖)
//   - EnsureBodyParagraphCommand (空文档首段)
//   - EnsureCellParagraphCommand (空 cell 补段落 + undo 恢复源光标)
//   - EnsureHeaderFooterParagraphCommand (页眉/页脚补段落)
// 所有命令均直接以 forward/invert 验证, 与 InsertNodesCommandPaste 一致。
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  RemoveNodesCommand,
  EnsureBodyParagraphCommand,
  EnsureCellParagraphCommand,
  EnsureHeaderFooterParagraphCommand,
} from '../command/commands/StructuralCommands'
import { buildNodePool } from '../document/core/NodePool'
import type { NodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode,
  createTable, createTableRow, createTableCell,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'
import type { CommandContext } from '../command/ICommand'

// ================================================================
// fixtures
// ================================================================

function ctxOf(doc: DocumentTree, pool: NodePool): CommandContext {
  return { mode: 'local', doc, pool }
}

/** 空文档: body 无任何节点 */
function makeEmptyDoc(): { doc: DocumentTree; pool: NodePool } {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool }
}

/** 含单个正文段落 (文本 text) 的文档 */
function makeDocWithPara(text: string): { doc: DocumentTree; pool: NodePool; paraId: string } {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const tn = createTextNode(text)
  const para = createParagraph([tn.id])
  allNodes.set(tn.id, tn as unknown as BaseNode)
  allNodes.set(para.id, para as unknown as BaseNode)
  doc.body.children = [para.id]
  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool, paraId: para.id }
}

/** 含一个空 cell (无段落) 的表格 */
function makeEmptyCellTable(): { doc: DocumentTree; pool: NodePool; cellId: string } {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const cell = createTableCell([])
  allNodes.set(cell.id, cell as unknown as BaseNode)
  const row = createTableRow([cell])
  allNodes.set(row.id, row as unknown as BaseNode)
  const table = createTable([{ width: 100, mode: 'percentage' }], [row])
  allNodes.set(table.id, table as unknown as BaseNode)
  doc.body.children = [table.id]
  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool, cellId: cell.id }
}

/** 含一个 cell (内有 text 段落) 的表格 — 供验证子树摘除 */
function makeCellWithPara(text: string): {
  doc: DocumentTree; pool: NodePool; cellId: string; paraId: string; textId: string
} {
  const { doc, pool, cellId } = makeEmptyCellTable()
  const tn = createTextNode(text)
  const para = createParagraph([tn.id])
  pool.addNode(tn as unknown as BaseNode)
  pool.addNode(para as unknown as BaseNode)
  const cell = pool.nodes.get(cellId) as { children?: readonly string[] }
  cell.children = [para.id]
  return { doc, pool, cellId, paraId: para.id, textId: tn.id }
}

function cellChildren(pool: NodePool, cellId: string): readonly string[] {
  return (pool.nodes.get(cellId) as { children?: readonly string[] } | undefined)?.children ?? []
}

// ================================================================
// RemoveNodesCommand — cell 容器 (新变体)
// ================================================================

describe('RemoveNodesCommand — cell 容器', () => {
  it('摘除 cell 内段落及其 text 子树', () => {
    const { doc, pool, cellId, paraId, textId } = makeCellWithPara('hello')
    const cmd = new RemoveNodesCommand('c1', 1, 'u', [
      { container: { kind: 'cell', cellId }, nodeIds: [paraId] },
    ])
    const patch = cmd.forward(ctxOf(doc, pool))

    expect(cellChildren(pool, cellId)).toHaveLength(0)
    expect(pool.nodes.has(paraId)).toBe(false)
    expect(pool.nodes.has(textId)).toBe(false)
    expect(patch?.invalidation).toBe('flowbody')
  })

  it('仅摘除指定节点, 保留 cell 内其他段落', () => {
    const { doc, pool, cellId, paraId } = makeCellWithPara('a')
    // 追加第二个段落, 只删第一个
    const tn2 = createTextNode('b')
    const para2 = createParagraph([tn2.id])
    pool.addNode(tn2 as unknown as BaseNode)
    pool.addNode(para2 as unknown as BaseNode)
    const cell = pool.nodes.get(cellId) as { children?: readonly string[] }
    cell.children = [paraId, para2.id]

    const cmd = new RemoveNodesCommand('c1', 1, 'u', [
      { container: { kind: 'cell', cellId }, nodeIds: [paraId] },
    ])
    cmd.forward(ctxOf(doc, pool))

    expect(cellChildren(pool, cellId)).toEqual([para2.id])
    expect(pool.nodes.has(para2.id)).toBe(true)
    expect(pool.nodes.has(paraId)).toBe(false)
  })
})

// ================================================================
// EnsureBodyParagraphCommand
// ================================================================

describe('EnsureBodyParagraphCommand', () => {
  it('空文档 forward 创建首段, 光标落到段首', () => {
    const { doc, pool } = makeEmptyDoc()
    const cmd = new EnsureBodyParagraphCommand('c1', 1, 'u')
    const patch = cmd.forward(ctxOf(doc, pool))

    expect(doc.body.children).toHaveLength(1)
    const paraId = doc.body.children[0]
    expect(pool.nodes.get(paraId)?.type).toBe('paragraph')
    expect(patch?.cursor?.paragraphPath).toEqual([doc.id, paraId])
    expect(patch?.cursor?.offset).toBe(0)
    expect(patch?.invalidation).toBe('flowbody')
  })

  it('非空文档 forward 为无操作 (返回 null)', () => {
    const { doc, pool } = makeDocWithPara('x')
    const cmd = new EnsureBodyParagraphCommand('c1', 1, 'u')
    expect(cmd.forward(ctxOf(doc, pool))).toBeNull()
    expect(doc.body.children).toHaveLength(1)
  })

  it('invert 移除首段并恢复空光标', () => {
    const { doc, pool } = makeEmptyDoc()
    const cmd = new EnsureBodyParagraphCommand('c1', 1, 'u')
    cmd.forward(ctxOf(doc, pool))
    const paraId = doc.body.children[0]

    const inverse = cmd.invert(ctxOf(doc, pool))
    expect(inverse).not.toBeNull()
    const patch = inverse!.forward(ctxOf(doc, pool))

    expect(doc.body.children).toHaveLength(0)
    expect(pool.nodes.has(paraId)).toBe(false)
    expect(patch?.cursor?.paragraphPath).toEqual([])
  })

  it('collab 模式 forward 返回 null (仅 local 生效)', () => {
    const { doc } = makeEmptyDoc()
    const cmd = new EnsureBodyParagraphCommand('c1', 1, 'u')
    const collabCtx = { mode: 'collab' as const, ydoc: {}, origin: 'remote' }
    expect(cmd.forward(collabCtx)).toBeNull()
    expect(doc.body.children).toHaveLength(0)
  })
})

// ================================================================
// EnsureCellParagraphCommand
// ================================================================

describe('EnsureCellParagraphCommand', () => {
  it('空 cell forward 补段落, 无光标 patch, 失效范围 table', () => {
    const { doc, pool, cellId } = makeEmptyCellTable()
    const cmd = new EnsureCellParagraphCommand('c1', 1, 'u', cellId)
    const patch = cmd.forward(ctxOf(doc, pool))

    expect(cellChildren(pool, cellId)).toHaveLength(1)
    const paraId = cellChildren(pool, cellId)[0]
    expect(pool.nodes.get(paraId)?.type).toBe('paragraph')
    expect(cmd.paragraphId).toBe(paraId)
    expect(patch?.invalidation).toBe('table')
    expect(patch?.cursor).toBeUndefined()
  })

  it('已有段落的 cell forward 为无操作', () => {
    const { doc, pool, cellId } = makeCellWithPara('x')
    const cmd = new EnsureCellParagraphCommand('c1', 1, 'u', cellId)
    expect(cmd.forward(ctxOf(doc, pool))).toBeNull()
    expect(cellChildren(pool, cellId)).toHaveLength(1)
  })

  it('不存在的 cell forward 返回 null', () => {
    const { doc, pool } = makeEmptyCellTable()
    const cmd = new EnsureCellParagraphCommand('c1', 1, 'u', 'ghost_cell')
    expect(cmd.forward(ctxOf(doc, pool))).toBeNull()
    expect(cmd.paragraphId).toBeNull()
  })

  it('invert 移除 cell 段落并恢复源光标', () => {
    const { doc, pool, cellId } = makeEmptyCellTable()
    const srcCursor = { paragraphPath: [doc.id, 'src-para'], offset: 3, visible: true }
    const cmd = new EnsureCellParagraphCommand('c1', 1, 'u', cellId, srcCursor)
    cmd.forward(ctxOf(doc, pool))
    const paraId = cmd.paragraphId!

    const inverse = cmd.invert(ctxOf(doc, pool))
    expect(inverse).not.toBeNull()
    const patch = inverse!.forward(ctxOf(doc, pool))

    expect(cellChildren(pool, cellId)).toHaveLength(0)
    expect(pool.nodes.has(paraId)).toBe(false)
    expect(patch?.cursor?.paragraphPath).toEqual(srcCursor.paragraphPath)
    expect(patch?.cursor?.offset).toBe(srcCursor.offset)
  })

  it('无 restoreCursor 时 invert 不恢复光标', () => {
    const { doc, pool, cellId } = makeEmptyCellTable()
    const cmd = new EnsureCellParagraphCommand('c1', 1, 'u', cellId)
    cmd.forward(ctxOf(doc, pool))
    const patch = cmd.invert(ctxOf(doc, pool))!.forward(ctxOf(doc, pool))
    expect(patch?.cursor).toBeUndefined()
  })
})

// ================================================================
// EnsureHeaderFooterParagraphCommand
// ================================================================

describe('EnsureHeaderFooterParagraphCommand', () => {
  it('空 header forward 补段落, 失效范围 full', () => {
    const { doc, pool } = makeEmptyDoc()
    const cmd = new EnsureHeaderFooterParagraphCommand('c1', 1, 'u', 'header')
    const patch = cmd.forward(ctxOf(doc, pool))

    expect(doc.header).toHaveLength(1)
    expect(pool.nodes.get(doc.header![0])?.type).toBe('paragraph')
    expect(patch?.invalidation).toBe('full')
  })

  it('已有段落的 header forward 为无操作', () => {
    const { doc, pool } = makeEmptyDoc()
    const tn = createTextNode('h')
    const para = createParagraph([tn.id])
    pool.addNode(tn as unknown as BaseNode)
    pool.addNode(para as unknown as BaseNode)
    doc.header = [para.id]

    const cmd = new EnsureHeaderFooterParagraphCommand('c1', 1, 'u', 'header')
    expect(cmd.forward(ctxOf(doc, pool))).toBeNull()
    expect(doc.header).toHaveLength(1)
  })

  it('invert 移除 header 段落', () => {
    const { doc, pool } = makeEmptyDoc()
    const cmd = new EnsureHeaderFooterParagraphCommand('c1', 1, 'u', 'header')
    cmd.forward(ctxOf(doc, pool))
    const paraId = doc.header![0]

    const inverse = cmd.invert(ctxOf(doc, pool))
    expect(inverse).not.toBeNull()
    inverse!.forward(ctxOf(doc, pool))

    expect(doc.header).toHaveLength(0)
    expect(pool.nodes.has(paraId)).toBe(false)
  })

  it('footer 与 header 独立: 空 footer forward 补段落', () => {
    const { doc, pool } = makeEmptyDoc()
    const cmd = new EnsureHeaderFooterParagraphCommand('c1', 1, 'u', 'footer')
    cmd.forward(ctxOf(doc, pool))
    expect(doc.footer).toHaveLength(1)
    expect(doc.header).toHaveLength(0)
  })
})
