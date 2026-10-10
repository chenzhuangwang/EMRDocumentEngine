// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// InsertInlineNodeCommand — 内联节点必须落在**光标偏移**处
//
// 回归: forward 原先只取 resolveCharOffset 的 textNodeId 并在其后插入
// (idx + 1), 完全丢弃 localOffset → 光标落在长文本中间时, 域代码/书签/图片
// 一律被丢到该文本节点**末尾** ("插入不到光标位置")。
// 另: 目标为内联非文本节点时 localOffset 语义为 0=前/1=后, 原实现恒插到"后",
// 无法插到既有控件之前。
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode, createFieldNode, createImageNode,
} from '../document/factory/ElementFormatter'
import { InsertInlineNodeCommand } from '../command/commands/StructuralCommands'
import { InsertTextCommand } from '../command/commands/InsertTextCommand'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import type { BaseNode, DocumentTree, TextNode } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'
import type { CommandContext } from '../command/ICommand'

interface Built {
  doc: DocumentTree
  pool: NodePool
  paraId: string
  /** para.children 的紧凑可读形式 */
  shape: () => string[]
  /** 段落纯文本 (text 子节点拼接) */
  text: () => string
}

/** body + footer 共用同一段落 (验证区域无关); children 由调用方给出 */
function build(childrenOf: (mk: (text: string) => string) => string[]): Built {
  const doc = createDocument('inline-insert')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)

  const mk = (text: string): string => {
    const tn = createTextNode(text)
    all.set(tn.id, tn as unknown as BaseNode)
    return tn.id
  }
  const children = childrenOf(mk)
  const para = createParagraph(children)
  all.set(para.id, para as unknown as BaseNode)

  doc.body.children = [para.id]
  doc.footer = [para.id]
  const pool = buildNodePool(all, { body: doc.id, footer: doc.footer })

  return {
    doc, pool, paraId: para.id,
    shape: () => {
      const p = pool.nodes.get(para.id) as unknown as { children: string[] }
      return p.children.map(cid => {
        const n = pool.nodes.get(cid) as unknown as { type?: string; text?: string; fieldType?: string }
        return n?.type === 'text' ? `text(${n.text})` : `${n?.type}(${n?.fieldType ?? ''})`
      })
    },
    text: () => {
      const p = pool.nodes.get(para.id) as unknown as { children: string[] }
      return p.children
        .map(cid => {
          const n = pool.nodes.get(cid) as unknown as { type?: string; text?: string }
          return n?.type === 'text' ? (n.text || '') : ''
        })
        .join('')
    },
  }
}

function ctxOf(doc: DocumentTree, pool: NodePool): CommandContext {
  return { mode: 'local', doc, pool }
}

function insertFieldAt(b: Built, offset: number, fieldType: 'page_number' | 'total_pages' = 'page_number') {
  const cmd = new InsertInlineNodeCommand('c', Date.now(), 'u', [b.doc.id, b.paraId], offset, () => createFieldNode(fieldType))
  cmd.forward(ctxOf(b.doc, b.pool))
  return cmd
}

describe('InsertInlineNodeCommand — 文本中间插入', () => {
  it('光标在文本中间 → 拆分文本, 内联节点落于光标处', () => {
    const b = build(mk => [mk('当前在第页，总页')])
    insertFieldAt(b, 4) // "当前在第|页，总页"
    expect(b.shape()).toEqual(['text(当前在第)', 'field(page_number)', 'text(页，总页)'])
  })

  it('光标在段落起始 (offset 0) → 插到文本之前, 不产生空文本节点', () => {
    const b = build(mk => [mk('末尾')])
    insertFieldAt(b, 0)
    expect(b.shape()).toEqual(['field(page_number)', 'text(末尾)'])
  })

  it('光标在段落末尾 → 插到文本之后', () => {
    const b = build(mk => [mk('开头')])
    insertFieldAt(b, 2)
    expect(b.shape()).toEqual(['text(开头)', 'field(page_number)'])
  })

  it('段落为空 → 直接插入', () => {
    const b = build(() => [])
    insertFieldAt(b, 0)
    expect(b.shape()).toEqual(['field(page_number)'])
  })

  it('偏移落在第二个文本节点中间 → 在正确节点内拆分 (跨节点偏移累加)', () => {
    const b = build(mk => [mk('abc'), mk('defg')])
    insertFieldAt(b, 5) // abc(3) + "de"(2) → 落在第二个节点内
    // 拆出的左半 "de" 与前一节点 "abc" 同款式且相邻 → normalizeParagraph 合并为
    // "abcde"; 内联节点位于纯文本偏移 5 处, 语义与拆分等价。
    expect(b.shape()).toEqual(['text(abcde)', 'field(page_number)', 'text(fg)'])
    expect(b.text()).toBe('abcdefg')
  })

  it('偏移恰好落在第一个文本节点末尾 → 插到两节点之间 (不拆第二个)', () => {
    const b = build(mk => [mk('abc'), mk('defg')])
    insertFieldAt(b, 3)
    expect(b.shape()).toEqual(['text(abc)', 'field(page_number)', 'text(defg)'])
  })
})

describe('InsertInlineNodeCommand — 相对既有内联节点定位', () => {
  it('光标在既有内联节点之前 (localOffset 0) → 插到它**之前**', () => {
    const b = build(mk => [mk('ab')])
    // 先放一个图片在末尾, 再把域插到 "ab" 之后 / 图片之前 → 即 offset 2
    const p = b.pool.nodes.get(b.paraId) as unknown as { children: string[] }
    const img = createImageNode('k', 10, 10)
    b.pool.addNode(img as unknown as BaseNode)
    b.pool.insertChild(b.paraId, img.id, p.children.length)

    insertFieldAt(b, 2)
    expect(b.shape()).toEqual(['text(ab)', 'field(page_number)', 'image()'])
  })

  it('光标在既有内联节点之后 → 插到它之后', () => {
    const b = build(mk => [mk('ab')])
    const p = b.pool.nodes.get(b.paraId) as unknown as { children: string[] }
    const img = createImageNode('k', 10, 10)
    b.pool.addNode(img as unknown as BaseNode)
    b.pool.insertChild(b.paraId, img.id, p.children.length)

    insertFieldAt(b, 3) // text(2 字符) + image(1 原子)
    expect(b.shape()).toEqual(['text(ab)', 'image()', 'field(page_number)'])
  })
})

describe('InsertInlineNodeCommand — 页眉/页脚区域同样生效', () => {
  it('页脚段落中间插入域 → 位置正确 (区域无关)', () => {
    const b = build(mk => [mk('第页')])
    // 该段落同时是 body 与 footer 成员; 命令只按 paragraphPath 定位, 与容器无关
    insertFieldAt(b, 1) // "第|页"
    expect(b.shape()).toEqual(['text(第)', 'field(page_number)', 'text(页)'])
  })
})

describe('InsertInlineNodeCommand — 撤销恢复原文', () => {
  it('插入后可撤销, 段落文本恢复 (拆分不丢字)', () => {
    const b = build(mk => [mk('当前在第页，总页')])
    const before = b.text()
    const cmd = insertFieldAt(b, 4)
    expect(b.text()).toBe(before) // 拆分不改变纯文本

    const undo = cmd.invert(ctxOf(b.doc, b.pool))
    expect(undo).not.toBeNull()
    undo!.forward(ctxOf(b.doc, b.pool))

    expect(b.text()).toBe(before)
    // 内联节点已移除
    expect(b.shape().some(s => s.startsWith('field'))).toBe(false)
  })

  it('撤销后重做 → 仍在光标处 (offset 语义稳定)', () => {
    const b = build(mk => [mk('当前在第页，总页')])
    const before = b.text()

    let cmd: InsertInlineNodeCommand | null = insertFieldAt(b, 4)
    let undo = cmd.invert(ctxOf(b.doc, b.pool))!
    undo.forward(ctxOf(b.doc, b.pool))
    expect(b.text()).toBe(before)

    // 重做 = 再次 forward 同一条命令
    cmd.forward(ctxOf(b.doc, b.pool))
    expect(b.shape()).toEqual(['text(当前在第)', 'field(page_number)', 'text(页，总页)'])
  })
})

describe('InsertInlineNodeCommand — 样式继承', () => {
  it('拆出的右半继承原文本样式', () => {
    const b = build(mk => [mk('粗体文字')])
    const p = b.pool.nodes.get(b.paraId) as unknown as { children: string[] }
    const first = b.pool.nodes.get(p.children[0]) as unknown as TextNode
    b.pool.updateNode(first.id, { bold: true } as Partial<TextNode>)

    insertFieldAt(b, 2)
    const rightId = (b.pool.nodes.get(b.paraId) as unknown as { children: string[] }).children[2]
    const right = b.pool.nodes.get(rightId) as unknown as TextNode
    expect(right.text).toBe('文字')
    expect(right.bold).toBe(true)
  })
})

describe('InsertInlineNodeCommand — 光标推进到节点之后', () => {
  it('forward 返回的光标补丁为 offset+1 (内联节点 = 1 原子字符)', () => {
    const b = build(mk => [mk('abcdef')])
    const cmd = new InsertInlineNodeCommand('c', Date.now(), 'u', [b.doc.id, b.paraId], 3, () => createFieldNode('page_number'))
    const patch = cmd.forward(ctxOf(b.doc, b.pool))
    expect(patch?.cursor?.offset).toBe(4)
  })

  it('插入后再打字落在域之后 (而非域之前)', () => {
    const b = build(mk => [mk('ab')])
    const cmd = new InsertInlineNodeCommand('c', Date.now(), 'u', [b.doc.id, b.paraId], 2, () => createFieldNode('page_number'))
    const patch = cmd.forward(ctxOf(b.doc, b.pool))
    expect(b.shape()).toEqual(['text(ab)', 'field(page_number)'])

    const afterOffset = patch?.cursor?.offset ?? 2
    expect(afterOffset).toBe(3)
    // 用该偏移插入文本: 应排在域之后
    new InsertTextCommand('t', Date.now(), 'u', [b.doc.id, b.paraId], afterOffset, 'X')
      .forward(ctxOf(b.doc, b.pool))
    expect(b.shape()).toEqual(['text(ab)', 'field(page_number)', 'text(X)'])
  })
})

// ============================================================
// 端到端: Editor.insertFieldCode 落在光标处 (用户实际路径)
//
// 场景: 页脚段落 "当前在第页，总页", 光标停在 "当前在第" 之后 → 插入页码域。
// 修复前域被丢到段落末尾; 修复后应落在光标处, 且光标推进到域之后。
// ============================================================

describe('Editor.insertFieldCode — 光标处插入 (页脚端到端)', () => {
  function makeEditorWithFooter(text: string) {
    const doc = createDocument('inline-e2e')
    const nodes: Record<string, BaseNode> = {}
    nodes[doc.id] = doc as unknown as BaseNode

    const ftn = createTextNode(text)
    const fpara = createParagraph([ftn.id])
    const btn = createTextNode('正文')
    const bpara = createParagraph([btn.id])
    for (const n of [ftn, fpara, btn, bpara]) nodes[n.id] = n as unknown as BaseNode

    doc.body.children = [bpara.id]
    doc.footer = [fpara.id]
    // Editor 构造经 DocumentLoader 校验: 节点须内嵌在 doc.nodes (与其它 Editor 测试同模式)
    ;(doc as unknown as { nodes?: Record<string, BaseNode> }).nodes = nodes

    const host = createDomEditorHost()
    const container = document.createElement('div')
    document.body.appendChild(container)
    host.surface.mount(container)
    host.input.mount(container)
    const editor = new Editor(host, doc)
    return {
      editor, doc, pool: editor.getPool(), paraId: fpara.id,
      dispose: () => { editor.destroy(); container.remove() },
    }
  }

  const shapeOf = (pool: NodePool, paraId: string): string[] => {
    const p = pool.nodes.get(paraId) as unknown as { children: string[] }
    return p.children.map(cid => {
      const n = pool.nodes.get(cid) as unknown as { type?: string; text?: string; fieldType?: string }
      return n?.type === 'text' ? `text(${n.text})` : `${n?.type}(${n?.fieldType ?? ''})`
    })
  }

  it('光标在文本中间 → 域插在光标处 (不再落到段尾)', () => {
    const t = makeEditorWithFooter('当前在第页，总页')
    try {
      // 光标: "当前在第|页，总页"
      t.editor.getStore().setCursor({ paragraphPath: [t.doc.id, t.paraId], offset: 4, visible: true })
      t.editor.insertFieldCode('page_number')

      expect(shapeOf(t.pool, t.paraId)).toEqual([
        'text(当前在第)', 'field(page_number)', 'text(页，总页)',
      ])
      // 光标推进到域之后
      expect(t.editor.getStore().state.runtime.cursor.offset).toBe(5)
    } finally { t.dispose() }
  })

  it('连续插入两个域各就各位', () => {
    const t = makeEditorWithFooter('第页，总页')
    try {
      const setOffset = (o: number) =>
        t.editor.getStore().setCursor({ paragraphPath: [t.doc.id, t.paraId], offset: o, visible: true })

      setOffset(1)                       // 第|页，总页
      t.editor.insertFieldCode('page_number')
      // 光标现在在域之后 (offset 2) → "第[域]|页，总页"
      t.editor.insertFieldCode('total_pages')

      expect(shapeOf(t.pool, t.paraId)).toEqual([
        'text(第)', 'field(page_number)', 'field(total_pages)', 'text(页，总页)',
      ])
    } finally { t.dispose() }
  })
})
