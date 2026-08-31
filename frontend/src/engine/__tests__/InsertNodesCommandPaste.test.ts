// ============================================================
// InsertNodesCommand — 粘贴就地拼接 (v4)
//
// 复现并防止: 粘贴单行文本时产生多余换行/新段落。
// 正确语义:
//   - 单段落粘贴 = 就地追加/拼接, 不产生新段落
//   - 多段落粘贴 = 首段并入左半, 末段与右半合并
//   - 撤销正确恢复原段落 (含 smarttext 等右半子节点)
// ============================================================

import { describe, it, expect } from 'vitest'
import { InsertNodesCommand } from '../command/commands/InsertNodesCommand'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode, createSmartTextNode,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree, ElementMeta } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'
import type { CommandContext } from '../command/ICommand'
import type { SerializedPara } from '../command/ClipboardManager'

const ELEMENT: ElementMeta = {
  code: { internal: 'CTL_PATIENT_NAME', dataElement: 'DE02.01.039.00' },
  name: '患者姓名',
}

/** 把任意文本序列化为粘贴数据 (单段落) */
function textPara(text: string): SerializedPara {
  return {
    type: 'paragraph', id: 'src', style: {},
    children: [{ type: 'text', id: 'src-t', text }],
  }
}

/** 构造单段落文本文档 */
function makeTextDoc(initialText: string): { doc: DocumentTree; pool: NodePool; paraId: string } {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const tn = createTextNode(initialText)
  const para = createParagraph([tn.id])
  allNodes.set(tn.id, tn as unknown as BaseNode)
  allNodes.set(para.id, para as unknown as BaseNode)
  doc.body.children = [para.id]
  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool, paraId: para.id }
}

function ctxOf(doc: DocumentTree, pool: NodePool): CommandContext {
  return { mode: 'local', doc, pool }
}

function paraText(pool: NodePool, paraId: string): string {
  const para = pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
  if (!para?.children) return ''
  return para.children.map(cid => {
    const n = pool.nodes.get(cid) as { text?: string } | undefined
    return n?.text || ''
  }).join('')
}

function bodyText(doc: DocumentTree, pool: NodePool): string[] {
  return doc.body.children.map(pid => paraText(pool, pid))
}

describe('InsertNodesCommand 单段落粘贴 (就地拼接)', () => {
  it('粘贴到段尾 → 追加, 不产生新段落', () => {
    const { doc, pool, paraId } = makeTextDoc('AAA')
    const cmd = new InsertNodesCommand('c1', Date.now(), 'u', [doc.id, paraId], 3, [textPara('BBB')])
    cmd.forward(ctxOf(doc, pool))

    expect(doc.body.children).toHaveLength(1)
    expect(paraText(pool, paraId)).toBe('AAABBB')
  })

  it('粘贴到段中 → 就地拼接 (左右环绕)', () => {
    const { doc, pool, paraId } = makeTextDoc('AAA')
    const cmd = new InsertNodesCommand('c1', Date.now(), 'u', [doc.id, paraId], 1, [textPara('BBB')])
    cmd.forward(ctxOf(doc, pool))

    expect(doc.body.children).toHaveLength(1)
    expect(paraText(pool, paraId)).toBe('ABBBAA')
  })

  it('粘贴到段首 → 拼接', () => {
    const { doc, pool, paraId } = makeTextDoc('AAA')
    const cmd = new InsertNodesCommand('c1', Date.now(), 'u', [doc.id, paraId], 0, [textPara('BBB')])
    cmd.forward(ctxOf(doc, pool))

    expect(doc.body.children).toHaveLength(1)
    expect(paraText(pool, paraId)).toBe('BBBAAA')
  })
})

describe('InsertNodesCommand 多段落粘贴 (首末合并)', () => {
  it('两段粘贴到段尾 → 首段并入左半, 末段独立', () => {
    const { doc, pool, paraId } = makeTextDoc('AAA')
    const cmd = new InsertNodesCommand('c1', Date.now(), 'u', [doc.id, paraId], 3, [
      textPara('BBB'), textPara('CCC'),
    ])
    cmd.forward(ctxOf(doc, pool))

    expect(bodyText(doc, pool)).toEqual(['AAABBB', 'CCC'])
  })

  it('两段粘贴到段中 → 首末分别环绕左右', () => {
    const { doc, pool, paraId } = makeTextDoc('AAA')
    const cmd = new InsertNodesCommand('c1', Date.now(), 'u', [doc.id, paraId], 1, [
      textPara('BBB'), textPara('CCC'),
    ])
    cmd.forward(ctxOf(doc, pool))

    expect(bodyText(doc, pool)).toEqual(['ABBB', 'CCCAA'])
  })
})

describe('InsertNodesCommand 粘贴到 smarttext 前 (右半子节点处理)', () => {
  function makeSmartDoc() {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const t1 = createTextNode('AB')
    const st = createSmartTextNode('张', ELEMENT)
    const t2 = createTextNode('CD')
    const para = createParagraph([t1.id, st.id, t2.id])
    allNodes.set(t1.id, t1 as unknown as BaseNode)
    allNodes.set(st.id, st as unknown as BaseNode)
    allNodes.set(t2.id, t2 as unknown as BaseNode)
    allNodes.set(para.id, para as unknown as BaseNode)
    doc.body.children = [para.id]
    const pool = buildNodePool(allNodes, { body: doc.id })
    return { doc, pool, paraId: para.id }
  }

  it('单段粘贴到 smarttext 前 → smarttext 保持原位', () => {
    const { doc, pool, paraId } = makeSmartDoc()
    // offset 2 = "AB" 之后, smarttext 之前
    const cmd = new InsertNodesCommand('c1', Date.now(), 'u', [doc.id, paraId], 2, [textPara('X')])
    cmd.forward(ctxOf(doc, pool))

    expect(doc.body.children).toHaveLength(1)
    expect(paraText(pool, paraId)).toBe('ABX张CD')
  })

  it('两段粘贴到 smarttext 前 → 右半 (smarttext+CD) 落到末段', () => {
    const { doc, pool, paraId } = makeSmartDoc()
    const cmd = new InsertNodesCommand('c1', Date.now(), 'u', [doc.id, paraId], 2, [
      textPara('X'), textPara('Y'),
    ])
    cmd.forward(ctxOf(doc, pool))

    expect(bodyText(doc, pool)).toEqual(['ABX', 'Y张CD'])
  })
})

describe('InsertNodesCommand 撤销', () => {
  it('单段粘贴撤销 → 恢复原段落', () => {
    const { doc, pool, paraId } = makeTextDoc('AAA')
    const cmd = new InsertNodesCommand('c1', Date.now(), 'u', [doc.id, paraId], 3, [textPara('BBB')])
    cmd.forward(ctxOf(doc, pool))
    expect(paraText(pool, paraId)).toBe('AAABBB')

    const undo = cmd.invert(ctxOf(doc, pool))
    expect(undo).not.toBeNull()
    undo!.forward(ctxOf(doc, pool))

    expect(doc.body.children).toHaveLength(1)
    expect(paraText(pool, paraId)).toBe('AAA')
  })

  it('多段粘贴到 smarttext 前撤销 → 恢复原 smarttext 段落', () => {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const t1 = createTextNode('AB')
    const st = createSmartTextNode('张', ELEMENT)
    const t2 = createTextNode('CD')
    const para = createParagraph([t1.id, st.id, t2.id])
    allNodes.set(t1.id, t1 as unknown as BaseNode)
    allNodes.set(st.id, st as unknown as BaseNode)
    allNodes.set(t2.id, t2 as unknown as BaseNode)
    allNodes.set(para.id, para as unknown as BaseNode)
    doc.body.children = [para.id]
    const pool = buildNodePool(allNodes, { body: doc.id })

    const cmd = new InsertNodesCommand('c1', Date.now(), 'u', [doc.id, para.id], 2, [
      textPara('X'), textPara('Y'),
    ])
    cmd.forward(ctxOf(doc, pool))
    expect(bodyText(doc, pool)).toEqual(['ABX', 'Y张CD'])

    const undo = cmd.invert(ctxOf(doc, pool))
    expect(undo).not.toBeNull()
    undo!.forward(ctxOf(doc, pool))

    expect(doc.body.children).toHaveLength(1)
    expect(paraText(pool, para.id)).toBe('AB张CD')
  })
})
