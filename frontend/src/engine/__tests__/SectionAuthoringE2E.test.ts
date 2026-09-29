// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// SectionAuthoringE2E — P4 能力的真实 Editor 端到端 (契约 §31.14)
//
// 命令层测试 (SectionAuthoring.test.ts) 证明结构操作本身正确; 本文件证明
// **门面到渲染**整条链路正确: Editor → Command → NodePool → 布局 → 页面文本。
//
// 三条被特别锁死的行为:
//   1. 删到 body 空时补的段落不会让 undo 多留残渣
//   2. 节选中与文本光标互斥 ("UI 选中 A 而光标在 B" 构造不出来)
//   3. 关掉结构显示开关后, 结构操作全部照常 (可视化与能力正交)
// ============================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost, type DomEditorHost } from '../../platform/dom'
import {
  createDocument, createParagraph, createTextNode,
  createTable, createTableRow, createTableCell, createSection,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'
import { sectionsOf, sectionOf } from '../document/selection/SelectionCollector'
import { getFlatPageItems } from '../layout/core/SLIF'

const cleanups: Array<() => void> = []

interface Fixture {
  editor: Editor
  doc: DocumentTree
  p0: string
  p1: string
  sectionId: string
  tableId: string
  cellParas: [string, string]
  p2: string
}

/** body = [P0, Section{ P1, Table{C1,C2} }, P2] */
function makeEditor(): Fixture {
  const doc = createDocument('authoring e2e')
  const nodes: Record<string, BaseNode> = {}
  nodes[doc.id] = doc as unknown as BaseNode

  const mkPara = (text: string): string => {
    const tn = createTextNode(text)
    const p = createParagraph([tn.id])
    nodes[tn.id] = tn as unknown as BaseNode
    nodes[p.id] = p as unknown as BaseNode
    return p.id
  }

  const p0 = mkPara('head')
  const p1 = mkPara('in-section')
  const p2 = mkPara('tail')

  const c1 = mkPara('c-one')
  const c2 = mkPara('c-two')
  const cellA = createTableCell([c1])
  const cellB = createTableCell([c2])
  nodes[cellA.id] = cellA as unknown as BaseNode
  nodes[cellB.id] = cellB as unknown as BaseNode
  const row = createTableRow([cellA, cellB])
  nodes[row.id] = row as unknown as BaseNode
  const table = createTable([{ width: 50, mode: 'percentage' as const }, { width: 50, mode: 'percentage' as const }], [row])
  nodes[table.id] = table as unknown as BaseNode

  const section = createSection([p1, table.id], 'section-A')
  nodes[section.id] = section as unknown as BaseNode

  doc.body.children = [p0, section.id, p2]
  ;(doc as unknown as { nodes?: Record<string, BaseNode> }).nodes = nodes

  const host: DomEditorHost = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  cleanups.push(() => { editor.destroy(); container.remove() })

  return { editor, doc, p0, p1, sectionId: section.id, tableId: table.id, cellParas: [c1, c2], p2 }
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

function setCursor(f: Fixture, paraId: string, offset = 0): void {
  f.editor.getStore().setCursor({ paragraphPath: [f.doc.id, paraId], offset, visible: true })
}

/** 页面上实际画出来的文本 (与渲染同源的展平) */
function renderedText(f: Fixture): string {
  return f.editor.getDraw().getPages()
    .flatMap(getFlatPageItems)
    .filter((it) => it.type === 'text')
    .map((it) => it.text ?? '')
    .join('|')
}

// ================================================================

describe('P4 — 创建节 (Editor 门面)', () => {
  it('insertSection: 默认插在光标所在块之后, 落在 body 里', () => {
    const f = makeEditor()
    setCursor(f, f.p0, 0)
    const newId = f.editor.insertSection({ sectionCode: 'chapter-001' })
    expect(newId).toBeTruthy()
    expect([...f.doc.body.children]).toEqual([f.p0, newId, f.sectionId, f.p2])
    expect(f.editor.getSectionCode(newId!)).toBe('chapter-001')
  })

  it('新节带初始段落 → 光标落在其中 (立即可编辑)', () => {
    const f = makeEditor()
    setCursor(f, f.p0, 0)
    const newId = f.editor.insertSection()!
    const paraId = (f.editor.getPool().nodes.get(newId) as unknown as { children: string[] }).children[0]
    expect(f.editor.getStore().state.runtime.cursor.paragraphPath).toEqual([f.doc.id, paraId])
  })

  it('insertChildSection: 作为指定节的末子节点', () => {
    const f = makeEditor()
    const childId = f.editor.insertChildSection(f.sectionId, { sectionCode: 'chapter-002' })
    expect(childId).toBeTruthy()
    const section = f.editor.getPool().nodes.get(f.sectionId) as unknown as { children: string[] }
    expect(section.children[section.children.length - 1]).toBe(childId)
    expect(sectionsOf(f.doc, f.editor.getPool())).toEqual([f.sectionId, childId])
  })

  it('withInitialParagraph:false → 合法空节 (模型允许空)', () => {
    const f = makeEditor()
    setCursor(f, f.p0, 0)
    const newId = f.editor.insertSection({ withInitialParagraph: false })!
    expect((f.editor.getPool().nodes.get(newId) as unknown as { children: string[] }).children).toEqual([])
  })

  it('§31.13 显式拒绝: 光标在表格 cell 内 → null 且不动文档', () => {
    const f = makeEditor()
    setCursor(f, f.cellParas[0], 0)
    const before = [...f.doc.body.children]
    expect(f.editor.insertSection()).toBeNull()
    expect([...f.doc.body.children]).toEqual(before)
  })
})

describe('P4 — 节选中与文本光标互斥', () => {
  it('selectSection: 选中 + 光标落到节内首个段落 + 折叠文本选区', () => {
    const f = makeEditor()
    f.editor.selectSection(f.sectionId)
    expect(f.editor.getSelectedSectionId()).toBe(f.sectionId)
    expect(f.editor.getStore().state.runtime.cursor.paragraphPath).toEqual([f.doc.id, f.p1])
    expect(f.editor.getStore().state.runtime.selection.active).toBe(false)
  })

  it('光标一旦移走 → 节选中自动解除 (单一清零点)', () => {
    const f = makeEditor()
    f.editor.selectSection(f.sectionId)
    expect(f.editor.getSelectedSectionId()).toBe(f.sectionId)
    setCursor(f, f.p2, 0)
    expect(f.editor.getSelectedSectionId()).toBeNull()
  })

  it('selectSection(null) 清除选中但不动光标', () => {
    const f = makeEditor()
    f.editor.selectSection(f.sectionId)
    const before = f.editor.getStore().state.runtime.cursor.paragraphPath
    f.editor.selectSection(null)
    expect(f.editor.getSelectedSectionId()).toBeNull()
    expect(f.editor.getStore().state.runtime.cursor.paragraphPath).toEqual(before)
  })

  it('selectSection 传非节 id → 清除, 不记录脏 id', () => {
    const f = makeEditor()
    f.editor.selectSection(f.p0)
    expect(f.editor.getSelectedSectionId()).toBeNull()
  })
})

describe('P4 — 移动 / 改码 / 删除 + undo/redo', () => {
  it('上移/下移: 与同父相邻兄弟交换', () => {
    const f = makeEditor()
    expect(f.editor.moveSectionUp(f.sectionId)).toBe(true)
    expect([...f.doc.body.children]).toEqual([f.sectionId, f.p0, f.p2])
    expect(f.editor.moveSectionDown(f.sectionId)).toBe(true)
    expect([...f.doc.body.children]).toEqual([f.p0, f.sectionId, f.p2])
  })

  it('首位上移 / 末位下移 → false (边界 no-op)', () => {
    const f = makeEditor()
    f.editor.moveSectionUp(f.sectionId) // → [sec, p0, p2]
    expect(f.editor.moveSectionUp(f.sectionId)).toBe(false)
    expect([...f.doc.body.children]).toEqual([f.sectionId, f.p0, f.p2])
  })

  it('moveSectionTo: A → 成为 B 的子节, 再移回父层', () => {
    const f = makeEditor()
    const bId = f.editor.insertSection({ sectionCode: 'chapter-002' })!
    expect(f.editor.moveSectionTo(f.sectionId, bId, 0)).toBe(true)
    expect(sectionOf(f.sectionId, f.editor.getPool())).toBe(bId)
    expect(f.editor.moveSectionTo(f.sectionId, f.doc.id, 0)).toBe(true)
    expect(sectionOf(f.sectionId, f.editor.getPool())).toBeNull()
    expect([...f.doc.body.children][0]).toBe(f.sectionId)
  })

  it('setSectionCode: trim → 写; 空串 → 清除; 非节 → false', () => {
    const f = makeEditor()
    expect(f.editor.setSectionCode(f.sectionId, ' chapter-001 ')).toBe(true)
    expect(f.editor.getSectionCode(f.sectionId)).toBe('chapter-001')
    expect(f.editor.setSectionCode(f.sectionId, '   ')).toBe(true)
    expect(f.editor.getSectionCode(f.sectionId)).toBeUndefined()
    expect(f.editor.setSectionCode(f.p0, 'x')).toBe(false)
  })

  it('删除整节 → 内容从页面消失; undo → 全部回来', () => {
    const f = makeEditor()
    expect(f.editor.deleteNode(f.sectionId)).toBe(true)
    expect(renderedText(f)).not.toContain('in-section')
    f.editor.undo()
    expect(renderedText(f)).toContain('in-section')
    expect([...f.doc.body.children]).toEqual([f.p0, f.sectionId, f.p2])
  })

  it('删到 body 空 → 自动补段落, 光标落在新段落; undo 精确还原', () => {
    const f = makeEditor()
    f.editor.deleteNode(f.p0)
    f.editor.deleteNode(f.p2)
    expect(f.editor.deleteNode(f.sectionId)).toBe(true)

    const children = f.editor.getPool().getChildren(f.doc.id)
    expect(children).toHaveLength(1)
    expect(f.editor.getPool().nodes.get(children[0])?.type).toBe('paragraph')
    // 光标不能指着已删段落 (否则输入静默无效)
    expect(f.editor.getStore().state.runtime.cursor.paragraphPath).toEqual([f.doc.id, children[0]])

    f.editor.undo()
    expect([...f.doc.body.children]).toEqual([f.sectionId])
  })
})

describe('P4 — listSections / 几何 / 开关', () => {
  it('listSections: 深度与父子关系正确', () => {
    const f = makeEditor()
    const childId = f.editor.insertChildSection(f.sectionId, { sectionCode: 'chapter-002' })!
    const list = f.editor.listSections()
    expect(list.map((s) => s.id)).toEqual([f.sectionId, childId])
    expect(list[0].depth).toBe(1)
    expect(list[1].depth).toBe(2)
    expect(list[1].parentId).toBe(f.sectionId)
  })

  it('getSectionClientRects: 有内容的节有矩形; 空节返回 []', () => {
    const f = makeEditor()
    const rects = f.editor.getSectionClientRects(f.sectionId)
    expect(rects.length).toBeGreaterThan(0)
    expect(rects[0].contentRight).toBeGreaterThan(rects[0].contentLeft)

    const emptyId = f.editor.insertChildSection(f.sectionId, { withInitialParagraph: false })!
    expect(f.editor.getSectionClientRects(emptyId)).toEqual([])
  })

  it('节内表格的 cell 内容被算进节矩形 (证明双扫描: page.items + getFlatPageItems)', () => {
    const f = makeEditor()
    const rects = f.editor.getSectionClientRects(f.sectionId)
    // 节内含表格 → 矩形高度必须覆盖到 cell 内容, 而不只是首段那一行
    expect(rects[0].height).toBeGreaterThan(40)
  })

  it('showSectionStructure 默认 true 且可切换; 关掉后结构操作照常 (纯 UI 层)', () => {
    const f = makeEditor()
    expect(f.editor.getShowSectionStructure()).toBe(true)
    f.editor.setShowSectionStructure(false)
    expect(f.editor.getShowSectionStructure()).toBe(false)

    const inserted = f.editor.insertSection()
    expect(inserted).toBeTruthy()
    // 默认插在光标所在块之后 → 新节在原文档的节之前
    expect(sectionsOf(f.doc, f.editor.getPool())).toEqual([inserted, f.sectionId])
    expect(f.editor.deleteNode(f.sectionId)).toBe(true)
    expect(sectionsOf(f.doc, f.editor.getPool())).toEqual([inserted])

    f.editor.undo()
    // 关掉可视化开关不影响 undo 的精确性: 被删的节原样回来 (顺序也原样)
    expect(sectionsOf(f.doc, f.editor.getPool())).toEqual([inserted, f.sectionId])
    expect([...f.doc.body.children]).toEqual([f.p0, inserted, f.sectionId, f.p2])
  })
})
