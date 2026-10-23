// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// SelectionConsistency — 复制 / 删除的三条路径必须对同一选区给出同一答案
//
// 背景 (功能清单 🟡「剪贴板跨段落复制」): 「段落读序 + 逐段 offset 裁剪」
// 曾在 ClipboardManager、Draw.renderSelectionUnified、Editor.deleteSelectedRange、
// KeyboardHandler.deleteSelection 里各写一遍。副本的代价是行为分叉:
//   - 键盘删除曾是 Editor 版本的复制品且没有事务包装 → 跨段删除 N 步撤销;
//   - 复制对空选区会写入空段落, 覆盖用户已有剪贴板。
// 现在复制/渲染/删除的范围都来自 SelectionCollector 的
// `selectionSpine + collectSelectionSegments` (契约 §31.3 W3-SELECTION)。
//
// 本文件锁住用户可见的不变量:
//   复制出的文本 == 删除会移除的文本; 删除后的残留 == 首段前缀 + 末段后缀。
//
// 2026-10-20 产品裁决: 删除与复制/高亮使用**同一条**展平读序。body↔cell、
// 跨 cell 都是线性文本范围; 块结构 (表格/块级图) 不进删除范围, 但其中的
// cell 文字会被删除。合并只在同容器相邻段落之间发生, 不跨块边界。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import {
  createDocument, createParagraph, createTextNode, createImageNode,
  createTable, createTableRow, createTableCell,
} from '../document/factory/ElementFormatter'
import { ClipboardManager } from '../command/ClipboardManager'
import type { ClipboardHost } from '../host/EditorHost'
import type { BaseNode, DocumentTree, Paragraph, TextNode } from '../document/core/DocumentModel'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

// ---- 夹具 ----

interface Fixture {
  editor: Editor
  doc: DocumentTree
  p: Record<string, string>
  headerPara: string
  cellPara: string
  imageId: string
}

/**
 * body: 前 / 甲乙丙丁 / 空段 / 戊己庚辛 / 壬癸[img]子丑 / 表格(格内)
 * header(default): 页眉文字
 */
function makeFixture(): Fixture {
  const doc = createDocument('选区一致性')
  const nodes: Record<string, BaseNode> = {}
  nodes[doc.id] = doc as unknown as BaseNode
  const add = <T extends { id: string }>(n: T): T => {
    nodes[n.id] = n as unknown as BaseNode
    return n
  }
  const mkPara = (children: string[]): Paragraph => {
    const p = add(createParagraph(children) as Paragraph)
    doc.body.children.push(p.id)
    return p
  }

  const t0 = add(createTextNode('前'))
  const p0 = mkPara([t0.id])
  const t1 = add(createTextNode('甲乙丙丁'))
  const p1 = mkPara([t1.id])
  const p2 = mkPara([])
  const t3 = add(createTextNode('戊己庚辛'))
  const p3 = mkPara([t3.id])
  const t4a = add(createTextNode('壬癸'))
  const img = add(createImageNode('img-key', 40, 20, 'inline'))
  const t4b = add(createTextNode('子丑'))
  const p4 = mkPara([t4a.id, img.id, t4b.id])

  // 1×1 表格 (cell 内一段)
  const cellText = add(createTextNode('格内'))
  const cellInner = add(createParagraph([cellText.id]) as Paragraph)
  const cell = add(createTableCell([cellInner.id]))
  const row = add(createTableRow([cell]))
  const table = add(createTable([{ width: 100 }]))
  table.children = [row.id]
  doc.body.children.push(table.id)

  // 表格之后的一段 —— 用于覆盖「选区跨表格」的展平读序
  const t5 = add(createTextNode('表后'))
  const p5 = mkPara([t5.id])

  // header(default)
  const ht = add(createTextNode('页眉文字'))
  const hp = add(createParagraph([ht.id]) as Paragraph)
  doc.header = [hp.id]

  ;(doc as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = nodes

  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  editor.setDocument(doc)
  cleanups.push(() => { editor.destroy(); container.remove() })

  return {
    editor, doc,
    p: { p0: p0.id, p1: p1.id, p2: p2.id, p3: p3.id, p4: p4.id, p5: p5.id },
    headerPara: hp.id,
    cellPara: cellInner.id,
    imageId: img.id,
  }
}

function select(f: Fixture, anchorId: string, anchorOff: number, focusId: string, focusOff: number): void {
  const docId = f.doc.id
  f.editor.getStore().setSelection({
    anchor: { paragraphPath: [docId, anchorId], offset: anchorOff, visible: false },
    focus: { paragraphPath: [docId, focusId], offset: focusOff, visible: false },
    active: true,
    granularity: 'character',
  })
}

const noopClipboard: ClipboardHost = {
  writeText: () => Promise.resolve(),
  readText: () => Promise.reject(new Error('no read')),
  canRead: () => false,
}

/** 复制当前选区 (用实时文档/池, 与 Editor.copy 同一入口的底层实现) */
function copyText(f: Fixture): string {
  const sel = f.editor.getStore().state.runtime.selection
  const mgr = new ClipboardManager(noopClipboard)
  mgr.copy(
    sel.anchor.paragraphPath, sel.anchor.offset,
    sel.focus.paragraphPath, sel.focus.offset,
    f.editor.getDocument(), f.editor.getPool(),
  )
  return mgr.getPlainText() ?? '<null>'
}

function paraText(f: Fixture, paraId: string): string {
  const pool = f.editor.getPool()
  const para = pool.nodes.get(paraId) as Paragraph | undefined
  if (!para) return '<missing>'
  let text = ''
  for (const cid of para.children) {
    const n = pool.nodes.get(cid) as TextNode | undefined
    if (n?.type === 'text') text += n.text ?? ''
  }
  return text
}

function bodyParaIds(f: Fixture): string[] {
  const pool = f.editor.getPool()
  return [...f.editor.getDocument().body.children].filter((id) => {
    const n = pool.nodes.get(id) as { type?: string } | undefined
    return n?.type === 'paragraph'
  })
}

// ================================================================
// 复制 == 删除的内容, 残留 == 首段前缀 + 末段后缀
// ================================================================

describe('选区一致性 — 复制与删除共用同一范围实现', () => {
  it('跨段选区 (含空段): 复制文本 = 被删文本, 残留 = 首段前缀 + 末段后缀, 一次 undo 还原', () => {
    const f = makeFixture()
    select(f, f.p.p1, 1, f.p.p3, 2)

    expect(copyText(f)).toBe('乙丙丁\n\n戊己')

    expect(f.editor.deleteSelection()).toBe(true)

    // 前 / 甲+庚辛(合并) / 壬癸子丑 / 表后
    expect(bodyParaIds(f).map((id) => paraText(f, id))).toEqual(['前', '甲庚辛', '壬癸子丑', '表后'])
    // 表格仍在 (删除只作用在文本容器上)
    expect(f.editor.getDocument().body.children.length).toBe(5)

    // 键盘/右键同一入口: 整次删除一个 undo 单元
    expect(f.editor.getStore().state.runtime.history.undoDepth).toBe(1)
    f.editor.undo()
    expect(bodyParaIds(f).map((id) => paraText(f, id)))
      .toEqual(['前', '甲乙丙丁', '', '戊己庚辛', '壬癸子丑', '表后'])
  })

  it('反向选区 (anchor 在后) 与正向结果完全相同', () => {
    const f = makeFixture()
    select(f, f.p.p3, 2, f.p.p1, 1)

    expect(copyText(f)).toBe('乙丙丁\n\n戊己')
    expect(f.editor.deleteSelection()).toBe(true)
    expect(bodyParaIds(f).map((id) => paraText(f, id))).toEqual(['前', '甲庚辛', '壬癸子丑', '表后'])
  })

  it('选中行内图片: 复制只带走图片, 删除移除该原子节点', () => {
    const f = makeFixture()
    select(f, f.p.p4, 2, f.p.p4, 3)

    expect(copyText(f)).toBe('')

    expect(f.editor.deleteSelection()).toBe(true)
    expect(paraText(f, f.p.p4)).toBe('壬癸子丑')
    const pool = f.editor.getPool()
    const para = pool.nodes.get(f.p.p4) as Paragraph
    expect(para.children.includes(f.imageId)).toBe(false)
  })

  it('页眉选区: 复制与删除都在同一变体内完成', () => {
    const f = makeFixture()
    select(f, f.headerPara, 1, f.headerPara, 3)

    expect(copyText(f)).toBe('眉文')
    expect(f.editor.deleteSelection()).toBe(true)
    expect(paraText(f, f.headerPara)).toBe('页字')
  })

  it('空选区: 复制不覆盖已有剪贴板 (不再写入空段落)', () => {
    const f = makeFixture()
    const mgr = new ClipboardManager(noopClipboard)
    f.editor.getStore().setSelection({
      anchor: { paragraphPath: [f.doc.id, f.p.p1], offset: 2, visible: false },
      focus: { paragraphPath: [f.doc.id, f.p.p1], offset: 2, visible: false },
      active: true,
      granularity: 'character',
    })
    mgr.copy(
      [f.doc.id, f.p.p1], 2, [f.doc.id, f.p.p1], 2,
      f.editor.getDocument(), f.editor.getPool(),
    )
    expect(mgr.getPlainText()).toBeNull()
  })

  it('body↔cell 选区: 复制与删除同一读序, cell 文字被删且表格结构保留', () => {
    const f = makeFixture()
    select(f, f.p.p4, 0, f.cellPara, 2)

    expect(copyText(f)).toBe('壬癸子丑\n格内')
    expect(f.editor.deleteSelection()).toBe(true)

    // p4: 文字与行内图都被删空; cell: 文字被删空
    expect(paraText(f, f.p.p4)).toBe('')
    expect(paraText(f, f.cellPara)).toBe('')
    // p4 的合并对象是 cell (无前驱) → p4 保留; 结构 (表格) 不变
    expect(bodyParaIds(f).map((id) => paraText(f, id)))
      .toEqual(['前', '甲乙丙丁', '', '戊己庚辛', '', '表后'])
    expect(f.editor.getDocument().body.children.length).toBe(7)

    f.editor.undo()
    expect(paraText(f, f.p.p4)).toBe('壬癸子丑')
    expect(paraText(f, f.cellPara)).toBe('格内')
  })

  it('跨表格选区: 展平读序删除 cell 文字, 表格保留, 合并止于块边界', () => {
    const f = makeFixture()
    select(f, f.p.p3, 2, f.p.p5, 1)

    expect(copyText(f)).toBe('庚辛\n壬癸子丑\n格内\n表')
    expect(f.editor.deleteSelection()).toBe(true)

    // p4 与 p3 同容器相邻 → 并入 p3; p5 的前驱是表格 → 不合并
    expect(bodyParaIds(f).map((id) => paraText(f, id)))
      .toEqual(['前', '甲乙丙丁', '', '戊己', '后'])
    expect(paraText(f, f.cellPara)).toBe('')
    expect(f.editor.getPool().nodes.has(f.p.p4)).toBe(false)
    // body = 前/甲乙丙丁/空段/戊己/表格/后
    expect(f.editor.getDocument().body.children.length).toBe(6)
  })
})
