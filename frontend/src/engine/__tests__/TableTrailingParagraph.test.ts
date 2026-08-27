// ============================================================
// TableTrailingParagraph — 复现「光标无法移动到表格后面」问题
//
// 验证: 表格后存在空段落时, 布局产物 + 命中检测 + 光标定位
// 均能落点; 表格是最后一个块 (无尾随段落) 时, 需能点击表格下方空白。
// ============================================================

import { describe, it, expect } from 'vitest'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { HitTestIndex } from '../render/HitTestIndex'
import { getFlatPageItems } from '../layout/core/SLIF'
import { MergeParagraphCommand } from '../command/commands/MergeParagraphCommand'
import { KeyboardHandler } from '../interaction/KeyboardHandler'
import type { Editor } from '../Editor'
import {
  createDocument, createParagraph, createTextNode,
  createTable, createTableRow, createTableCell,
} from '../document/ElementFormatter'
import { buildNodePool } from '../document/NodePool'
import type { BaseNode, Paragraph } from '../document/DocumentModel'

/** 注册文本 + 段落 */
function mkPara(allNodes: Map<string, BaseNode>, text: string): Paragraph {
  const tn = createTextNode(text)
  const para = createParagraph([tn.id])
  allNodes.set(tn.id, tn as unknown as BaseNode)
  allNodes.set(para.id, para as unknown as BaseNode)
  return para
}

/** 构建 [paraBefore, table(2x2), trailPara(空)] 的文档 */
function makeDocWithTrailingEmpty() {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)

  const mkCell = (text: string) => {
    const para = mkPara(allNodes, text)
    const cell = createTableCell([para.id])
    allNodes.set(cell.id, cell as unknown as BaseNode)
    return { cell, para }
  }
  const c00 = mkCell('aa')
  const c01 = mkCell('bbb')
  const c10 = mkCell('c')
  const c11 = mkCell('dddd')
  const row0 = createTableRow([c00.cell, c01.cell])
  const row1 = createTableRow([c10.cell, c11.cell])
  const table = createTable(
    [{ width: 50, mode: 'percentage' }, { width: 50, mode: 'percentage' }],
    [row0, row1],
  )
  for (const n of [table, row0, row1]) allNodes.set(n.id, n as unknown as BaseNode)

  const paraBefore = mkPara(allNodes, 'before')
  const trailPara = mkPara(allNodes, '') // 空尾随段落 (同 insertTable 产出)
  doc.body.children = [paraBefore.id, table.id, trailPara.id]

  const pool = buildNodePool(allNodes, { body: doc.id })
  const engine = new LayoutEngine(new EventBus())
  const pages = engine.fullLayout(doc, pool)
  return { doc, pool, pages, table, paraBefore, trailPara }
}

describe('表格后空段落: 布局 + 命中检测', () => {
  it('空尾随段落在表格下方产生可命中的布局 item', () => {
    const { pages, trailPara, pool } = makeDocWithTrailingEmpty()

    const items = pages.flatMap(p => p.items)
    const tableItem = items.find(i => i.type === 'table')!
    expect(tableItem).toBeDefined()

    // 表格后的空段落应产生一个 item (nodeId = 空 text 节点)
    const trailTextId = (pool.nodes.get(trailPara.id) as unknown as { children?: string[] })?.children?.[0]
    const trailItem = items.find(i => i.nodeId === trailTextId)
    expect(trailItem).toBeDefined()
    expect(trailItem!.y).toBe(tableItem.y + tableItem.height)
    expect(trailItem!.ascent + trailItem!.descent).toBeGreaterThan(0)
  })

  it('点击表格下方空白能命中空尾随段落', () => {
    const { pages, trailPara, pool } = makeDocWithTrailingEmpty()
    const page = pages[0]
    const tableItem = page.items.find(i => i.type === 'table')!
    const trailTextId = (pool.nodes.get(trailPara.id) as unknown as { children?: string[] })?.children?.[0]!

    const hitIndex = new HitTestIndex()
    hitIndex.rebuild(pages)

    // 点击表格底部边界下方 5px, 文档内容区 x=200
    const docX = 200
    const docY = tableItem.y + tableItem.height + 5
    const nodeId = hitIndex.hitTest(docX, docY, 0)
    expect(nodeId).toBe(trailTextId)
  })

  it('光标 (computeCaretPos 依赖的 flat items) 能定位到表格下方', () => {
    const { pages, trailPara, pool } = makeDocWithTrailingEmpty()
    const page = pages[0]
    const tableItem = page.items.find(i => i.type === 'table')!
    const trailTextId = (pool.nodes.get(trailPara.id) as unknown as { children?: string[] })?.children?.[0]!

    // computeCaretPos 使用 getFlatPageItems 搜索正文 item; 空尾随段落的 text item 必须在其中,
    // 且位于表格底部之下 (这样光标才会画在表格后面而不是叠在表格上)
    const flat = getFlatPageItems(page)
    const trailFlat = flat.find(i => i.nodeId === trailTextId)
    expect(trailFlat).toBeDefined()
    expect(trailFlat!.y).toBe(tableItem.y + tableItem.height)
    expect(trailFlat!.ascent + trailFlat!.descent).toBeGreaterThan(0)
  })

  it('方向键 ArrowDown 从末 cell 落到空尾随段落', () => {
    const { doc, pool, trailPara, table } = makeDocWithTrailingEmpty()

    // 末行末列 cell 的段落 (dddd)
    const lastCellPara = (() => {
      const rowNode = pool.nodes.get(table.children[table.children.length - 1]) as unknown as { children?: string[] }
      const cellNode = pool.nodes.get(rowNode!.children![rowNode!.children!.length - 1]) as unknown as { children?: string[] }
      return cellNode.children![0]
    })()

    const container = {
      addEventListener: () => {}, removeEventListener: () => {},
    } as unknown as HTMLElement
    const h = new KeyboardHandler({} as unknown as Editor, container)
    const nav = (h as unknown as { navigateBlock: (...a: unknown[]) => unknown }).navigateBlock
    const r = nav.call(h, lastCellPara, doc, pool, 1, 'vertical', 0)
    expect(r).toEqual({ paraId: trailPara.id, offset: 0 })
  })
})

describe('表格是最后一个块 (无尾随段落)', () => {
  function makeDocTableLast() {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const paraBefore = mkPara(allNodes, 'before')
    const para = mkPara(allNodes, 'x')
    const cell = createTableCell([para.id])
    allNodes.set(cell.id, cell as unknown as BaseNode)
    const row = createTableRow([cell])
    const table = createTable([{ width: 100, mode: 'percentage' }], [row])
    for (const n of [table, row]) allNodes.set(n.id, n as unknown as BaseNode)
    doc.body.children = [paraBefore.id, table.id]
    const pool = buildNodePool(allNodes, { body: doc.id })
    const engine = new LayoutEngine(new EventBus())
    const pages = engine.fullLayout(doc, pool)
    return { doc, pool, pages, table, paraBefore }
  }

  it('表格为末块时, 点击表格下方空白返回 null (无落点)', () => {
    const { pages } = makeDocTableLast()
    const page = pages[0]
    const tableItem = page.items.find(i => i.type === 'table')!
    const hitIndex = new HitTestIndex()
    hitIndex.rebuild(pages)

    const nodeId = hitIndex.hitTest(200, tableItem.y + tableItem.height + 5, 0)
    // 无尾随段落 → 表格下方空白无任何命中 (这就是「死区」)
    expect(nodeId).toBeNull()
  })
})

describe('尾随段落退格不并入表格 (结构保护)', () => {
  it('表格后段落在 offset=0 退格时, MergeParagraphCommand 返回 null 且不破坏表格', () => {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)

    const cellPara = mkPara(allNodes, 'x')
    const cell = createTableCell([cellPara.id])
    allNodes.set(cell.id, cell as unknown as BaseNode)
    const row = createTableRow([cell])
    const table = createTable([{ width: 100, mode: 'percentage' }], [row])
    for (const n of [table, row]) allNodes.set(n.id, n as unknown as BaseNode)

    const trailPara = mkPara(allNodes, 'after')
    doc.body.children = [table.id, trailPara.id]
    const pool = buildNodePool(allNodes, { body: doc.id })

    const ctx = { mode: 'local' as const, doc, pool }
    const patch = new MergeParagraphCommand('c1', 1, 'user', [doc.id, trailPara.id]).forward(ctx)

    // 上一兄弟是表格 → 不并段 (返回 null), 表格 children 仍只有 row 节点
    expect(patch).toBeNull()
    expect(doc.body.children).toEqual([table.id, trailPara.id])
    expect(table.children.length).toBe(1) // 未被插入 text 节点
  })
})
