// ============================================================
// FindReplaceEngine — 搜索范围 = 全文档 spine (正文 + 表格 cell + 页眉/页脚各变体)
//
// 回归: 原 findAll 默认只扫 doc.body.children, 页眉/页脚文字完全搜不到;
// 且 findNext/findPrevious 用 doc.body.children.indexOf 排序, 页眉/页脚
// 段落得到 -1 → 越序/漏选。
// ============================================================

import { describe, it, expect } from 'vitest'
import { FindReplaceEngine } from '../FindReplaceEngine'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode,
  createTable, createTableRow, createTableCell,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'

interface Fixture {
  doc: DocumentTree
  pool: NodePool
  body: string
  header: string
  footer: string
  cell: string
}

/** 正文(含表格 cell) + 页眉 + 页脚, 每段都含关键词 'X' */
function fixture(): Fixture {
  const doc = createDocument('find')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)

  const mk = (text: string) => {
    const tn = createTextNode(text)
    const p = createParagraph([tn.id])
    all.set(tn.id, tn as unknown as BaseNode)
    all.set(p.id, p as unknown as BaseNode)
    return p.id
  }

  const body = mk('正文X内容')
  const header = mk('页眉X内容')
  const footer = mk('页脚X内容')
  const cellPara = mk('单元格X内容')

  // 表格: table → row → cell → paragraph
  const cell = createTableCell([cellPara])
  const row = createTableRow([cell])
  const table = createTable([], [row])
  all.set(cell.id, cell as unknown as BaseNode)
  all.set(row.id, row as unknown as BaseNode)
  all.set(table.id, table as unknown as BaseNode)

  doc.body.children = [body, table.id]
  doc.header = [header]
  doc.footer = [footer]

  const pool = buildNodePool(all, { body: doc.id, header: doc.header, footer: doc.footer })
  return { doc, pool, body, header, footer, cell: cellPara }
}

const paraOf = (r: { paragraphPath: string[] }) => r.paragraphPath[r.paragraphPath.length - 1]

describe('FindReplaceEngine.findAll — 默认范围含页眉/页脚', () => {
  it('正文 + 页眉 + 页脚 都被搜到', () => {
    const f = fixture()
    const results = new FindReplaceEngine().findAll('X', f.doc, f.pool)
    const ids = results.map(paraOf)
    expect(ids).toContain(f.body)
    expect(ids).toContain(f.header)
    expect(ids).toContain(f.footer)
  })

  it('表格 cell 内段落也被搜到 (旧实现只扫 body.children, 漏掉)', () => {
    const f = fixture()
    const ids = new FindReplaceEngine().findAll('X', f.doc, f.pool).map(paraOf)
    expect(ids).toContain(f.cell)
  })

  it('顺序为 正文(含 cell) → 页眉 → 页脚', () => {
    const f = fixture()
    const ids = new FindReplaceEngine().findAll('X', f.doc, f.pool).map(paraOf)
    expect(ids.indexOf(f.body)).toBeLessThan(ids.indexOf(f.header))
    expect(ids.indexOf(f.header)).toBeLessThan(ids.indexOf(f.footer))
  })

  it('显式 paragraphIds 仍可覆盖默认范围', () => {
    const f = fixture()
    const ids = new FindReplaceEngine()
      .findAll('X', f.doc, f.pool, { paragraphIds: [f.footer] }).map(paraOf)
    expect(ids).toEqual([f.footer])
  })

  it('变体页眉也在范围内 (首页/偶数页)', () => {
    const f = fixture()
    const tn = createTextNode('首页页眉X')
    const p = createParagraph([tn.id])
    f.pool.addNode(tn as unknown as BaseNode)
    f.pool.addNode(p as unknown as BaseNode)
    f.doc.firstPageHeader = [p.id]
    const ids = new FindReplaceEngine().findAll('X', f.doc, f.pool).map(paraOf)
    expect(ids).toContain(p.id)
  })
})

describe('FindReplaceEngine.findNext — 全文档阅读序 (不再越序)', () => {
  it('正文 → 页眉 → 页脚 依次推进, 末尾回绕到首项', () => {
    const f = fixture()
    const engine = new FindReplaceEngine()
    const order = [f.body, f.cell, f.header, f.footer] // documentSpine 顺序

    // 从正文首段之前开始 → 应得第一项
    let cur = engine.findNext('X', [f.doc.id, f.body], -1, f.doc, f.pool)
    expect(paraOf(cur!)).toBe(order[0])

    // 逐项推进
    for (let i = 0; i < order.length - 1; i++) {
      cur = engine.findNext('X', cur!.paragraphPath, cur!.startOffset, f.doc, f.pool)
      expect(paraOf(cur!)).toBe(order[i + 1])
    }

    // 最后一项之后 → 回绕到第一项
    cur = engine.findNext('X', cur!.paragraphPath, cur!.startOffset, f.doc, f.pool)
    expect(paraOf(cur!)).toBe(order[0])
  })

  it('从页眉出发能推进到页脚 (旧实现此处会跳回正文)', () => {
    const f = fixture()
    const engine = new FindReplaceEngine()
    const headerHit = engine.findAll('X', f.doc, f.pool).find(r => paraOf(r) === f.header)!
    const next = engine.findNext('X', headerHit.paragraphPath, headerHit.startOffset, f.doc, f.pool)
    expect(paraOf(next!)).toBe(f.footer)
  })
})

describe('FindReplaceEngine.findPrevious — 全文档阅读序', () => {
  it('页脚 → 页眉 → cell → 正文 反向推进', () => {
    const f = fixture()
    const engine = new FindReplaceEngine()
    const order = [f.body, f.cell, f.header, f.footer]

    // 从页脚项反向 → 页眉
    const footerHit = engine.findAll('X', f.doc, f.pool).find(r => paraOf(r) === f.footer)!
    let cur = engine.findPrevious('X', footerHit.paragraphPath, footerHit.endOffset, f.doc, f.pool)
    expect(paraOf(cur!)).toBe(order[2])

    cur = engine.findPrevious('X', cur!.paragraphPath, cur!.endOffset, f.doc, f.pool)
    expect(paraOf(cur!)).toBe(order[1])

    // 从正文首项反向 → 回绕到最后一项 (页脚)
    const bodyHit = engine.findAll('X', f.doc, f.pool).find(r => paraOf(r) === f.body)!
    cur = engine.findPrevious('X', bodyHit.paragraphPath, bodyHit.endOffset, f.doc, f.pool)
    expect(paraOf(cur!)).toBe(f.footer)
  })
})
