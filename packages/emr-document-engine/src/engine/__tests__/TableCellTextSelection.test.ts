// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// TableCellTextSelection — 表格内文本选区 (修复「选区选不了表格」)
//
// 根因: MouseHandler.onMouseDown 对 cell 内任意 mousedown 一律进入
// 单元格框选 (cellBoxActive=true), onMouseMove 拖拽只扩展框选,
// 文本拖拽选区在 cell 内完全无法建立 (拖多远都变成选格子)。
//
// 修复:
//   - 拖拽停留在起始 cell 内 → 文本选区 (清除单击产生的单格高亮)
//   - 拖拽越过起始 cell 边界 → 单元格框选 (锚定起点 cell, 扩展到当前)
//   - renderSelectionUnified 检测同 cell 选区 → renderCellTextSelection
//     (body 顶层 items 不含 cell 段落, 原逻辑 indexOf=-1 直接跳过渲染)
//
// 测试: 真实 Editor + DOM 事件驱动 MouseHandler, 从布局坐标反推
// client 坐标, 断言「同 cell 拖拽=文本选区」「跨 cell 拖拽=框选」。
// ============================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost, type DomEditorHost } from '../../platform/dom'
import {
  createDocument, createParagraph, createTextNode,
  createTable, createTableRow, createTableCell,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree, TableCell } from '../document/core/DocumentModel'
import type { SLIFItem } from '../layout/core/SLIF'

/** 构造 1×2 表格 (cell 内各一个文本段落), 表格为 body 唯一子节点 */
function makeTableDoc(): { doc: DocumentTree; tableId: string } {
  const doc = createDocument('dn')
  const nodes: Record<string, BaseNode> = {}
  nodes[doc.id] = doc as unknown as BaseNode

  const mkCell = (text: string): TableCell => {
    const tn = createTextNode(text)
    const para = createParagraph([tn.id])
    nodes[tn.id] = tn as unknown as BaseNode
    nodes[para.id] = para as unknown as BaseNode
    const cell = createTableCell([para.id])
    nodes[cell.id] = cell as unknown as BaseNode
    return cell
  }

  const row = createTableRow([mkCell('hello world'), mkCell('right')])
  nodes[row.id] = row as unknown as BaseNode
  const table = createTable(
    [{ width: 50, mode: 'percentage' as const }, { width: 50, mode: 'percentage' as const }],
    [row],
  )
  nodes[table.id] = table as unknown as BaseNode
  doc.body.children = [table.id]
  ;(doc as unknown as { nodes?: Record<string, BaseNode> }).nodes = nodes
  return { doc, tableId: table.id }
}

const cleanups: Array<() => void> = []

function makeEditor() {
  const { doc, tableId } = makeTableDoc()
  const host: DomEditorHost = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  cleanups.push(() => { editor.destroy(); container.remove() })
  return { editor, host, container, tableId }
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

/** 首个顶层 table SLIFItem */
function tableItemOf(editor: Editor): SLIFItem | null {
  for (const page of editor.getDraw().getPages()) {
    for (const item of page.items) {
      if (item.type === 'table') return item
    }
  }
  return null
}

/** cell (r,c) 几何中心 (页面局部坐标, 与 hitTest 使用的坐标系一致) */
function cellCenter(item: SLIFItem, r: number, c: number): { x: number; y: number } {
  const rows = item.rows!
  let rowTop = 0
  for (let i = 0; i < r; i++) rowTop += Math.max(rows[i].height || 24, 24) + 1
  const row = rows[r]
  const cell = row.cells[c]
  const rh = Math.max(row.height || 24, 24)
  return {
    x: item.x + (cell.x || 0) + (cell.width || 40) / 2,
    y: item.y + rowTop + rh / 2,
  }
}

/** 页面局部坐标 → client 坐标 (反演 MouseHandler.hitTest 的坐标变换) */
function clientPoint(
  editor: Editor,
  host: DomEditorHost,
  pageLocalX: number,
  pageLocalY: number,
): { clientX: number; clientY: number } {
  const { scale, scrollY } = editor.getDraw().getCoordinateSystem().transform
  const rect = host.viewport.bounds()
  const vw = host.viewport.size().width
  const page = editor.getDraw().getPages()[0]
  const offsetX = Math.max(0, (vw - page.width * scale) / 2)
  return {
    clientX: pageLocalX * scale + offsetX + rect.left,
    clientY: (pageLocalY - scrollY) * scale + rect.top,
  }
}

describe('表格内文本选区 (选区选不了表格回归)', () => {
  it('同一 cell 内拖拽 → 建立文本选区 (不进入单元格框选)', () => {
    const { editor, host, container } = makeEditor()
    const item = tableItemOf(editor)!
    const cell = item.rows![0].cells[0]

    // mousedown 在 cell(0,0) 左缘, mousemove 到右缘 — 两点都在同一 cell 内
    const down = clientPoint(editor, host, item.x + (cell.x || 0) + 10, cellCenter(item, 0, 0).y)
    const move = clientPoint(editor, host, item.x + (cell.x || 0) + (cell.width || 40) - 10, cellCenter(item, 0, 0).y)

    container.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, clientX: down.clientX, clientY: down.clientY }))
    // mousedown 单击即选中单格 (供表格结构操作)
    expect(editor.cellRange).not.toBeNull()

    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: move.clientX, clientY: move.clientY }))
    // 拖拽仍在同一 cell → 转入文本选区, 清除单格高亮
    expect(editor.cellRange).toBeNull()

    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })

  it('跨 cell 拖拽 → 单元格框选 (锚定起点 cell, 扩展到当前 cell)', () => {
    const { editor, host, container, tableId } = makeEditor()
    const item = tableItemOf(editor)!

    const p0 = cellCenter(item, 0, 0)
    const p1 = cellCenter(item, 0, 1)
    const down = clientPoint(editor, host, p0.x, p0.y)
    const move = clientPoint(editor, host, p1.x, p1.y)

    container.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, clientX: down.clientX, clientY: down.clientY }))
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: move.clientX, clientY: move.clientY }))

    const range = editor.cellRange
    expect(range).not.toBeNull()
    expect(range!.tableId).toBe(tableId)
    expect(range!.startRow).toBe(0)
    expect(range!.startCol).toBe(0)
    expect(range!.endRow).toBe(0)
    expect(range!.endCol).toBe(1)

    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })

  it('先在起点格内拖 (文本选区) 再拖到隔壁格 → 仍能切换到框选 (回归: 起点格内拖不再锁死框选)', () => {
    const { editor, host, container, tableId } = makeEditor()
    const item = tableItemOf(editor)!
    const cell = item.rows![0].cells[0]

    // mousedown 在 cell(0,0) 左缘
    const downX = item.x + (cell.x || 0) + 10
    const cy = cellCenter(item, 0, 0).y
    const down = clientPoint(editor, host, downX, cy)

    // 第一次 mousemove 仍在 cell(0,0) 内 (越过 3px 阈值) → 进入文本选区
    const within = clientPoint(editor, host, item.x + (cell.x || 0) + 40, cy)
    // 第二次 mousemove 到 cell(0,1) → 应切换到框选
    const p1 = cellCenter(item, 0, 1)
    const across = clientPoint(editor, host, p1.x, p1.y)

    container.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, clientX: down.clientX, clientY: down.clientY }))
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: within.clientX, clientY: within.clientY }))
    // 起点格内拖拽 → 文本选区, 清除单格高亮 (cellRange 为空)
    expect(editor.cellRange).toBeNull()

    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: across.clientX, clientY: across.clientY }))
    // 越过起点格 → 框选激活, 锚定起点 cell 扩展到 cell(0,1)
    const range = editor.cellRange
    expect(range).not.toBeNull()
    expect(range!.tableId).toBe(tableId)
    expect(range!.startRow).toBe(0)
    expect(range!.startCol).toBe(0)
    expect(range!.endRow).toBe(0)
    expect(range!.endCol).toBe(1)

    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
})
