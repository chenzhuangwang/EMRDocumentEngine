// ============================================================
// HeaderFooterEdit — 页眉/页脚结构编辑 (拆段/并段)
//
// 复现并防止: 页眉/页脚段落存储在 doc.header / doc.footer 独立数组中
// (不在 doc.body.children / pool 的 children 解析内), 导致:
//   1. Enter 拆段 → 新段落误插入 body (页脚文字被搬到正文)
//   2. Backspace 并段 → 静默失败 (找不到上一段)
//   3. 并段时 removeChild 误删已合并的文本节点 → 文字丢失
// 修复: resolveParagraphRegion 统一解析 body/cell/header/footer 区域。
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree, Paragraph } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'
import type { CommandContext } from '../command/ICommand'
import { SplitParagraphCommand } from '../command/commands/SplitParagraphCommand'
import { MergeParagraphCommand } from '../command/commands/MergeParagraphCommand'
import { InsertNodesCommand } from '../command/commands/InsertNodesCommand'
import { resolveParagraphRegion } from '../state/CaretScope'
import type { SerializedPara } from '../command/ClipboardManager'

function ctxOf(doc: DocumentTree, pool: NodePool): CommandContext {
  return { mode: 'local', doc, pool }
}

function paraText(pool: NodePool, paraId: string): string {
  const para = pool.nodes.get(paraId) as { children?: string[] } | undefined
  if (!para?.children) return ''
  return para.children.map(cid => {
    const n = pool.nodes.get(cid) as { type?: string; text?: string } | undefined
    return n?.type === 'text' ? (n.text || '') : ''
  }).join('')
}

/** 构造仅含页脚两段的文档 (footer = [p1, p2]), body 为空 */
function makeFooterDoc(): { doc: DocumentTree; pool: NodePool; p1: Paragraph; p2: Paragraph } {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)

  const t1 = createTextNode('Hello')
  const p1 = createParagraph([t1.id])
  const t2 = createTextNode('World')
  const p2 = createParagraph([t2.id])

  allNodes.set(t1.id, t1 as unknown as BaseNode)
  allNodes.set(p1.id, p1 as unknown as BaseNode)
  allNodes.set(t2.id, t2 as unknown as BaseNode)
  allNodes.set(p2.id, p2 as unknown as BaseNode)

  doc.body.children = []
  doc.header = []
  doc.footer = [p1.id, p2.id]

  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool, p1, p2 }
}

describe('resolveParagraphRegion 区域解析', () => {
  it('页脚段落 → footer 区域', () => {
    const { doc, pool, p1 } = makeFooterDoc()
    const region = resolveParagraphRegion(p1.id, doc, pool)
    expect(region?.type).toBe('footer')
    expect(region?.index).toBe(0)
  })

  it('正文段落 → body 区域', () => {
    const { doc, pool, p1 } = makeFooterDoc()
    // 将 p1 移入 body
    doc.body.children = [p1.id]
    doc.footer = []
    const region = resolveParagraphRegion(p1.id, doc, pool)
    expect(region?.type).toBe('body')
  })
})

describe('页脚段落 Enter 拆段 (SplitParagraphCommand)', () => {
  it('页脚段落中点拆分 → 新段落插入 doc.footer, 不泄漏到 body', () => {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const tn = createTextNode('HelloWorld')
    const p1 = createParagraph([tn.id])
    allNodes.set(tn.id, tn as unknown as BaseNode)
    allNodes.set(p1.id, p1 as unknown as BaseNode)
    doc.body.children = []
    doc.header = []
    doc.footer = [p1.id]
    const pool = buildNodePool(allNodes, { body: doc.id })

    const cmd = new SplitParagraphCommand('sp', Date.now(), 'u', [doc.id, p1.id], 5)
    const patch = cmd.forward(ctxOf(doc, pool))

    expect(patch).not.toBeNull()
    // 新段落仍在 footer 中
    expect(doc.footer).toHaveLength(2)
    expect(doc.body.children).toHaveLength(0)
    // 左半 "Hello" 留在原段, 右半 "World" 进入新段
    expect(paraText(pool, doc.footer[0])).toBe('Hello')
    expect(paraText(pool, doc.footer[1])).toBe('World')
  })
})

describe('页脚段落 Backspace 并段 (MergeParagraphCommand)', () => {
  it('页脚两段并段 → 文字保留, 段落数减一', () => {
    const { doc, pool, p1, p2 } = makeFooterDoc()

    const cmd = new MergeParagraphCommand('mg', Date.now(), 'u', [doc.id, p2.id])
    const patch = cmd.forward(ctxOf(doc, pool))

    expect(patch).not.toBeNull()
    // 只剩一段, 且不泄漏到 body
    expect(doc.footer).toHaveLength(1)
    expect(doc.body.children).toHaveLength(0)
    // 文字完整合并 (关键: 不被 removeChild 误删)
    expect(paraText(pool, p1.id)).toBe('HelloWorld')
    // p2 已从池中移除
    expect(pool.nodes.get(p2.id)).toBeUndefined()
  })

  it('页脚首段并段 → 无上一段, 静默返回 null (不误删)', () => {
    const { doc, pool, p1 } = makeFooterDoc()
    const cmd = new MergeParagraphCommand('mg', Date.now(), 'u', [doc.id, p1.id])
    const patch = cmd.forward(ctxOf(doc, pool))

    expect(patch).toBeNull()
    // 结构不变
    expect(doc.footer).toHaveLength(2)
    expect(paraText(pool, p1.id)).toBe('Hello')
  })
})

describe('正文并段回归 (文字不丢失)', () => {
  it('正文两段并段 → 第二段文字保留', () => {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const t1 = createTextNode('Hello')
    const p1 = createParagraph([t1.id])
    const t2 = createTextNode('World')
    const p2 = createParagraph([t2.id])
    allNodes.set(t1.id, t1 as unknown as BaseNode)
    allNodes.set(p1.id, p1 as unknown as BaseNode)
    allNodes.set(t2.id, t2 as unknown as BaseNode)
    allNodes.set(p2.id, p2 as unknown as BaseNode)
    doc.body.children = [p1.id, p2.id]
    const pool = buildNodePool(allNodes, { body: doc.id })

    const cmd = new MergeParagraphCommand('mg', Date.now(), 'u', [doc.id, p2.id])
    cmd.forward(ctxOf(doc, pool))

    expect(doc.body.children).toHaveLength(1)
    expect(paraText(pool, p1.id)).toBe('HelloWorld')
  })
})

function textPara(text: string): SerializedPara {
  return { type: 'paragraph', id: 'src', style: {}, children: [{ type: 'text', id: 'src-t', text }] }
}

describe('页脚多段落粘贴 (InsertNodesCommand)', () => {
  it('两段粘贴到页脚段落末尾 → 均落在 doc.footer, 不泄漏到 body', () => {
    const { doc, pool, p1 } = makeFooterDoc()  // footer = [p1("Hello"), p2("World")]

    const cmd = new InsertNodesCommand('ins', Date.now(), 'u', [doc.id, p1.id], 5, [
      textPara('AA'), textPara('BB'),
    ])
    cmd.forward(ctxOf(doc, pool))

    const footer = doc.footer!
    expect(footer).toHaveLength(3)
    expect(doc.body.children).toHaveLength(0)
    expect(paraText(pool, footer[0])).toBe('HelloAA')
    expect(paraText(pool, footer[1])).toBe('BB')
    expect(paraText(pool, footer[2])).toBe('World')
  })

  it('页脚粘贴撤销 → 恢复原页脚结构', () => {
    const { doc, pool, p1 } = makeFooterDoc()

    const cmd = new InsertNodesCommand('ins', Date.now(), 'u', [doc.id, p1.id], 5, [
      textPara('AA'), textPara('BB'),
    ])
    cmd.forward(ctxOf(doc, pool))
    expect(doc.footer).toHaveLength(3)

    const undo = cmd.invert(ctxOf(doc, pool))
    expect(undo).not.toBeNull()
    undo!.forward(ctxOf(doc, pool))

    const footer = doc.footer!
    expect(footer).toHaveLength(2)
    expect(doc.body.children).toHaveLength(0)
    expect(paraText(pool, footer[0])).toBe('Hello')
    expect(paraText(pool, footer[1])).toBe('World')
  })
})
