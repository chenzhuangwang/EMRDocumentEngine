// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// 表格列宽拖拽门面测试 (Editor.resizeTableColumn / setColumnResizeGuide)
//
// 验证:
//   - 列宽变更走 TableStructureCommand (RULE 4), 相邻两列落为 mode:'fixed'
//   - 重排后 SLIF fragment 的 columnWidths 从 columns 重新派生 (C5, 无缓存)
//   - undo 精确还原原始 mode/width (C2); redo 复现
//   - 表宽守恒: Σ columnWidths 不变, 其余列不受影响
//   - 无变更 (同值 / 越界) → 命令 no-op, 不入 undo 栈 (C4)
//   - 参考线是 draw-time 交互态, 不进 DocumentModel (契约 §7.2)
// ============================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost, type DomEditorHost } from '../../platform/dom'
import {
  createDocument, createParagraph, createTextNode,
  createTable, createTableRow, createTableCell,
} from '../document/factory/ElementFormatter'
import { buildCellGrid } from '../document/table/TableOps'
import { accumulatedHeightTo } from '../layout/table/TableCoordUtil'
import type { BaseNode, DocumentTree, Table, TableCell, TableRow } from '../document/core/DocumentModel'
import type { SLIFItem } from '../layout/core/SLIF'

/** A4 默认页宽 794 - 左右页边距 (90 + 90) */
const CONTENT_WIDTH = 614

interface DocOptions {
  cols?: number
  /** 数据行数 (默认 2; 给足行数可让表格跨页) */
  rows?: number
  /** row0 用一个跨满整行的合并单元格 */
  mergedRow?: boolean
  minWidths?: (number | undefined)[]
}

/** 构造 2 行 × cols 列表格文档 (表格为 body 唯一子节点) */
function makeTableDoc(opts: DocOptions = {}): { doc: DocumentTree; tableId: string } {
  const cols = opts.cols ?? 2
  const doc = createDocument('resize')
  const nodes: Record<string, BaseNode> = {}
  nodes[doc.id] = doc as unknown as BaseNode

  const mkCell = (text: string, colspan?: number): TableCell => {
    const t = createTextNode(text)
    const p = createParagraph([t.id])
    nodes[t.id] = t as unknown as BaseNode
    nodes[p.id] = p as unknown as BaseNode
    const c = createTableCell([p.id], colspan ? { colspan } : undefined)
    nodes[c.id] = c as unknown as BaseNode
    return c
  }

  const rows: TableRow[] = []
  const rowCount = opts.rows ?? 2
  for (let r = 0; r < rowCount; r++) {
    const cells: TableCell[] = []
    if (opts.mergedRow && r === 0) {
      cells.push(mkCell('merged', cols))
    } else {
      for (let c = 0; c < cols; c++) cells.push(mkCell(`r${r}c${c}`))
    }
    const row = createTableRow(cells)
    nodes[row.id] = row as unknown as BaseNode
    rows.push(row)
  }

  const table = createTable(
    Array.from({ length: cols }, (_, i) => ({
      width: 100 / cols, mode: 'percentage' as const, minWidth: opts.minWidths?.[i],
    })),
    rows,
  )
  nodes[table.id] = table as unknown as BaseNode
  doc.body.children = [table.id]
  ;(doc as unknown as { nodes?: Record<string, BaseNode> }).nodes = nodes

  return { doc, tableId: table.id }
}

const cleanups: Array<() => void> = []

function makeEditor(opts: DocOptions = {}) {
  const { doc, tableId } = makeTableDoc(opts)
  const host: DomEditorHost = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  cleanups.push(() => { editor.destroy(); container.remove() })
  return { editor, tableId, container }
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

function tableNode(editor: Editor, tableId: string): Table {
  return editor.getPool().nodes.get(tableId) as unknown as Table
}

/** 表格在当前布局中的 SLIF fragment */
function tableItem(editor: Editor, tableId: string): SLIFItem | undefined {
  return editor.getDraw().getPages().flatMap(p => p.items).find(it => it.nodeId === tableId)
}

/** fragment 的实际列宽 (布局从 columns 派生的结果 — C5 无缓存) */
function fragmentWidths(editor: Editor, tableId: string): number[] {
  return tableItem(editor, tableId)?.columnWidths ?? []
}

function widthsOf(editor: Editor, tableId: string): number[] {
  return tableNode(editor, tableId).columns.map(c => c.width)
}

function undoDepth(editor: Editor): number {
  return editor.getStore().state.runtime.history.undoDepth
}

describe('Editor.resizeTableColumn (表格列宽拖拽)', () => {
  it('两列落为 fixed, 重排后 SLIF columnWidths 同步 (从 columns 派生)', () => {
    const { editor, tableId } = makeEditor()
    // 起手: 50% + 50% → 307 + 307 = 614 (= contentWidth)
    expect(fragmentWidths(editor, tableId)).toEqual([307, 307])

    editor.resizeTableColumn(tableId, 0, 120, 80)

    expect(tableNode(editor, tableId).columns).toEqual([
      { width: 120, mode: 'fixed', minWidth: undefined },
      { width: 80, mode: 'fixed', minWidth: undefined },
    ])
    expect(fragmentWidths(editor, tableId)).toEqual([120, 80])
  })

  it('undo 精确还原原始 mode/width, redo 复现 (C2 / RULE 8)', () => {
    const { editor, tableId } = makeEditor()
    editor.resizeTableColumn(tableId, 0, 120, 80)
    expect(fragmentWidths(editor, tableId)).toEqual([120, 80])

    editor.undo()
    // mode 与 width 都还原 (percentage 语义 + 原始 50)
    expect(tableNode(editor, tableId).columns).toEqual([
      { width: 50, mode: 'percentage' },
      { width: 50, mode: 'percentage' },
    ])
    expect(fragmentWidths(editor, tableId)).toEqual([307, 307])

    editor.redo()
    expect(fragmentWidths(editor, tableId)).toEqual([120, 80])
    expect(tableNode(editor, tableId).columns.map(c => c.mode)).toEqual(['fixed', 'fixed'])
  })

  it('表宽守恒: pair 此消彼长, Σ columnWidths 不变且其余列不受影响', () => {
    const { editor, tableId } = makeEditor({ cols: 3 })
    const before = fragmentWidths(editor, tableId)
    const sumBefore = before.reduce((a, b) => a + b, 0)

    // 与 MouseHandler 同规则: 左列 +dx, 右列 -dx (调用方守恒)
    const left = before[0] + 60
    const right = before[1] - 60
    editor.resizeTableColumn(tableId, 0, left, right)

    const after = fragmentWidths(editor, tableId)
    expect(after[0]).toBe(left)
    expect(after[1]).toBe(right)
    expect(after[2]).toBe(before[2])                       // 其余列不变
    expect(after.reduce((a, b) => a + b, 0)).toBe(sumBefore)
  })

  it('两列均分表: 拖动后 Σ columnWidths === contentWidth', () => {
    const { editor, tableId } = makeEditor()
    expect(fragmentWidths(editor, tableId).reduce((a, b) => a + b, 0)).toBe(CONTENT_WIDTH)

    const before = fragmentWidths(editor, tableId)
    editor.resizeTableColumn(tableId, 0, before[0] + 137, before[1] - 137)

    const after = fragmentWidths(editor, tableId)
    expect(after.reduce((a, b) => a + b, 0)).toBe(CONTENT_WIDTH)
    expect(after).toEqual([before[0] + 137, before[1] - 137])
  })

  it('声明式 minWidth 在 op 内夹紧 (夹紧后仍守恒)', () => {
    const { editor, tableId } = makeEditor({ minWidths: [80, undefined] })
    expect(fragmentWidths(editor, tableId)).toEqual([307, 307])

    // 左列压到 10 → 抬回声明 minWidth 80; 右列吸收差额
    editor.resizeTableColumn(tableId, 0, 10, 604)
    const cols = tableNode(editor, tableId).columns
    expect(cols[0].width).toBe(80)
    expect(cols[0].minWidth).toBe(80)          // spread 保留 minWidth
    expect(cols[1].width).toBe(534)
    expect(cols[0].width + cols[1].width).toBe(CONTENT_WIDTH)
  })

  it('无变更 → 不产生 undo 记录 (C4)', () => {
    const { editor, tableId } = makeEditor()
    editor.resizeTableColumn(tableId, 0, 120, 80)
    const depth = undoDepth(editor)

    // 同值重复提交 → 命令 forward 返回 null, 不入栈
    editor.resizeTableColumn(tableId, 0, 120, 80)
    expect(undoDepth(editor)).toBe(depth)

    // 下标越界 → 同样 no-op
    editor.resizeTableColumn(tableId, tableNode(editor, tableId).columns.length - 1, 100, 100)
    expect(undoDepth(editor)).toBe(depth)
    expect(widthsOf(editor, tableId)).toEqual([120, 80])
  })

  it('单次拖拽 = 单条 undo', () => {
    const { editor, tableId } = makeEditor()
    const before = undoDepth(editor)
    editor.resizeTableColumn(tableId, 0, 200, 414)
    expect(undoDepth(editor)).toBe(before + 1)
  })

  it('含 colspan 的表: 拖动后网格列数不变, 合并格总宽不变', () => {
    const { editor, tableId } = makeEditor({ cols: 3, mergedRow: true })
    const before = fragmentWidths(editor, tableId)
    const sumBefore = before.reduce((a, b) => a + b, 0)
    expect(before.length).toBe(3)

    const gridBefore = buildCellGrid(editor.getPool(), tableId)
    expect(gridBefore.numCols).toBe(3)

    editor.resizeTableColumn(tableId, 0, before[0] + 50, before[1] - 50)

    const after = fragmentWidths(editor, tableId)
    expect(after.length).toBe(3)
    expect(after.reduce((a, b) => a + b, 0)).toBe(sumBefore)
    // 网格列数不变 (只改 columns, 不动 cell span)
    expect(buildCellGrid(editor.getPool(), tableId).numCols).toBe(3)
    // 合并单元格 (row0 colspan=3) 总宽 = 三列之和, 未变
    const merged = tableItem(editor, tableId)!.rows![0].cells[0]
    expect(merged.colspan).toBe(3)
    expect(merged.width).toBe(sumBefore)
  })
})

// ============================================================
// 完整手势 (mousedown → mousemove → mouseup 真实事件分发)
// ============================================================

/** 表格首条内部边界 (页面内坐标) + fragment 行区内的一点 */
function borderTarget(editor: Editor, tableId: string) {
  const item = tableItem(editor, tableId)!
  const widths = item.columnWidths!
  return { x: item.x + widths[0], y: item.y + 10, item, widths }
}

/** 屏幕坐标 = 页面内坐标 × scale (jsdom 下容器 rect 全 0, scrollY 0) */
function screenPos(editor: Editor, pageX: number, pageY: number) {
  const scale = editor.getDraw().getCoordinateSystem().transform.scale
  return { clientX: pageX * scale, clientY: pageY * scale }
}

/** 屏幕坐标 — 文档绝对 Y (含页间间隙), 用于命中第 pageIndex 页 */
function screenPosOnPage(editor: Editor, pageIndex: number, pageX: number, pageY: number) {
  const draw = editor.getDraw()
  const pages = draw.getPages()
  const docY = accumulatedHeightTo(pageIndex, pages, draw.getPageVerticalGap()) + pageY
  return screenPos(editor, pageX, docY)
}

function drag(container: HTMLElement, editor: Editor, fromX: number, fromY: number, dxScreen: number) {
  const from = screenPos(editor, fromX, fromY)
  container.dispatchEvent(new MouseEvent('mousedown', {
    button: 0, bubbles: true, clientX: from.clientX, clientY: from.clientY,
  }))
  window.dispatchEvent(new MouseEvent('mousemove', {
    clientX: from.clientX + dxScreen, clientY: from.clientY,
  }))
  window.dispatchEvent(new MouseEvent('mouseup', {
    clientX: from.clientX + dxScreen, clientY: from.clientY,
  }))
}

describe('列宽拖拽手势 (MouseHandler ↔ Editor 全链路)', () => {
  it('拖拽: 移动期间只画参考线, 松开才提交 (单次 = 单条 undo)', () => {
    const { editor, tableId, container } = makeEditor()
    const target = borderTarget(editor, tableId)
    const depth = undoDepth(editor)
    const from = screenPos(editor, target.x, target.y)

    container.dispatchEvent(new MouseEvent('mousedown', {
      button: 0, bubbles: true, clientX: from.clientX, clientY: from.clientY,
    }))

    // 越过阈值前: 不动
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: from.clientX + 2, clientY: from.clientY }))
    expect(editor.getDraw().columnResizeGuide).toBeNull()
    expect(undoDepth(editor)).toBe(depth)

    // 越过阈值: 只更新参考线, 文档与 undo 栈不动 (C4)
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: from.clientX + 40, clientY: from.clientY }))
    expect(editor.getDraw().columnResizeGuide).toEqual({
      pageIndex: 0,
      x: target.x + 40,
      top: target.item.y,
      bottom: target.item.y + target.item.height - 1,
    })
    expect(fragmentWidths(editor, tableId)).toEqual(target.widths)
    expect(undoDepth(editor)).toBe(depth)

    // 松开 → 一条命令
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: from.clientX + 40, clientY: from.clientY }))
    expect(editor.getDraw().columnResizeGuide).toBeNull()
    expect(undoDepth(editor)).toBe(depth + 1)
    expect(tableNode(editor, tableId).columns).toEqual([
      { width: target.widths[0] + 40, mode: 'fixed', minWidth: undefined },
      { width: target.widths[1] - 40, mode: 'fixed', minWidth: undefined },
    ])
    expect(fragmentWidths(editor, tableId)).toEqual([target.widths[0] + 40, target.widths[1] - 40])
  })

  it('点边界不拖动: 无文档变更、无 undo (C4)', () => {
    const { editor, tableId, container } = makeEditor()
    const target = borderTarget(editor, tableId)
    const depth = undoDepth(editor)
    const from = screenPos(editor, target.x, target.y)

    container.dispatchEvent(new MouseEvent('mousedown', {
      button: 0, bubbles: true, clientX: from.clientX, clientY: from.clientY,
    }))
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: from.clientX, clientY: from.clientY }))

    expect(undoDepth(editor)).toBe(depth)
    expect(editor.getDraw().columnResizeGuide).toBeNull()
    expect(fragmentWidths(editor, tableId)).toEqual(target.widths)
  })

  it('使劲拖: 参考线与提交都停在最小宽处 (C1 同一规则)', () => {
    const { editor, tableId, container } = makeEditor()
    const target = borderTarget(editor, tableId)
    const from = screenPos(editor, target.x, target.y)

    // 向左狠拖 (远超左列宽度) → 夹到默认下限 40
    container.dispatchEvent(new MouseEvent('mousedown', {
      button: 0, bubbles: true, clientX: from.clientX, clientY: from.clientY,
    }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: from.clientX - 1000, clientY: from.clientY }))

    const total = target.widths[0] + target.widths[1]
    const guide = editor.getDraw().columnResizeGuide!
    expect(guide.x).toBe(target.x + 40 - target.widths[0])   // 线停在限位处
    expect(guide.x).toBe(target.item.x + 40)

    window.dispatchEvent(new MouseEvent('mouseup', { clientX: from.clientX - 1000, clientY: from.clientY }))
    expect(widthsOf(editor, tableId)).toEqual([40, total - 40])
    // 表宽守恒 — 夹紧没有破坏 pair 总量
    expect(widthsOf(editor, tableId).reduce((a, b) => a + b, 0)).toBe(total)
  })

  it('④ 跨页 fragment: 在续页 fragment 上拖拽 → 命中该页, 提交后整表生效 (C3)', () => {
    const { editor, tableId, container } = makeEditor({ cols: 3, rows: 45 })
    const pages = editor.getDraw().getPages()
    expect(pages.length).toBeGreaterThan(1)

    // 取最后一个含该表 fragment 的页 (续页)
    let pageIndex = -1
    for (let i = pages.length - 1; i >= 0; i--) {
      if (pages[i].items.some(it => it.nodeId === tableId)) { pageIndex = i; break }
    }
    expect(pageIndex).toBeGreaterThan(0)

    const item = pages[pageIndex].items.find(it => it.nodeId === tableId)!
    const before = item.columnWidths!
    const from = screenPosOnPage(editor, pageIndex, item.x + before[0], item.y + 5)

    container.dispatchEvent(new MouseEvent('mousedown', {
      button: 0, bubbles: true, clientX: from.clientX, clientY: from.clientY,
    }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: from.clientX + 20, clientY: from.clientY }))

    // 参考线携带续页的 pageIndex, 跨度取自该 fragment (含重复表头)
    const guide = editor.getDraw().columnResizeGuide!
    expect(guide.pageIndex).toBe(pageIndex)
    expect(guide.x).toBe(item.x + before[0] + 20)
    expect(guide.top).toBe(item.y)
    expect(guide.bottom).toBe(item.y + item.height - 1)

    window.dispatchEvent(new MouseEvent('mouseup', { clientX: from.clientX + 20, clientY: from.clientY }))

    // 提交后整表生效: 所有页上的 fragment 都拿到新列宽
    const frags = editor.getDraw().getPages().flatMap(p => p.items).filter(it => it.nodeId === tableId)
    expect(frags.length).toBeGreaterThan(1)
    for (const f of frags) {
      expect(f.columnWidths).toEqual([before[0] + 20, before[1] - 20, before[2]])
    }
  })

  it('单元格内拖拽仍是文本选区 (不与列宽拖拽抢手势)', () => {
    const { editor, tableId, container } = makeEditor()
    const item = tableItem(editor, tableId)!
    const depth = undoDepth(editor)

    // 距内部边界 307px 远 — 命中容差 4px 之外
    const x = item.x + 2
    const y = item.y + 10
    container.dispatchEvent(new MouseEvent('mousedown', {
      button: 0, bubbles: true, clientX: x, clientY: y,
    }))
    expect(editor.getDraw().columnResizeGuide).toBeNull()

    window.dispatchEvent(new MouseEvent('mousemove', { clientX: x + 28, clientY: y }))
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: x + 28, clientY: y }))

    // 走的是文本选区, 不是列宽
    const sel = editor.getStore().state.runtime.selection
    expect(sel.active).toBe(true)
    expect(editor.getDraw().columnResizeGuide).toBeNull()
    expect(undoDepth(editor)).toBe(depth)
    expect(fragmentWidths(editor, tableId)).toEqual(item.columnWidths)
  })

  it('格式刷激活时悬停边界保持 copy 光标 (不抢 cursor)', () => {
    const { editor, tableId, container } = makeEditor()
    const target = borderTarget(editor, tableId)

    // 先把光标放进单元格, 供格式刷复制样式
    const inside = screenPos(editor, target.item.x + 20, target.item.y + 10)
    container.dispatchEvent(new MouseEvent('mousedown', {
      button: 0, bubbles: true, clientX: inside.clientX, clientY: inside.clientY,
    }))
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: inside.clientX, clientY: inside.clientY }))

    editor.setFormatPainterActive(true)
    expect(editor.isFormatPainterActive).toBe(true)
    expect(container.style.cursor).toBe('copy')

    // 悬停列间边界 → 不覆盖 copy
    const onBorder = screenPos(editor, target.x, target.y)
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: onBorder.clientX, clientY: onBorder.clientY }))
    expect(container.style.cursor).toBe('copy')

    editor.setFormatPainterActive(false)
    expect(container.style.cursor).toBe('')
  })

  it('⑤ zoom: 命中容差按 scale 折算 (屏幕手感恒定), 位移同样按 1/scale 折算', () => {
    const { editor, tableId, container } = makeEditor()
    const target = borderTarget(editor, tableId)

    // scale = 1: 距边界 4 屏幕 px 命中, 5 px 不命中
    const at1 = screenPos(editor, target.x, target.y)
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: at1.clientX + 4, clientY: at1.clientY }))
    expect(container.style.cursor).toBe('col-resize')
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: at1.clientX + 5, clientY: at1.clientY }))
    expect(container.style.cursor).toBe('')

    // scale = 2: 屏幕 4 px = 页面内 2 px, 容差折算为 4/2 = 2 页面 px → 仍命中;
    // 屏幕 5 px = 2.5 页面 px > 2 → 不命中。屏幕容差恒定。
    editor.getDraw().getCoordinateSystem().update({ scale: 2 })
    const at2 = screenPos(editor, target.x, target.y)
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: at2.clientX + 4, clientY: at2.clientY }))
    expect(container.style.cursor).toBe('col-resize')
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: at2.clientX + 5, clientY: at2.clientY }))
    expect(container.style.cursor).toBe('')

    // scale = 2 下拖 60 屏幕 px → 折算 30 页面 px (位移与命中同用 1/scale)
    drag(container, editor, target.x, target.y, 60)
    expect(fragmentWidths(editor, tableId)).toEqual([target.widths[0] + 30, target.widths[1] - 30])
  })
})

describe('Editor.setColumnResizeGuide (draw-time 参考线)', () => {
  it('写入 / 清除 draw 参考线, 不进 DocumentModel', () => {
    const { editor, tableId } = makeEditor()
    const columnsSnapshot = JSON.stringify(tableNode(editor, tableId).columns)

    expect(editor.getDraw().columnResizeGuide).toBeNull()
    editor.setColumnResizeGuide({ pageIndex: 0, x: 120, top: 10, bottom: 60 })
    expect(editor.getDraw().columnResizeGuide).toEqual({
      pageIndex: 0, x: 120, top: 10, bottom: 60,
    })
    // 参考线不是文档内容 — 文档未被标记修改
    expect(JSON.stringify(tableNode(editor, tableId).columns)).toBe(columnsSnapshot)

    editor.setColumnResizeGuide(null, false)
    expect(editor.getDraw().columnResizeGuide).toBeNull()
  })

  it('写入的是拷贝 — 调用方后续改动不影响 draw 状态', () => {
    const { editor } = makeEditor()
    const guide = { pageIndex: 0, x: 100, top: 0, bottom: 40 }
    editor.setColumnResizeGuide(guide, false)
    guide.x = 999
    expect(editor.getDraw().columnResizeGuide!.x).toBe(100)
  })
})

// ============================================================
// 参考线真实绘制路径 (interact 层 canvas 调用)
//
// setup.ts 的 canvas mock 是哑实现 — 这里给绘制方法装记录器,
// 断言参考线确实画在 interact 层, 且 Y 与内容层同源 (累加页高 - scrollY)。
// ============================================================

interface CtxOp { op: string; args: number[] }
const recordedCtxs: Array<{ recs: CtxOp[] }> = []

/** 包装 getContext('2d') 返回值, 记录 moveTo/lineTo 调用 (透明, 不影响原行为) */
;(function installCtxRecorder() {
  const proto = HTMLCanvasElement.prototype
  const orig = proto.getContext
  proto.getContext = function (this: HTMLCanvasElement, id: string, opts?: unknown) {
    const ctx = orig.call(this, id, opts) as CanvasRenderingContext2D | null
    if (id === '2d' && ctx) {
      const recs: CtxOp[] = []
      recordedCtxs.push({ recs })
      for (const op of ['moveTo', 'lineTo'] as const) {
        const fn = ctx[op].bind(ctx)
        ;(ctx as unknown as Record<string, unknown>)[op] = (...args: number[]) => {
          recs.push({ op, args })
          return fn(...(args as [number, number]))
        }
      }
    }
    return ctx
  } as typeof proto.getContext
})()

/** 在所有已记录的 canvas 调用中查找 X 处的竖线 (moveTo → lineTo) */
function findVerticalLine(x: number): { x: number; y1: number; y2: number } | null {
  for (const { recs } of recordedCtxs) {
    for (let i = 0; i < recs.length - 1; i++) {
      if (recs[i].op !== 'moveTo' || recs[i + 1].op !== 'lineTo') continue
      const [mx, my] = recs[i].args
      const [lx, ly] = recs[i + 1].args
      if (mx === x && lx === x) return { x, y1: my, y2: ly }
    }
  }
  return null
}

describe('参考线绘制 (interact 层)', () => {
  it('无光标也画参考线, Y = 页面累加高 - scrollY, 跨度 = fragment 行区', () => {
    const { editor, tableId } = makeEditor()
    const item = tableItem(editor, tableId)!
    const pages = editor.getDraw().getPages()
    const gap = editor.getDraw().getPageVerticalGap()

    // 无光标 — 旧实现 (interact 段 `cursor.paragraphPath.length === 0 → return`)
    // 会让参考线根本画不出来
    editor.getStore().setCursor({ paragraphPath: [], offset: 0, visible: false })
    // 滚动后再画: 参考线应随内容层一起上移
    editor.getDraw().getCoordinateSystem().update({ scrollY: 100 })

    const guide = { pageIndex: 0, x: 397.5, top: item.y + 3, bottom: item.y + item.height - 3 }
    for (const { recs } of recordedCtxs) recs.length = 0
    editor.setColumnResizeGuide(guide)

    const pageY = accumulatedHeightTo(0, pages, gap) - 100
    expect(findVerticalLine(397.5)).toEqual({
      x: 397.5,
      y1: pageY + guide.top,
      y2: pageY + guide.bottom,
    })

    // 清线后不再绘制
    for (const { recs } of recordedCtxs) recs.length = 0
    editor.setColumnResizeGuide(null)
    expect(findVerticalLine(397.5)).toBeNull()
  })
})
