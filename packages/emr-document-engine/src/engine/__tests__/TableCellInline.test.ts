// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 表格 cell 内联内容补齐 (契约 §31.13.1)
//
// 此前 `layoutCellItems` 只认 text/smarttext: 域、图片、脚注引用、交叉引用
// 在 cell 里既没有 SLIF item 也没有占高 —— 内容静默消失 (§31.5)。本文件锁:
//   ① 四类内联节点都产出 item, 且与正文同口径 (域代表值/图片钳宽/交叉引用解析);
//   ② cell 内脚注引用参与全页编号, 编号回填写进 cell 项;
//   ③ 含域的表格可以进入增量分页, 表格键带域预留宽取样输入。
// ================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { testMeasurer } from './helpers'
import { buildNodePool } from '../document/core/NodePool'
import { fieldReserveDigits } from '../document/factory/FieldFormatter'
import { fieldParticle } from '../render/particles/ParticleAdapters'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import {
  createDocument, createParagraph, createTextNode, createFieldNode,
  createImageNode, createTable, createTableRow, createTableCell,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree, Paragraph } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'
import type { SLIFItem, SLIFPage } from '../layout/core/SLIF'

const SENTENCE = '患者三日前出现发热，伴畏寒乏力，无咳嗽咳痰，无腹痛腹泻，饮食睡眠尚可。'

function newEngine(): LayoutEngine {
  return new LayoutEngine(new EventBus(), testMeasurer)
}

/** 收集所有表格 cell 内的 item (含嵌套表) */
function cellItemsOf(pages: readonly SLIFPage[]): SLIFItem[] {
  const out: SLIFItem[] = []
  const walk = (items: readonly SLIFItem[]): void => {
    for (const item of items) {
      if (item.type === 'table' && item.rows) {
        for (const row of item.rows) {
          for (const cell of row.cells) walk(cell.items)
        }
        continue
      }
      out.push(item)
    }
  }
  for (const page of pages) walk(page.items)
  return out
}

/** 单行单列表格包住给定 cell 段落 */
function wrapInTable(children: string[], all: Map<string, BaseNode>) {
  const cell = createTableCell(children)
  const row = createTableRow([cell])
  const table = createTable([{ width: 100, mode: 'percentage' }], [row])
  for (const n of [table, row, cell]) all.set(n.id, n as unknown as BaseNode)
  return table
}

function makeImageDoc(imageWidth: number, imageHeight: number) {
  const doc = createDocument('cell-image')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)
  const img = createImageNode('obj-1', imageWidth, imageHeight)
  all.set(img.id, img as unknown as BaseNode)
  const para = createParagraph([img.id])
  all.set(para.id, para as unknown as BaseNode)
  const table = wrapInTable([para.id], all)
  doc.body.children = [table.id]
  return { doc, pool: buildNodePool(all, { body: doc.id }), imageId: img.id }
}

function makeFieldDoc(fieldType: 'document_title' | 'page_number', cachedValue: string) {
  const doc = createDocument('cell-field')
  doc.title = '原始标题'
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)
  const f = createFieldNode(fieldType) as unknown as { id: string; cachedValue?: string; fieldType: string }
  f.cachedValue = cachedValue
  all.set(f.id, f as unknown as BaseNode)
  const para = createParagraph([f.id])
  all.set(para.id, para as unknown as BaseNode)
  const table = wrapInTable([para.id], all)
  doc.body.children = [table.id]
  return { doc, pool: buildNodePool(all, { body: doc.id }), fieldId: f.id, all }
}

function makeFootnoteDoc(cellFirst: boolean) {
  const doc = createDocument('cell-footnote')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)

  const mkRef = (suffix: string) => {
    const contentText = createTextNode(`脚注内容${suffix}`)
    const contentPara = {
      type: 'paragraph', id: `fn-para-${suffix}`, children: [contentText.id],
    } as unknown as BaseNode
    const content = {
      type: 'footnote_content', id: `fn-content-${suffix}`,
      refId: `fn-ref-${suffix}`, children: [contentPara.id],
    } as unknown as BaseNode
    const ref = {
      type: 'footnote_ref', id: `fn-ref-${suffix}`, footnoteId: content.id,
    } as unknown as BaseNode
    for (const n of [contentText, contentPara, content, ref]) all.set(n.id, n)
    return ref
  }

  const bodyRef = mkRef('body')
  const cellRef = mkRef('cell')
  const lead = createTextNode('正文')
  const bodyPara = createParagraph([lead.id, bodyRef.id])
  all.set(lead.id, lead as unknown as BaseNode)
  all.set(bodyPara.id, bodyPara as unknown as BaseNode)

  const cellLead = createTextNode('格内')
  const cellPara = createParagraph([cellLead.id, cellRef.id])
  all.set(cellLead.id, cellLead as unknown as BaseNode)
  all.set(cellPara.id, cellPara as unknown as BaseNode)
  const table = wrapInTable([cellPara.id], all)

  doc.body.children = cellFirst ? [table.id, bodyPara.id] : [bodyPara.id, table.id]
  return {
    doc, pool: buildNodePool(all, { body: doc.id }),
    bodyRefId: bodyRef.id, cellRefId: cellRef.id,
  }
}

function makeCrossRefDoc() {
  const doc = createDocument('cell-xref')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)

  const xref = {
    type: 'cross_reference', id: 'xref-1', refType: 'bookmark',
    targetRef: 'bm-1', displayText: '见第{page}页',
  } as unknown as BaseNode
  all.set(xref.id, xref)
  const cellPara = createParagraph([xref.id])
  all.set(cellPara.id, cellPara as unknown as BaseNode)
  const table = wrapInTable([cellPara.id], all)
  doc.body.children = [table.id]

  // 填充段落把书签目标推到后面的页
  let anchorTextId = ''
  for (let i = 0; i < 14; i++) {
    const t = createTextNode(`第${i + 1}段：${SENTENCE}${SENTENCE}`)
    const p = createParagraph([t.id]) as Paragraph
    all.set(t.id, t as unknown as BaseNode)
    all.set(p.id, p as unknown as BaseNode)
    doc.body.children.push(p.id)
    anchorTextId = t.id
  }
  all.set('bm-1', {
    type: 'bookmark', id: 'bm-1', name: '目标', targetId: anchorTextId,
  } as unknown as BaseNode)

  return { doc, pool: buildNodePool(all, { body: doc.id }), xrefId: xref.id }
}

function canonical(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(obj).sort()) out[key] = walk(obj[key])
      return out
    }
    return v
  }
  return JSON.stringify(walk(value))
}

describe('表格 cell 内联内容 (契约 §31.13.1)', () => {
  it('cell 内的域产出 field item, 量宽用代表值', () => {
    const { doc, pool, fieldId } = makeFieldDoc('document_title', '原始标题')
    const items = cellItemsOf(newEngine().fullLayout(doc, pool))
    const item = items.find(i => i.nodeId === fieldId)
    expect(item).toBeTruthy()
    expect(item!.type).toBe('field')
    expect(item!.fieldType).toBe('document_title')
    expect(item!.text).toBe('原始标题')
    // document_title 的代表值就是 doc.title — 宽度必须与之一致
    const expected = testMeasurer.measureWidth('原始标题', { font: 'SimSun', size: 16 })
    expect(item!.width).toBeCloseTo(expected, 3)
  })

  it('cell 内的图片产出 image item, 宽度钳到 cell 文本宽', () => {
    const { doc, pool, imageId } = makeImageDoc(5000, 300)
    const items = cellItemsOf(newEngine().fullLayout(doc, pool))
    const item = items.find(i => i.nodeId === imageId)
    expect(item).toBeTruthy()
    expect(item!.type).toBe('image')
    expect(item!.height).toBe(300)
    // 默认版心 614, cell 文本宽 = 614 - 2*6 = 602
    expect(item!.width).toBe(602)
  })

  it('cell 内的交叉引用按页映射解析, 不残留占位符', () => {
    const { doc, pool, xrefId } = makeCrossRefDoc()
    const items = cellItemsOf(newEngine().fullLayout(doc, pool))
    const item = items.find(i => i.nodeId === xrefId)
    expect(item).toBeTruthy()
    expect(item!.text).toMatch(/^见第[1-9]\d*页$/)
    expect(item!.text).not.toContain('{page}')
  })

  it('cell 内的脚注引用参与编号并回填', () => {
    const { doc, pool, cellRefId } = makeFootnoteDoc(true)
    const pages = newEngine().fullLayout(doc, pool)
    const items = cellItemsOf(pages)
    const ref = items.find(i => i.nodeId === cellRefId)
    expect(ref).toBeTruthy()
    expect(ref!.nodeType).toBe('footnote_ref')
    expect(ref!.text).toBe('1')
    // 页底脚注区真的生成了内容
    const flatText = pages[0].items.map(i => i.text || '').join('|')
    expect(flatText).toContain('脚注内容cell')
  })

  it('正文引用与 cell 引用按阅读顺序连续编号', () => {
    const { doc, pool, bodyRefId, cellRefId } = makeFootnoteDoc(false)
    const items = cellItemsOf(newEngine().fullLayout(doc, pool))
    expect(items.find(i => i.nodeId === bodyRefId)!.text).toBe('1')
    expect(items.find(i => i.nodeId === cellRefId)!.text).toBe('2')
  })

  it('含域的表格进入增量分页, 且与全量逐字节一致', () => {
    const { doc, pool } = makeFieldDoc('page_number', '[页码]')
    // 加填充段落让文档多页, 才能观察到复用页
    for (let i = 0; i < 40; i++) {
      const t = createTextNode(`第${i + 1}段：${SENTENCE}${SENTENCE}`)
      const p = createParagraph([t.id]) as Paragraph
      pool.addNode(t as unknown as BaseNode)
      pool.addNode(p as unknown as BaseNode)
      pool.insertChild(doc.id, p.id, 1)
    }

    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')
    // 改正文**末段** → 前序页可复用 (改首页不会进入续排路径)
    const lastBlockId = doc.body.children[doc.body.children.length - 1]
    const target = pool.nodes.get(lastBlockId) as unknown as Paragraph
    const textId = (target as unknown as { children: string[] }).children[0]
    pool.updateNode(textId, { text: `${SENTENCE}（已修改）` } as Partial<BaseNode>)

    const pages = engine.fullLayout(doc, pool, 'paragraph')
    expect(engine.getPaginationStats().mode).toBe('resume')
    expect(canonical(pages)).toBe(canonical(newEngine().fullLayout(doc, pool)))
  })

  it('表格键: 含域子树带域预留宽取样输入, 纯文本表格不带', () => {
    type KeyEngine = {
      fieldReserveCtx: { totalPagesHint: number; locale?: string; documentTitle?: string }
      tableLayoutKey: (pool: NodePool, tableId: string) => string
    }
    const { doc, pool } = makeFieldDoc('document_title', '标题')
    const tableId = doc.body.children[0]
    const engine = newEngine() as unknown as KeyEngine
    engine.fieldReserveCtx = { totalPagesHint: 9, locale: 'zh-CN', documentTitle: '标题' }
    const withField = engine.tableLayoutKey(pool, tableId)
    expect(withField).toContain(`#f${fieldReserveDigits(9)}#lzh-CN`)
    expect(withField).toContain('#t"标题"')
    // 同输入同键
    expect(engine.tableLayoutKey(pool, tableId)).toBe(withField)
    // 位数/locale/标题任一变化都使键变
    engine.fieldReserveCtx = { totalPagesHint: 10, locale: 'zh-CN', documentTitle: '标题' }
    expect(engine.tableLayoutKey(pool, tableId)).not.toBe(withField)
    engine.fieldReserveCtx = { totalPagesHint: 9, locale: 'en-US', documentTitle: '标题' }
    expect(engine.tableLayoutKey(pool, tableId)).not.toBe(withField)
    engine.fieldReserveCtx = { totalPagesHint: 9, locale: 'zh-CN', documentTitle: '标题2' }
    expect(engine.tableLayoutKey(pool, tableId)).not.toBe(withField)

    // 纯文本表格: 不带 #f 段
    const plainDoc = createDocument('plain-table')
    const all = new Map<string, BaseNode>()
    all.set(plainDoc.id, plainDoc as unknown as BaseNode)
    const t = createTextNode('纯文本')
    const p = createParagraph([t.id])
    all.set(t.id, t as unknown as BaseNode)
    all.set(p.id, p as unknown as BaseNode)
    const table = wrapInTable([p.id], all)
    plainDoc.body.children = [table.id]
    const plainPool = buildNodePool(all, { body: plainDoc.id })
    expect(engine.tableLayoutKey(plainPool, table.id)).not.toContain('#f')
  })

  it('cell 内交叉引用仍在增量安全集之外: 回落全量', () => {
    const { doc, pool } = makeCrossRefDoc()
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    const fillers = [...pool.nodes.values()].filter(
      n => n.type === 'paragraph' && (n as unknown as { children: string[] }).children
        .some(c => (pool.nodes.get(c) as { type?: string } | undefined)?.type === 'text'),
    ) as Paragraph[]
    const target = fillers[fillers.length - 1]
    const textId = (target as unknown as { children: string[] }).children[0]
    pool.updateNode(textId, { text: `${SENTENCE}（改）` } as Partial<BaseNode>)

    engine.fullLayout(doc, pool, 'paragraph')
    expect(engine.getPaginationStats().mode).toBe('full')
  })
})

// ================================================================
// 渲染接线: Draw 必须把 cell 原子项交回自己 (图片缓存/按页域解析在 Draw)
// ================================================================

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })

describe('cell 内域的渲染接线 (契约 §31.13.1)', () => {
  it('Editor 渲染时 cell 内页码域按本页解析, 不是缓存占位符', () => {
    const { doc, all } = makeFieldDoc('page_number', '[页码]')
    ;(doc as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes =
      Object.fromEntries(all)

    const texts: { id?: string; text?: string }[] = []
    const orig = fieldParticle.render.bind(fieldParticle)
    vi.spyOn(fieldParticle, 'render').mockImplementation((ctx, item, x, y, options) => {
      texts.push({ id: item.nodeId, text: item.text })
      orig(ctx, item, x, y, options)
    })

    const host = createDomEditorHost()
    const container = document.createElement('div')
    document.body.appendChild(container)
    host.surface.mount(container)
    host.input.mount(container)
    const editor = new Editor(host, doc)
    editor.setDocument(doc)

    expect(texts.length).toBeGreaterThan(0)
    expect(texts[0].text).toBe('1')
  })
})
