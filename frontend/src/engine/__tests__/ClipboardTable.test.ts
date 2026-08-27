// ============================================================
// ClipboardTable — 表格单元格内复制 (修复 body-only 局限)
//
// 复现并防止: ClipboardManager.copy 只用 body.children 定位段落,
// 导致 cell 内选区 indexOf 返回 -1 直接 return, 复制完全失效。
// 修复后按 scope (body/cell) 选择 siblings, 同 cell 内段落可正常复制。
// ============================================================

import { describe, it, expect } from 'vitest'
import { ClipboardManager } from '../command/ClipboardManager'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode,
  createTable, createTableRow, createTableCell,
} from '../document/factory/ElementFormatter'
import type { BaseNode, Paragraph } from '../document/core/DocumentModel'

function mkPara(allNodes: Map<string, BaseNode>, text: string): Paragraph {
  const tn = createTextNode(text)
  const para = createParagraph([tn.id])
  allNodes.set(tn.id, tn as unknown as BaseNode)
  allNodes.set(para.id, para as unknown as BaseNode)
  return para
}

/** 构造 body 段落 + 2x1 表格 (cell00 内两个段落 hello/world, cell01 一个段落 zz) */
function makeTableDoc() {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)

  const bodyPara = mkPara(allNodes, 'body')

  const p1 = mkPara(allNodes, 'hello')
  const p2 = mkPara(allNodes, 'world')
  const cell00 = createTableCell([p1.id, p2.id])
  allNodes.set(cell00.id, cell00 as unknown as BaseNode)

  const p3 = mkPara(allNodes, 'zz')
  const cell01 = createTableCell([p3.id])
  allNodes.set(cell01.id, cell01 as unknown as BaseNode)

  const row0 = createTableRow([cell00, cell01])
  const table = createTable(
    [{ width: 50, mode: 'percentage' }, { width: 50, mode: 'percentage' }],
    [row0],
  )
  for (const n of [table, row0]) allNodes.set(n.id, n as unknown as BaseNode)

  doc.body.children = [bodyPara.id, table.id]
  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool, bodyPara, p1, p2, p3 }
}

describe('ClipboardManager 表格内复制', () => {
  it('cell 内单段落全选复制 → 得到完整文本', () => {
    const { doc, pool, p1 } = makeTableDoc()
    const cm = new ClipboardManager()
    cm.copy([doc.id, p1.id], 0, [doc.id, p1.id], 5, doc, pool)

    const data = cm.paste()
    expect(data).not.toBeNull()
    expect(data!.plainText).toBe('hello')
  })

  it('cell 内跨段落复制 (hello → world) → 两个段落 + 换行', () => {
    const { doc, pool, p1, p2 } = makeTableDoc()
    const cm = new ClipboardManager()
    cm.copy([doc.id, p1.id], 0, [doc.id, p2.id], 5, doc, pool)

    const data = cm.paste()
    expect(data).not.toBeNull()
    expect(data!.plainText).toBe('hello\nworld')
    expect(data!.nodes).toHaveLength(2)
  })

  it('跨 cell 复制 (cell00 → cell01) → 不复制', () => {
    const { doc, pool, p1, p3 } = makeTableDoc()
    const cm = new ClipboardManager()
    cm.copy([doc.id, p1.id], 0, [doc.id, p3.id], 2, doc, pool)

    expect(cm.paste()).toBeNull()
  })

  it('跨域复制 (body → cell) → 不复制', () => {
    const { doc, pool, bodyPara, p1 } = makeTableDoc()
    const cm = new ClipboardManager()
    cm.copy([doc.id, bodyPara.id], 0, [doc.id, p1.id], 5, doc, pool)

    expect(cm.paste()).toBeNull()
  })
})

describe('ClipboardManager 外部覆盖语义 (焦点同步依赖)', () => {
  it('setPlainText 覆盖旧数据, getPlainText 返回最新纯文本', () => {
    const cm = new ClipboardManager()
    cm.setPlainText('old')
    expect(cm.getPlainText()).toBe('old')
    // 模拟外部复制了新内容 → 覆盖内存旧数据
    cm.setPlainText('new-from-outside')
    expect(cm.getPlainText()).toBe('new-from-outside')
  })

  it('无数据时 getPlainText 返回 null', () => {
    expect(new ClipboardManager().getPlainText()).toBeNull()
  })
})
