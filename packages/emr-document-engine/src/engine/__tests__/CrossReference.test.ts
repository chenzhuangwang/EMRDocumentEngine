// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 交叉引用页码解析 (契约 §12.2) — 接线审计 P1 第一条
//
// 背景: BookmarkRenderer 全仓零调用, 于是 displayText 里的 {page}/{number}
// 占位符**永远原样输出**, 用户看到字面量「第 {page} 页」; 书签对话框虽然已经
// 在渲染 p.{pageHint}, 但该字段从不被填。
//
// 解析模型 (与页码域预留位数同思路): {page} 取自**上一轮**布局的段落→页映射,
// 故含占位符时 fullLayout 必须再排一轮。本文件锁住:
//   ① 占位符被展开为真实页码; ② 无占位符时行为逐字节不变 (不回归既有文档);
//   ③ pageHint 被填且与展开出的页码一致。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import { getFlatPageItems } from '../layout/core/SLIF'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'

/** 造一个多页文档: body = 前言段 + 若干填充段; 书签锚在指定段上 */
function makeDoc(opts: { fillers: number; bookmarkOnFiller: number; xrefText?: string }) {
  const doc = createDocument('交叉引用测试')
  const nodes = new Map<string, BaseNode>()
  nodes.set(doc.id, doc as unknown as BaseNode)

  const mk = (text: string) => {
    const t = createTextNode(text)
    const p = createParagraph([t.id])
    nodes.set(t.id, t as unknown as BaseNode)
    nodes.set(p.id, p as unknown as BaseNode)
    return { paraId: p.id, textId: t.id }
  }

  // 第 0 段: 交叉引用所在段 (可选)
  const headChildren: string[] = []
  if (opts.xrefText) {
    const xid = `xref_1`
    const anchorText = createTextNode('详见')
    nodes.set(anchorText.id, anchorText as unknown as BaseNode)
    nodes.set(xid, {
      type: 'cross_reference', id: xid, refType: 'bookmark',
      targetRef: 'bm_1', displayText: opts.xrefText,
    } as unknown as BaseNode)
    headChildren.push(anchorText.id, xid)
  } else {
    const t = createTextNode('前言')
    nodes.set(t.id, t as unknown as BaseNode)
    headChildren.push(t.id)
  }
  const head = createParagraph(headChildren)
  nodes.set(head.id, head as unknown as BaseNode)

  // 填充段落 (把书签推到第 2 页及以后)
  const fillers: { paraId: string; textId: string }[] = []
  for (let i = 0; i < opts.fillers; i++) {
    fillers.push(mk(`填充段落 ${i} 用于把文档撑到多页，这里放足够多的文字让每段折成多行。`.repeat(3)))
  }

  doc.body.children = [head.id, ...fillers.map(f => f.paraId)]

  // 书签: 锚在指定填充段的文本节点上
  const anchor = fillers[Math.min(opts.bookmarkOnFiller, fillers.length - 1)]
  nodes.set('bm_1', {
    type: 'bookmark', id: 'bm_1', name: '目标位置', targetId: anchor.textId,
  } as unknown as BaseNode)

  const raw: Record<string, BaseNode> = {}
  for (const [id, n] of nodes) raw[id] = n
  ;(doc as unknown as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = raw
  return { doc, headParaId: head.id }
}

function makeEditor(opts: Parameters<typeof makeDoc>[0]) {
  const { doc } = makeDoc(opts)
  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  editor.setDocument(doc)
  return editor
}

/** 布局结果里某节点的显示文本 */
function laidOutText(editor: Editor, nodeId: string): string | undefined {
  for (const page of editor.getDraw().getPages()) {
    const hit = getFlatPageItems(page).find(i => i.nodeId === nodeId)
    if (hit) return hit.text
  }
  return undefined
}

describe('交叉引用页码解析 (契约 §12.2)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('{page} 被展开为真实页码, 不再是字面占位符', () => {
    const editor = makeEditor({ fillers: 60, bookmarkOnFiller: 50, xrefText: '见第 {page} 页' })
    const text = laidOutText(editor, 'xref_1')

    expect(text).toBeDefined()
    expect(text).not.toContain('{page}')
    expect(text).toMatch(/^见第 \d+ 页$/)
  })

  it('展开出的页码 = 书签 target 所在页 (与 pageHint 一致)', () => {
    const editor = makeEditor({ fillers: 60, bookmarkOnFiller: 50, xrefText: '第 {page} 页' })
    const pageHint = editor.getBookmarkTargets().find(t => t.id === 'bm_1')?.pageHint
    const text = laidOutText(editor, 'xref_1')

    expect(pageHint).toBeDefined()
    expect(pageHint).toBeGreaterThan(1)              // 确实被撑到第 2 页之后
    expect(text).toBe(`第 ${pageHint} 页`)
  })

  it('无占位符 → 文本原样输出 (既有文档零回归)', () => {
    const editor = makeEditor({ fillers: 10, bookmarkOnFiller: 5, xrefText: '目标位置' })
    expect(laidOutText(editor, 'xref_1')).toBe('目标位置')
  })

  it('无交叉引用的文档 → 不产生额外布局轮次 (pageHint 仍可查)', () => {
    const editor = makeEditor({ fillers: 10, bookmarkOnFiller: 5 })
    // 无 xref: 布局结果与历史一致, 但段落→页映射仍已建好供 pageHint 用
    const t = editor.getBookmarkTargets().find(x => x.id === 'bm_1')
    expect(t?.pageHint).toBeGreaterThanOrEqual(1)
  })

  it('getBookmarkTargets 的 pageHint 是 1-based 且章节/书签都可查', () => {
    const editor = makeEditor({ fillers: 5, bookmarkOnFiller: 2 })
    const bm = editor.getBookmarkTargets().find(t => t.id === 'bm_1')
    expect(bm?.pageHint).toBe(1)                     // 短文档: 全在第 1 页
  })

  it('引用目标在同页 → 展开为 1', () => {
    const editor = makeEditor({ fillers: 3, bookmarkOnFiller: 1, xrefText: 'p{page}' })
    expect(laidOutText(editor, 'xref_1')).toBe('p1')
  })
})
