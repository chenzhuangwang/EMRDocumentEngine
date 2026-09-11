// ================================================================
// TableCellControl — 表格单元格内 smarttext 控件的布局产物
// ================================================================

import { describe, it, expect } from 'vitest'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { testMeasurer } from './helpers'
import {
  createDocument, createParagraph, createTextNode, createSmartTextNode,
  createTable, createTableRow, createTableCell,
} from '../document/factory/ElementFormatter'
import { buildNodePool } from '../document/core/NodePool'
import type { BaseNode, ElementMeta } from '../document/core/DocumentModel'

function makeCellControlDoc(el: ElementMeta, controlType: 'input' | 'checkbox' | undefined) {
  const doc = createDocument('cell-ctrl')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)

  const tn = createTextNode('标签')
  const st = createSmartTextNode(`[${el.name}]`, el)
  const para = createParagraph([tn.id, st.id])
  all.set(tn.id, tn as unknown as BaseNode)
  all.set(st.id, st as unknown as BaseNode)
  all.set(para.id, para as unknown as BaseNode)

  const cell = createTableCell([para.id])
  const row = createTableRow([cell])
  const table = createTable([{ width: 100, mode: 'percentage' }], [row])
  for (const n of [table, row, cell]) all.set(n.id, n as unknown as BaseNode)
  doc.body.children = [table.id]

  const pool = buildNodePool(all, { body: doc.id })
  const engine = new LayoutEngine(new EventBus(), testMeasurer)
  engine.setControlInfoOf(() => controlType ? { controlType, options: el.format?.enums?.data } : { controlType: undefined, options: el.format?.enums?.data })
  return { engine, doc, pool, stId: st.id }
}

describe('表格 cell 内 smarttext 布局', () => {
  const inputEl: ElementMeta = { code: { internal: 'C', dataElement: 'D' }, name: '姓名', format: { dataType: 'S1' } }

  it('cell 段落含 smarttext → fullLayout 后 cell items 含该控件', () => {
    const { engine, doc, pool, stId } = makeCellControlDoc(inputEl, 'input')
    const pages = engine.fullLayout(doc, pool)
    const found = pages.some(page =>
      (page.items ?? []).some(it => it.type === 'table' && (it.rows ?? []).some(r =>
        (r.cells ?? []).some(c => (c.items ?? []).some(ci => ci.nodeId === stId)))))
    expect(found).toBe(true)
  })

  it('checkbox cell 控件 → 候选组宽预留 (宽度大于纯占位符文本)', () => {
    const cbEl: ElementMeta = {
      code: { internal: 'CB', dataElement: 'DE' }, name: '症状',
      format: { dataType: 'S1', enums: { multiple: true, data: [{ name: '发热', value: 'f' }, { name: '咳嗽', value: 'k' }] } },
    }
    const { engine, doc, pool, stId } = makeCellControlDoc(cbEl, 'checkbox')
    const pages = engine.fullLayout(doc, pool)
    let item: { width?: number } | undefined
    for (const page of pages) {
      for (const it of page.items ?? []) {
        for (const r of it.rows ?? []) for (const c of r.cells ?? []) {
          item = (c.items ?? []).find(ci => ci.nodeId === stId)
          if (item) break
        }
      }
    }
    expect(item).toBeTruthy()
    expect((item as { width: number }).width).toBeGreaterThan(40)
  })
})

describe('表格 cell 内控件字号继承同段落文字 run', () => {
  it('文字 run size=18 → 控件 item.size 也是 18 (不落 12 兜底)', () => {
    const doc = createDocument('cell-fs')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)
    const tn = createTextNode('体温')
    ;(tn as unknown as { size: number }).size = 18
    const st = createSmartTextNode('[体温]', { code: { internal: 'T', dataElement: 'D' }, name: '体温', format: { dataType: 'S1' } })
    const para = createParagraph([tn.id, st.id])
    all.set(tn.id, tn as unknown as BaseNode)
    all.set(st.id, st as unknown as BaseNode)
    all.set(para.id, para as unknown as BaseNode)
    const cell = createTableCell([para.id])
    const row = createTableRow([cell])
    const table = createTable([{ width: 100, mode: 'percentage' }], [row])
    for (const n of [table, row, cell]) all.set(n.id, n as unknown as BaseNode)
    doc.body.children = [table.id]
    const pool = buildNodePool(all, { body: doc.id })
    const engine = new LayoutEngine(new EventBus(), testMeasurer)
    engine.setControlInfoOf(() => ({ controlType: 'input' }))
    let size: number | undefined
    for (const page of engine.fullLayout(doc, pool)) {
      for (const it of page.items ?? []) {
        for (const r of it.rows ?? []) for (const c of r.cells ?? []) {
          const ci = (c.items ?? []).find(x => x.nodeId === st.id)
          if (ci) size = ci.size
        }
      }
    }
    expect(size).toBe(18)
  })
})
