// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 可增长表追加行 (契约 §12.9, PRD F8.2)
//
// 覆盖: 门控由命令层消费 / 克隆结构含控件 (value 为空) / single 不克隆 /
// colspan 保留 rowspan 归 1 / undo 同时清节点与 TemplateDefinition 条目
// (无孤儿) / redo / 空表拒绝 / 开关切换经命令且可撤销。
//
// 应用侧集成测试: 它依赖应用 mock 文档 (@/mocks/admissionRecord.json), 进不了
// 引擎分发包 (契约 §32), 故与另外两个同因测试一起落在应用侧, 按包名引用引擎。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@emrde/document-engine'
import { createDomEditorHost } from '@emrde/document-engine/dom'
import {
  createDocument, createParagraph, createSmartTextNode, createTable,
  createTableCell, createTableRow, createTextNode,
  TemplateDefinitionStore, loadDocumentFromObject, NodeType,
} from '@emrde/document-engine'
import docJson from '@/mocks/admissionRecord.json'
import type {
  BaseNode, DocumentTree, ElementMeta, SmartTextNode, Table, TableCell, TextNode,
} from '@emrde/document-engine'

function el(name: string, dataElement: string): ElementMeta {
  return { code: { internal: `CTL_${name}`, dataElement }, name, format: { dataType: 'S1' } }
}

interface Ctx { editor: Editor; tableId: string; srcNameId: string; srcDoseId: string; defs: TemplateDefinitionStore }

/** 一张 2 列表: 末行两格各含 "标签文本 + 控件", 用于克隆源 */
function makeEditor(opts?: { dynamicRows?: boolean; withSingle?: boolean; emptyTable?: boolean }): Ctx {
  const doc = createDocument('可增长表')
  const nodes = new Map<string, BaseNode>()
  nodes.set(doc.id, doc as unknown as BaseNode)
  const defs = new TemplateDefinitionStore()

  const mkCell = (label: string, name: string, de: string, def?: Record<string, unknown>) => {
    const t = createTextNode(label)
    const st = createSmartTextNode(`[${name}]`, el(name, de))
    nodes.set(t.id, t as unknown as BaseNode)
    nodes.set(st.id, st as unknown as BaseNode)
    if (def) defs.set(st.id, def as never)
    const p = createParagraph([t.id, st.id])
    nodes.set(p.id, p as unknown as BaseNode)
    const c = createTableCell([p.id])
    nodes.set(c.id, c as unknown as BaseNode)
    return { cell: c, stId: st.id }
  }

  const a = mkCell('药名：', '药名', 'DE01', { controlType: 'input' })
  const b = mkCell('剂量：', '剂量', 'DE02', opts?.withSingle ? { controlType: 'input', single: true } : { controlType: 'input' })

  const row = createTableRow([a.cell, b.cell])
  nodes.set(row.id, row as unknown as BaseNode)

  const table = createTable([{ width: 100 }, { width: 100 }], opts?.emptyTable ? [] : [row])
  if (!opts?.emptyTable) nodes.set(row.id, row as unknown as BaseNode)
  if (opts?.dynamicRows) table.dynamicRows = true
  nodes.set(table.id, table as unknown as BaseNode)

  doc.body.children = [table.id]

  const raw: Record<string, BaseNode> = {}
  for (const [id, n] of nodes) raw[id] = n
  ;(doc as unknown as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = raw

  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  editor.setDocument(doc, undefined, { templateDefinitions: defs })
  return { editor, tableId: table.id, srcNameId: a.stId, srcDoseId: b.stId, defs }
}

function table(editor: Editor, tableId: string): Table {
  return editor.getPool().nodes.get(tableId) as unknown as Table
}
function rowIds(editor: Editor, tableId: string): readonly string[] {
  return table(editor, tableId).children
}
/** 末行 id (源行 / 刚追加的行) */
function lastRowId(editor: Editor, tableId: string): string {
  const ids = rowIds(editor, tableId)
  return ids[ids.length - 1]
}
/** 某行的单元格列表 */
function cellsOf(editor: Editor, rowId: string): TableCell[] {
  const pool = editor.getPool()
  const row = pool.nodes.get(rowId) as unknown as { children: readonly string[] }
  return row.children.map(cid => pool.nodes.get(cid) as unknown as TableCell)
}
/** 单元格内全部内联节点 */
function inlinesOf(editor: Editor, cell: TableCell): BaseNode[] {
  const pool = editor.getPool()
  const out: BaseNode[] = []
  for (const blockId of cell.children) {
    const para = pool.nodes.get(blockId) as unknown as { children: readonly string[] }
    for (const id of para.children) out.push(pool.nodes.get(id) as unknown as BaseNode)
  }
  return out
}
function smartTextsOf(editor: Editor, cell: TableCell): SmartTextNode[] {
  return inlinesOf(editor, cell).filter(n => n.type === NodeType.SMART_TEXT) as unknown as SmartTextNode[]
}

describe('AppendTableRowCommand (契约 §12.9)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('非可增长表 → 命令层拒绝, 不产生 undo 条目', () => {
    const c = makeEditor()               // dynamicRows 未设
    const before = rowIds(c.editor, c.tableId).length
    c.editor.appendTableRow(c.tableId)
    expect(rowIds(c.editor, c.tableId).length).toBe(before)
    expect(c.editor.canUndo()).toBe(false)
  })

  it('可增长表 → 追加一行且可一步 undo', () => {
    const c = makeEditor({ dynamicRows: true })
    const before = rowIds(c.editor, c.tableId).length
    c.editor.appendTableRow(c.tableId)

    expect(rowIds(c.editor, c.tableId).length).toBe(before + 1)
    expect(c.editor.canUndo()).toBe(true)

    c.editor.undo()
    expect(rowIds(c.editor, c.tableId).length).toBe(before)
  })

  it('克隆结构: 单元格数一致, colspan 保留, rowspan 归 1', () => {
    const c = makeEditor({ dynamicRows: true })
    // 给源行首格加 colspan, 末格加 rowspan
    const src = cellsOf(c.editor, rowIds(c.editor, c.tableId)[0])
    src[0].colspan = 2
    src[1].rowspan = 3

    c.editor.appendTableRow(c.tableId)
    const fresh = cellsOf(c.editor, lastRowId(c.editor, c.tableId))
    expect(fresh.length).toBe(2)
    expect(fresh[0].colspan).toBe(2)          // 保留 → 网格对齐
    expect(fresh[1].rowspan ?? 1).toBe(1)     // 归 1 → 新末行不能向下跨行
  })

  it('克隆控件: 新节点 + 同 element + 已注册 definition', () => {
    const c = makeEditor({ dynamicRows: true })
    c.editor.appendTableRow(c.tableId)
    const freshCell = cellsOf(c.editor, lastRowId(c.editor, c.tableId))[0]
    const sts = smartTextsOf(c.editor, freshCell)

    expect(sts.length).toBe(1)
    expect(sts[0].element.name).toBe('药名')
    expect(sts[0].element.code.dataElement).toBe('DE01')
    expect(sts[0].id).not.toBe(c.srcNameId)                     // 是**新**节点
    expect(c.editor.getControlDefinition(sts[0].id)?.controlType).toBe('input')
  })

  it('克隆出的控件 value 为空 —— 绝不复制源值 (临床数据不得静默复制)', () => {
    const c = makeEditor({ dynamicRows: true })
    expect(c.editor.setControlValue(c.srcNameId, '阿司匹林').ok).toBe(true)

    c.editor.appendTableRow(c.tableId)
    const freshCell = cellsOf(c.editor, lastRowId(c.editor, c.tableId))[0]
    const st = smartTextsOf(c.editor, freshCell)[0]
    expect(st.value).toBeUndefined()                            // §12.6.1 空态
    expect(c.editor.getControlValue(st.id)).toBeUndefined()
  })

  it('single:true 的唯一性控件不克隆', () => {
    const c = makeEditor({ dynamicRows: true, withSingle: true })
    c.editor.appendTableRow(c.tableId)
    const fresh = cellsOf(c.editor, lastRowId(c.editor, c.tableId))

    expect(smartTextsOf(c.editor, fresh[0]).length).toBe(1)      // 普通控件照克隆
    expect(smartTextsOf(c.editor, fresh[1]).length).toBe(0)      // single 跳过
    // 文本仍克隆 (只跳过控件本身)
    expect(inlinesOf(c.editor, fresh[1]).some(n => n.type === NodeType.TEXT)).toBe(true)
  })

  it('文本节点连同样式克隆', () => {
    const c = makeEditor({ dynamicRows: true })
    c.editor.appendTableRow(c.tableId)
    const freshCell = cellsOf(c.editor, lastRowId(c.editor, c.tableId))[0]
    const texts = inlinesOf(c.editor, freshCell).filter(n => n.type === NodeType.TEXT) as unknown as TextNode[]
    expect(texts.map(t => t.text)).toEqual(['药名：'])
  })

  it('undo 同时清掉节点与 TemplateDefinition 条目 —— 不留孤儿定义', () => {
    const c = makeEditor({ dynamicRows: true })
    const storeSizeBefore = c.defs.size

    c.editor.appendTableRow(c.tableId)
    // 源行有 2 个控件 (药名/剂量), 各克隆一份 → store +2
    expect(c.defs.size).toBe(storeSizeBefore + 2)
    const freshCell = cellsOf(c.editor, lastRowId(c.editor, c.tableId))[0]
    const clonedId = smartTextsOf(c.editor, freshCell)[0].id

    c.editor.undo()
    expect(c.defs.get(clonedId)).toBeUndefined()                 // 关键: 无孤儿
    expect(c.defs.size).toBe(storeSizeBefore)
    expect(c.editor.getPool().nodes.get(clonedId)).toBeUndefined()
  })

  it('redo 重新追加且 store 条目不重不漏', () => {
    const c = makeEditor({ dynamicRows: true })
    const storeSizeBefore = c.defs.size

    c.editor.appendTableRow(c.tableId)
    expect(c.defs.size).toBe(storeSizeBefore + 2)
    c.editor.undo()
    expect(c.defs.size).toBe(storeSizeBefore)
    c.editor.redo()

    expect(rowIds(c.editor, c.tableId).length).toBe(2)
    // 关键: redo 不累积 —— 仍是 2 条新定义, 不是 4 条
    expect(c.defs.size).toBe(storeSizeBefore + 2)
  })

  it('空表 (无源行) → 拒绝, 不产生空行也不入 undo 栈', () => {
    const c = makeEditor({ dynamicRows: true, emptyTable: true })
    expect(rowIds(c.editor, c.tableId).length).toBe(0)
    c.editor.appendTableRow(c.tableId)
    expect(rowIds(c.editor, c.tableId).length).toBe(0)
    expect(c.editor.canUndo()).toBe(false)
  })

  it('追加多行 → 逐次克隆, 每行各有独立控件节点', () => {
    const c = makeEditor({ dynamicRows: true })
    c.editor.appendTableRow(c.tableId)
    c.editor.appendTableRow(c.tableId)

    expect(rowIds(c.editor, c.tableId).length).toBe(3)
    const ids = rowIds(c.editor, c.tableId).slice(1).map(rid =>
      smartTextsOf(c.editor, cellsOf(c.editor, rid)[0])[0].id)
    expect(new Set(ids).size).toBe(2)                             // 两个不同节点
  })
})

describe('Editor.getTableClientRect (§12.9 填写态入口定位)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('布局后能取到表格整块矩形 (SLIF item 查找成立)', () => {
    const c = makeEditor({ dynamicRows: true })
    const rect = c.editor.getTableClientRect(c.tableId)
    expect(rect).not.toBeNull()
    expect(rect!.width).toBeGreaterThan(0)
    expect(rect!.height).toBeGreaterThan(0)
  })

  it('未知 tableId → null, 不抛', () => {
    const c = makeEditor({ dynamicRows: true })
    expect(c.editor.getTableClientRect('nope')).toBeNull()
  })

  it('追加行后矩形变高 (表尾下移 → 按钮跟随)', () => {
    const c = makeEditor({ dynamicRows: true })
    const before = c.editor.getTableClientRect(c.tableId)!.height
    c.editor.appendTableRow(c.tableId)
    const after = c.editor.getTableClientRect(c.tableId)!.height
    expect(after).toBeGreaterThan(before)
  })

  it('listGrowableTables 只含开关打开的表', () => {
    const off = makeEditor()
    expect(off.editor.listGrowableTables()).toEqual([])

    const on = makeEditor({ dynamicRows: true })
    expect(on.editor.listGrowableTables()).toEqual([on.tableId])
  })
})

describe('真实文档链路 (§12.9) — 序列化往返 + 加载 + 布局', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('dynamicRows 经 序列化 → 加载 → 布局 后仍可解析, 并取到矩形', () => {
    // 拿内置 demo 病历, 序列化往返一次再打开 —— 模拟 EditorPage 的真实加载路径
    const raw = JSON.parse(JSON.stringify(docJson)) as Record<string, unknown> & {
      nodes: Record<string, Record<string, unknown>>
    }
    const tableIds = Object.entries(raw.nodes)
      .filter(([, n]) => n.type === 'table')
      .map(([id]) => id)
    expect(tableIds.length).toBeGreaterThan(0)

    const targetId = tableIds[0]
    raw.nodes[targetId].dynamicRows = true
    // 保留原 modelVersion (4.5.0), 让加载链真的走一遍 4.5 → 4.6 升级

    const host = createDomEditorHost()
    const container = document.createElement('div')
    document.body.appendChild(container)
    host.surface.mount(container)
    host.input.mount(container)

    const loaded = loadDocumentFromObject(raw)
    const editor = new Editor(host, loaded.doc)
    editor.setDocument(loaded.doc, undefined, { templateDefinitions: loaded.templateDefinitions })

    // 1) 加载后开关仍在 (DocumentLoader 不得剥掉未知字段)
    expect(editor.isTableGrowable(targetId)).toBe(true)
    expect(editor.listGrowableTables()).toEqual([targetId])

    // 2) 真实布局下能取到该表的矩形 (填写态按钮定位的前提)
    const rect = editor.getTableClientRect(targetId)
    expect(rect).not.toBeNull()
    expect(rect!.width).toBeGreaterThan(0)
    expect(rect!.height).toBeGreaterThan(0)

    // 3) 端到端: 追加一行 (克隆真实单元格里的控件)
    const rowsBefore = rowIds(editor, targetId).length
    editor.appendTableRow(targetId)
    expect(rowIds(editor, targetId).length).toBe(rowsBefore + 1)
  })

  it('未声明 dynamicRows 的 demo 表 → 不列可增长、命令拒绝', () => {
    const raw = JSON.parse(JSON.stringify(docJson)) as { nodes: Record<string, { type?: string }> }
    const targetId = Object.entries(raw.nodes).find(([, n]) => n.type === 'table')![0]

    const host = createDomEditorHost()
    const container = document.createElement('div')
    document.body.appendChild(container)
    host.surface.mount(container)
    host.input.mount(container)

    const loaded = loadDocumentFromObject(raw)
    const editor = new Editor(host, loaded.doc)
    editor.setDocument(loaded.doc)

    expect(editor.listGrowableTables()).toEqual([])
    const before = rowIds(editor, targetId).length
    editor.appendTableRow(targetId)
    expect(rowIds(editor, targetId).length).toBe(before)
  })
})

describe('SetTableGrowableCommand (契约 §12.9)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('开关经命令生效且可撤销', () => {
    const c = makeEditor()
    expect(c.editor.isTableGrowable(c.tableId)).toBe(false)

    c.editor.setTableGrowable(c.tableId, true)
    expect(c.editor.isTableGrowable(c.tableId)).toBe(true)
    expect(c.editor.listGrowableTables()).toContain(c.tableId)

    c.editor.undo()
    expect(c.editor.isTableGrowable(c.tableId)).toBe(false)
  })

  it('无实质变化 → 不产生命令', () => {
    const c = makeEditor()
    c.editor.setTableGrowable(c.tableId, false)     // 本来就是 false
    expect(c.editor.canUndo()).toBe(false)
  })

  it('关闭时写回 undefined 而非 false (保持「缺失 = 固定表」约定)', () => {
    const c = makeEditor({ dynamicRows: true })
    c.editor.setTableGrowable(c.tableId, false)
    expect(table(c.editor, c.tableId).dynamicRows).toBeUndefined()
    expect(c.editor.isTableGrowable(c.tableId)).toBe(false)
  })

  it('开关只改行为, 不改结构 (行数不变)', () => {
    const c = makeEditor()
    const before = rowIds(c.editor, c.tableId).length
    c.editor.setTableGrowable(c.tableId, true)
    expect(rowIds(c.editor, c.tableId).length).toBe(before)
  })
})
