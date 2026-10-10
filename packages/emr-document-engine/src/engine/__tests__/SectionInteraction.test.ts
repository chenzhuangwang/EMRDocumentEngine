// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// SectionInteraction — P2 消费点接线端到端 (契约 §31 / §31.8)
//
// P2 的出口判据是"光标、选区、查找替换、Ctrl+A、字数统计在节内全部正确"。
// 本文件用**真实 Editor** (真实命令 + 真实布局) 把这句话变成可执行断言。
//
// 核心结构 (body = [P0, Section{ P1, Table{C1, C2} }, P2]):
//
//   body
//   ├── P0            节外正文
//   ├── Section S
//   │   ├── P1        节内段落
//   │   └── Table T
//   │       └── Row → Cell → C1, C2   (表内段落)
//   └── P2            节后正文
//
// 这里刻意把**表格放进节内** —— 它同时压中两条容易漏的路径: Section 展开
// (W2) 与表格展开 (W3), 二者必须正确交织 (契约 §31.3 风险 A)。
// ============================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost, type DomEditorHost } from '../../platform/dom'
import {
  createDocument, createParagraph, createTextNode,
  createTable, createTableRow, createTableCell, createSection,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'
import {
  bodyBlockSpine, bodyParagraphSpine,
} from '../document/selection/SelectionCollector'
import { resolveParagraphRegion, resolveBlockParent } from '../state/CaretScope'
import { SplitParagraphCommand } from '../command/commands/SplitParagraphCommand'
import { MergeParagraphCommand } from '../command/commands/MergeParagraphCommand'
import { TableStructureCommand } from '../command/commands/StructuralCommands'
import { insertRow } from '../document/table/TableOps'
import { generateCommandId } from '../command/ICommand'
import { getFlatPageItems } from '../layout/core/SLIF'

const cleanups: Array<() => void> = []

interface Fixture {
  editor: Editor
  doc: DocumentTree
  /** 节外正文段 */
  p0: string
  /** 节内段落 */
  p1: string
  sectionId: string
  tableId: string
  /** 表内两段的段落 id */
  cellParas: [string, string]
  /** 节后正文段 */
  p2: string
}

function makeEditor(): Fixture {
  const doc = createDocument('节内交互')
  const nodes: Record<string, BaseNode> = {}
  nodes[doc.id] = doc as unknown as BaseNode

  const mkPara = (text: string): string => {
    const tn = createTextNode(text)
    const p = createParagraph([tn.id])
    nodes[tn.id] = tn as unknown as BaseNode
    nodes[p.id] = p as unknown as BaseNode
    return p.id
  }

  const p0 = mkPara('节外前段')
  const p1 = mkPara('节内段落')
  const p2 = mkPara('节后段落')

  const c1 = mkPara('表内甲')
  const c2 = mkPara('表内乙')
  const cellA = createTableCell([c1])
  const cellB = createTableCell([c2])
  nodes[cellA.id] = cellA as unknown as BaseNode
  nodes[cellB.id] = cellB as unknown as BaseNode
  const row = createTableRow([cellA, cellB])
  nodes[row.id] = row as unknown as BaseNode
  const table = createTable(
    [{ width: 50, mode: 'percentage' as const }, { width: 50, mode: 'percentage' as const }],
    [row],
  )
  nodes[table.id] = table as unknown as BaseNode

  const section = createSection([p1, table.id], 'history')
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

  return {
    editor, doc, p0, p1, sectionId: section.id, tableId: table.id,
    cellParas: [c1, c2], p2,
  }
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

/** 拆段 (等价于光标处回车) */
function split(f: Fixture, paraId: string, offset: number): void {
  f.editor.execCommand(new SplitParagraphCommand(
    generateCommandId(), Date.now(), 'test', [f.doc.id, paraId], offset,
  ))
}

/** 并段 (等价于段首退格) */
function merge(f: Fixture, paraId: string): void {
  f.editor.execCommand(new MergeParagraphCommand(
    generateCommandId(), Date.now(), 'test', [f.doc.id, paraId],
  ))
}

// ================================================================

describe('遍历口径 — Section 与表格正确交织 (契约 §31.3)', () => {
  it('W2: Section 就地展开, 自身不入列; 表作为块保留', () => {
    const f = makeEditor()
    const spine = bodyBlockSpine(f.doc, f.editor.getPool())
    expect(spine).toEqual([f.p0, f.p1, f.tableId, f.p2])
    expect(spine).not.toContain(f.sectionId)
  })

  it('W3: 段落逻辑流 = 节展开 ∘ 表展开, 逐元素确定', () => {
    const f = makeEditor()
    const spine = bodyParagraphSpine(f.doc, f.editor.getPool())
    expect(spine).toEqual([f.p0, f.p1, f.cellParas[0], f.cellParas[1], f.p2])
    expect(spine).not.toContain(f.tableId)
  })
})

describe('R2 区域解析 — 节内段落/块的**真实**容器 (契约 §31.8)', () => {
  it('节内段落的区域是 section, 兄弟数组是节的 children, 下标是真实下标', () => {
    const f = makeEditor()
    const pool = f.editor.getPool()
    const reg = resolveParagraphRegion(f.p1, f.doc, pool)
    expect(reg?.type).toBe('section')
    if (reg?.type !== 'section') throw new Error('expected section region')
    expect(reg.containerId).toBe(f.sectionId)
    expect(reg.index).toBe(0)
    expect([...reg.siblings]).toEqual([f.p1, f.tableId])
  })

  it('节内表格的真实容器是 section (旧实现 indexOf 返回 -1)', () => {
    const f = makeEditor()
    const parent = resolveBlockParent(f.tableId, f.doc, f.editor.getPool())
    expect(parent).toEqual({ kind: 'section', containerId: f.sectionId, index: 1 })
  })

  it('节外段落的区域仍是 body (未被节污染)', () => {
    const f = makeEditor()
    const reg = resolveParagraphRegion(f.p0, f.doc, f.editor.getPool())
    expect(reg?.type).toBe('body')
    if (reg?.type !== 'body') throw new Error('expected body region')
    expect(reg.containerId).toBe(f.doc.id)
    expect(reg.index).toBe(0)
  })

  it('表内段落的区域仍是 cell (节不影响表格内部解析)', () => {
    const f = makeEditor()
    const reg = resolveParagraphRegion(f.cellParas[0], f.doc, f.editor.getPool())
    expect(reg?.type).toBe('cell')
  })
})

describe('选区与 Ctrl+A — 覆盖节内内容', () => {
  it('Ctrl+A 覆盖节内段落与表内段落, 不包含 Section 自身', () => {
    const f = makeEditor()
    f.editor.selectAll()
    const sel = f.editor.getStore().state.runtime.selection
    expect(sel.active).toBe(true)
    // anchor = 首个段落, focus = 末段落
    expect(sel.anchor.paragraphPath).toEqual([f.doc.id, f.p0])
    expect(sel.focus.paragraphPath).toEqual([f.doc.id, f.p2])
    // Section id 绝不能出现在选区路径里 (旧实现会把容器 id 泄漏进 spine)
    expect(sel.anchor.paragraphPath).not.toContain(f.sectionId)
    expect(sel.focus.paragraphPath).not.toContain(f.sectionId)
  })

  it('字数统计含节内与表内文本 (契约 §31.9 X9)', () => {
    const f = makeEditor()
    const wc = f.editor.getWordCount()
    // 节外前段(4) + 节内段落(4) + 表内甲(3) + 表内乙(3) + 节后段落(4) = 18
    expect(wc.chars).toBe(18)
    expect(wc.paragraphs).toBe(5)
  })
})

describe('查找替换 — 节内文本可达', () => {
  it('findAll 默认范围含节内段落与表内段落', () => {
    const f = makeEditor()
    const hits = f.editor.findAll('节内')
    expect(hits.length).toBe(1)
    const hits2 = f.editor.findAll('表内')
    expect(hits2.length).toBe(2)
  })

  it('replaceAll 能改到节内段落文本 (经命令系统)', () => {
    const f = makeEditor()
    const { replaced } = f.editor.replaceAll('节内段落', '改后文本')
    expect(replaced).toBeGreaterThan(0)
    const tn = (f.editor.getPool().nodes.get(f.p1) as unknown as { children: string[] }).children[0]
    const text = (f.editor.getPool().nodes.get(tn) as unknown as { text: string }).text
    expect(text).toBe('改后文本')
  })
})

describe('结构命令 — 节内不再静默 no-op (契约 §31.8 X8)', () => {
  it('节内段落回车拆段: 新段落落回**节内**, 不是 body 尾部', () => {
    const f = makeEditor()
    split(f, f.p1, 2)  // "节内|段落"

    const pool = f.editor.getPool()
    const section = pool.nodes.get(f.sectionId) as unknown as { children: string[] }
    // 节 children: [P1, 新段, Table] —— 新段紧跟 P1, 且在节内
    expect(section.children.length).toBe(3)
    expect(section.children[0]).toBe(f.p1)
    const newParaId = section.children[1]
    expect(newParaId).not.toBe(f.tableId)
    expect(pool.nodes.get(newParaId)?.type).toBe('paragraph')
    // body 结构未被污染
    expect([...f.doc.body.children]).toEqual([f.p0, f.sectionId, f.p2])
  })

  it('节内段落退格并段: 合并回节内前一段, 不泄漏到 body', () => {
    const f = makeEditor()
    // 先把 P1 拆成两段, 再在第二段开头退格
    split(f, f.p1, 2)
    const pool = f.editor.getPool()
    const section = pool.nodes.get(f.sectionId) as unknown as { children: string[] }
    const secondId = section.children[1]

    merge(f, secondId)

    const after = pool.nodes.get(f.sectionId) as unknown as { children: string[] }
    // 并回一段: 节 children 恢复 [P1, Table]
    expect(after.children).toEqual([f.p1, f.tableId])
    expect(pool.nodes.has(secondId)).toBe(false)
  })

  it('节内段落可整段删除 (旧实现 indexOf(-1) 直接拒绝)', () => {
    const f = makeEditor()
    expect(f.editor.deleteNode(f.p1)).toBe(true)
    const pool = f.editor.getPool()
    expect(pool.nodes.has(f.p1)).toBe(false)
    // 节 children 只剩表格; body 结构不变
    const section = pool.nodes.get(f.sectionId) as unknown as { children: string[] }
    expect(section.children).toEqual([f.tableId])
    expect([...f.doc.body.children]).toEqual([f.p0, f.sectionId, f.p2])
  })

  it('删除整个 Section 可行 (含子树快照, 可 undo 恢复)', () => {
    const f = makeEditor()
    expect(f.editor.deleteNode(f.sectionId)).toBe(true)
    expect(f.editor.getPool().nodes.has(f.sectionId)).toBe(false)
    expect([...f.doc.body.children]).toEqual([f.p0, f.p2])

    f.editor.undo()
    const pool = f.editor.getPool()
    expect(pool.nodes.has(f.sectionId)).toBe(true)
    expect([...f.doc.body.children]).toEqual([f.p0, f.sectionId, f.p2])
    // 子树整体恢复
    const section = pool.nodes.get(f.sectionId) as unknown as { children: string[] }
    expect(section.children).toEqual([f.p1, f.tableId])
  })

  it('节内表格结构操作可达 (旧实现 indexOf(-1) 静默拒绝)', () => {
    const f = makeEditor()
    const before = (f.editor.getPool().nodes.get(f.tableId) as unknown as { children: string[] }).children.length
    f.editor.execCommand(new TableStructureCommand(
      generateCommandId(), Date.now(), 'test', f.tableId,
      (pool) => { insertRow(pool, f.tableId, 0); return true },
    ))
    const after = (f.editor.getPool().nodes.get(f.tableId) as unknown as { children: string[] }).children.length
    expect(after).toBe(before + 1)
    // 表格仍在节内 (未被挪走)
    const section = f.editor.getPool().nodes.get(f.sectionId) as unknown as { children: string[] }
    expect(section.children).toContain(f.tableId)
  })
})

describe('光标与方向键 — 节内导航不死 (契约 §31.3)', () => {
  it('初始光标落在首个段落 (不是 Section 容器 id)', () => {
    const f = makeEditor()
    const cursor = f.editor.getStore().state.runtime.cursor
    expect(cursor.paragraphPath).toEqual([f.doc.id, f.p0])
  })

  it('节内段落可见 (布局产出其文本行, 含节内表格的 cell 文本)', () => {
    const f = makeEditor()
    const pages = f.editor.getDraw().getPages()
    // getFlatPageItems 展平表格 (table item → rows → cells → items), 与渲染/命中同源
    const items = pages.flatMap(getFlatPageItems)
    const values = items.filter(it => it.type === 'text').map(it => it.text ?? '')
    expect(values.some(v => v.includes('节内段落'))).toBe(true)
    // 表内文本也被布局 (节内表格不能丢)
    expect(values.some(v => v.includes('表内甲'))).toBe(true)
    // 节后段落也在 (Section 边界不截断后续内容)
    expect(values.some(v => v.includes('节后段落'))).toBe(true)
  })
})

describe('方向键块导航 — 节内段落可达 (契约 §31.3, 旧实现 siblings=[] 死锁)', () => {
  /** 调用 KeyboardHandler 的私有 navigateBlock (纯函数, 不触碰 this.editor) */
  function navigate(f: Fixture, paraId: string, dir: 1 | -1) {
    const h = f.editor.getKeyboardHandler() as unknown as {
      navigateBlock: (...a: unknown[]) => { paraId: string; offset: number } | null
    }
    return h.navigateBlock(paraId, f.doc, f.editor.getPool(), dir, 'vertical', 0)
  }

  it('节内段落 ArrowDown: 进入节内表格首 cell (不是跳到 body 尾或死锁)', () => {
    const f = makeEditor()
    expect(navigate(f, f.p1, 1)).toEqual({ paraId: f.cellParas[0], offset: 0 })
  })

  it('节内表格末 cell ArrowDown: 跳出表格落到**节后**段落 (W2 序列的下一个块)', () => {
    const f = makeEditor()
    // 表内第二段 (末 cell) 继续向下 → 表格之后的下一个块 = P2
    expect(navigate(f, f.cellParas[1], 1)).toEqual({ paraId: f.p2, offset: 0 })
  })

  it('节后段落 ArrowUp: 从节外回到节内表格 (跨越 Section 边界双向可达)', () => {
    const f = makeEditor()
    const r = navigate(f, f.p2, -1)
    expect(r?.paraId).toBe(f.cellParas[0])
  })

  it('节外前段 ArrowDown: 进入节内段落 (Section 边界不是导航墙)', () => {
    const f = makeEditor()
    expect(navigate(f, f.p0, 1)).toEqual({ paraId: f.p1, offset: 0 })
  })
})
